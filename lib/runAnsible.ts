import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import {
  ServerRole,
  resolveSecretEnv,
  type MaestroConfig,
} from "./config/index.ts";
import {
  log,
  requireCmds,
  requireVar,
  commandExists,
  runCommand,
  createTempDir,
  getSecureTempDir,
} from "./helpers.ts";
import { requireBwsSecret } from "./secrets.ts";
import { buildWebsiteAssets } from "./website.ts";
import { type PulumiHosts } from "./hosts.ts";

// Internal assets (playbooks, EE definition) travel with the installed
// package, so they resolve relative to this file — never relative to cwd.
const PACKAGE_DIR = import.meta.dir.replace(/\/lib$/, "");
const ANSIBLE_DIR = `${PACKAGE_DIR}/ansible`;
const EE_DEFINITION_FILE = `${ANSIBLE_DIR}/execution_environment/execution-environment.yml`;
/**
 * Tag for the locally built EE image. Matches the image name in
 * ansible/ansible-navigator.yaml.
 */
const EE_IMAGE = "ansible_ee";
/** Path the SSH private key is mounted to inside the EE container */
const CONTAINER_SSH_KEY_PATH = "/tmp/vps_ssh_key";
/**
 * Path website assets are mounted to inside the EE container. Must match
 * `website_src_dir` in ansible/playbooks/roles/nginx/defaults/main.yml.
 */
const CONTAINER_WEBSITE_DIR = "/opt/website";

/** Per-playbook runtime options threaded into ansible-navigator flags */
export interface PlaybookRunOptions {
  /** Host directory with built website assets, mounted at CONTAINER_WEBSITE_DIR */
  websiteAssetsDir?: string | null;
}

/** Derive the web mode from the typed config ("docker", "static", or ""). */
function resolveWebMode(config: MaestroConfig): string {
  const web = config.ansible?.web;
  return web?.docker ? "docker" : web?.static ? "static" : "";
}

/**
 * Validate web configuration when web provisioning is enabled.
 *
 * @throws Error if a required web value is missing
 */
function validateWebConfig(config: MaestroConfig): void {
  const web = config.ansible?.web;
  const webMode = resolveWebMode(config);
  requireVar(webMode, "WEB_MODE is required when web provisioning is enabled.");

  if (webMode === "static") {
    const source = web?.static?.source;
    requireVar(source, "WEB_STATIC_SOURCE is required for static mode.");
    if (source === "local") {
      requireVar(
        web?.static?.dir,
        "WEB_STATIC_DIR is required when source is local.",
      );
    } else if (source === "image") {
      requireVar(
        web?.static?.image,
        "WEB_STATIC_IMAGE is required when source is image.",
      );
    }
  } else if (webMode === "docker") {
    requireVar(
      web?.docker?.image,
      "WEB_DOCKER_IMAGE is required for docker mode.",
    );
  }
}

/** Resolve a usable pip invocation, or null if none is available. */
function resolvePipCommand(): string[] | null {
  if (commandExists("pip3")) return ["pip3"];
  if (commandExists("pip")) return ["pip"];
  if (commandExists("python3")) return ["python3", "-m", "pip"];
  if (commandExists("python")) return ["python", "-m", "pip"];
  return null;
}

/**
 * Ensure ansible-builder and ansible-navigator are installed, bootstrapping
 * them via pip (--user) when missing.
 *
 * @throws Error if the tooling cannot be installed or found on PATH
 */
async function ensureAnsibleTooling(): Promise<void> {
  log("Ensuring ansible-builder and ansible-navigator are installed...");
  if (commandExists("ansible-builder") && commandExists("ansible-navigator")) {
    return;
  }

  log("ansible-builder not found; installing Ansible tooling via pip...");
  const pipCmd = resolvePipCommand();
  if (!pipCmd) {
    throw new Error("pip is not installed; cannot bootstrap Ansible tooling.");
  }

  const { exitCode } = await runCommand(
    [...pipCmd, "install", "--user", "ansible-navigator", "ansible-runner"],
    { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );
  if (exitCode !== 0) {
    throw new Error("failed to install Ansible tooling via pip.");
  }

  if (
    !commandExists("ansible-builder") ||
    !commandExists("ansible-navigator")
  ) {
    throw new Error(
      "ansible-builder/ansible-navigator are still not available on PATH. " +
        "Ensure your pip user bin directory (e.g., ~/.local/bin) is in PATH.",
    );
  }
}

/**
 * Stage static website assets into a temp directory that is volume-mounted
 * into the EE container at runtime (the EE image itself is app-agnostic).
 * Builds from a local directory or extracts from a container image.
 *
 * @returns The staging directory to mount, or null when web provisioning is
 *   skipped or the web tier is not in static mode
 */
async function prepareWebsiteAssets(
  config: MaestroConfig,
  skipWeb: boolean,
): Promise<string | null> {
  const web = config.ansible?.web;
  const webMode = resolveWebMode(config);

  if (skipWeb || webMode !== "static") {
    log("Skipping website assets preparation...");
    return null;
  }

  const stagingDir = await createTempDir("website");
  const source = web?.static?.source;

  if (source === "local") {
    log("Preparing static website assets from local directory...");
    await buildWebsiteAssets({
      websiteDir: web!.static!.dir!,
      outputDir: stagingDir,
      buildCommand: web?.static?.build,
      distDir: web?.static?.dist,
    });
    return stagingDir;
  }

  if (source === "image") {
    log("Extracting static website assets from container image...");

    const ref = `${web!.static!.image}:${web?.static?.tag || "latest"}`;

    const pull = await runCommand(["docker", "pull", ref], {
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    });
    if (pull.exitCode !== 0) {
      throw new Error(`failed to pull image "${ref}".`);
    }

    const create = await runCommand(["docker", "create", ref], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    if (create.exitCode !== 0) {
      throw new Error(`failed to create container from image "${ref}".`);
    }
    const containerId = create.stdout.trim();

    try {
      const path = web?.static?.path || "/app/dist";
      const cp = await runCommand(
        ["docker", "cp", `${containerId}:${path}/.`, `${stagingDir}/`],
        { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
      );
      if (cp.exitCode !== 0) {
        throw new Error(`failed to copy assets out of image "${ref}".`);
      }
    } finally {
      await runCommand(["docker", "rm", "-f", containerId], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
    }
    return stagingDir;
  }

  throw new Error(`unsupported web static source "${source}".`);
}

/**
 * Fingerprint the EE definition inputs. The hash changes whenever the files
 * the image is built from change (e.g. on a maestro upgrade), so an image
 * tagged with it can be reused safely.
 */
async function eeDefinitionHash(): Promise<string> {
  const hash = createHash("sha256");
  for (const file of [
    EE_DEFINITION_FILE,
    `${ANSIBLE_DIR}/execution_environment/requirements.yml`,
  ]) {
    hash.update(await Bun.file(file).text());
  }
  return hash.digest("hex").slice(0, 12);
}

/** Check whether a Docker image reference exists locally. */
async function dockerImageExists(ref: string): Promise<boolean> {
  const { exitCode } = await runCommand(["docker", "image", "inspect", ref], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  return exitCode === 0;
}

/**
 * Build the Ansible execution environment image locally, or reuse the
 * existing one when it was built from the same EE definition (matched via a
 * content-hash tag).
 *
 * The build context goes to a temp directory (not the package installation,
 * which must stay read-only at runtime).
 *
 * @throws Error if the build fails
 */
async function buildExecutionEnvironment(): Promise<void> {
  if (!existsSync(EE_DEFINITION_FILE)) {
    throw new Error(
      `execution environment definition not found at ${EE_DEFINITION_FILE}.`,
    );
  }

  const hashedRef = `${EE_IMAGE}:${await eeDefinitionHash()}`;
  if (await dockerImageExists(hashedRef)) {
    log(`Reusing existing execution environment image ${hashedRef}...`);
    // Point the tag ansible-navigator runs (:latest) at the reused image, in
    // case another build moved it since.
    await runCommand(["docker", "tag", hashedRef, EE_IMAGE], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    return;
  }

  log(`Building Ansible execution environment image '${EE_IMAGE}'...`);
  const contextDir = await createTempDir("ee-context");
  try {
    const { exitCode } = await runCommand(
      [
        "ansible-builder",
        "build",
        "--container-runtime",
        "docker",
        "--tag",
        EE_IMAGE,
        hashedRef,
        "-f",
        EE_DEFINITION_FILE,
        "--context",
        contextDir,
      ],
      {
        cwd: ANSIBLE_DIR,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    if (exitCode !== 0) {
      throw new Error(
        `ansible-builder build failed with exit code ${exitCode}.`,
      );
    }
  } finally {
    await rm(contextDir, { recursive: true, force: true });
  }
}

/**
 * Assemble the `ansible-navigator run` argv for a playbook, including the
 * SSH-key mount, the website-assets mount (when staged), and a `--penv`
 * flag for every env var the playbooks need.
 */
export function buildPlaybookArgs(
  playbook: string,
  sshKeyTempFile: string,
  requiredVars: string[],
  env: Record<string, string> = {},
  options: PlaybookRunOptions = {},
): string[] {
  // Every env var the playbooks need is forwarded into the
  // execution-environment container with --penv.
  const penvNames = new Set<string>();

  // Secrets living in process.env: GHCR pull credentials and user-declared vars.
  for (const varName of ["GHCR_TOKEN", "GHCR_USERNAME", ...requiredVars]) {
    if (varName) {
      penvNames.add(varName);
    }
  }

  // Everything from buildAnsibleEnv; skip empties so unset stays unset.
  for (const [varName, value] of Object.entries(env)) {
    if (value) {
      penvNames.add(varName);
    }
  }

  const penvArgs = [...penvNames].flatMap((name) => ["--penv", name]);

  const args = [
    "ansible-navigator",
    "run",
    `playbooks/${playbook}`,
    // Keep the navigator log out of the (read-only) package installation
    "--lf",
    `${getSecureTempDir()}/maestro_ansible-navigator.log`,
    `--container-options=-v=${sshKeyTempFile}:${CONTAINER_SSH_KEY_PATH}:ro`,
  ];

  if (options.websiteAssetsDir) {
    args.push(
      `--container-options=-v=${options.websiteAssetsDir}:${CONTAINER_WEBSITE_DIR}:ro`,
    );
  }

  args.push(...penvArgs);
  return args;
}

/**
 * Run a single Ansible playbook inside the execution environment.
 *
 * @throws Error if the playbook run fails
 */
async function runPlaybook(
  playbook: string,
  env: Record<string, string>,
  sshKeyTempFile: string,
  requiredVars: string[],
  options: PlaybookRunOptions = {},
): Promise<void> {
  const args = buildPlaybookArgs(
    playbook,
    sshKeyTempFile,
    requiredVars,
    env,
    options,
  );
  const { exitCode } = await runCommand(args, {
    cwd: ANSIBLE_DIR,
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (exitCode !== 0) {
    throw new Error(
      `ansible-navigator run ${playbook} failed with exit code ${exitCode}.`,
    );
  }
}

/**
 * Build the environment passed to ansible-navigator. The dynamic inventory
 * (inventory/hosts.py) and playbooks read these via the static pass-list in
 * ansible-navigator.yaml plus the per-run `--penv` flags.
 */
export function buildAnsibleEnv(
  pulumiHosts: PulumiHosts,
  config: MaestroConfig,
  requiredVars: string[],
): Record<string, string> {
  const { ansible } = config;
  const env: Record<string, string> = {
    DOMAIN: config.domain,
    BACKEND_PORT: String(ansible?.backend?.port ?? ""),
    BACKEND_IMAGE: ansible?.backend?.image ?? "",
    BACKEND_IMAGE_TAG: ansible?.backend?.tag ?? "",
    BACKEND_MIGRATE_COMMAND: ansible?.backend?.migrate
      ? JSON.stringify(ansible.backend.migrate.command)
      : "",
    BACKEND_HEALTH_PATH: ansible?.backend?.healthCheck?.path ?? "/health",
    WEB_MODE: resolveWebMode(config),
    // FIXME: ensure empty value is ok
    WEB_STATIC_SOURCE: ansible?.web?.static?.source ?? "",
    WEB_STATIC_DIR: ansible?.web?.static?.dir ?? "",
    WEB_STATIC_BUILD: ansible?.web?.static?.build ?? "",
    WEB_STATIC_DIST: ansible?.web?.static?.dist ?? "",
    WEB_STATIC_IMAGE: ansible?.web?.static?.image ?? "",
    WEB_STATIC_TAG: ansible?.web?.static?.tag ?? "",
    WEB_STATIC_PATH: ansible?.web?.static?.path ?? "",
    WEB_DOCKER_IMAGE: ansible?.web?.docker?.image ?? "",
    WEB_DOCKER_TAG: ansible?.web?.docker?.tag ?? "latest",
    WEB_DOCKER_PORT: String(ansible?.web?.docker?.port ?? "3000"),
    MANAGED_GROUPS: JSON.stringify(ansible?.groups ?? []),
    SECRETS_REQUIRED_VARS_JSON: JSON.stringify(requiredVars),
    // Used by the dynamic inventory (inventory/hosts.py)
    SSH_HOSTS: JSON.stringify(pulumiHosts),
    SSH_KEY_PATH: CONTAINER_SSH_KEY_PATH,
  };

  // Export backend environment variables (BACKEND_ENV_*)
  for (const [key, value] of Object.entries(ansible?.backend?.env ?? {})) {
    env[`BACKEND_ENV_${key}`] = value;
  }

  // Backend-container secrets (ansible.backend.secretEnv): the config holds
  // only the NAMES; the values were loaded from Bitwarden into process.env at
  // startup (and asserted present). Mapping entries inject the source secret
  // under a different container var name. They ride the same BACKEND_ENV_*
  // path as literal env vars, which the backend_app role consumes under no_log.
  for (const { container, source } of resolveSecretEnv(
    ansible?.backend?.secretEnv,
  )) {
    env[`BACKEND_ENV_${container}`] = process.env[source] ?? "";
  }

  // Auto-inject PORT into the container environment from backend.port
  env["BACKEND_ENV_PORT"] = String(ansible?.backend?.port ?? "");

  // Database connection wiring (DigitalOcean Managed Postgres).
  //
  // USER, DB, and SSLMODE are the same across the whole deploy, so they travel
  // globally here. HOST, PORT, and PASSWORD are per-stack and DO-derived, so
  // they ride per-host in SSH_HOSTS instead and are merged in by the
  // backend_app role.
  //
  // Gate on per-host postgres data (not the config flag) so the global and
  // per-host credential sets stay consistent: resolveStackHosts stamps
  // postgresHost whenever the live output carries postgres data.
  if (pulumiHosts.hosts.some((h) => h.postgresHost)) {
    env["BACKEND_ENV_POSTGRES_USER"] = process.env["POSTGRES_USER"] ?? "";
    env["BACKEND_ENV_POSTGRES_DB"] = process.env["POSTGRES_DB"] ?? "";
    env["BACKEND_ENV_POSTGRES_SSLMODE"] = "require";
    env["BACKEND_ENV_PGSSLMODE"] = "require";
  }

  // Export web docker environment variables (WEB_DOCKER_ENV_*)
  for (const [key, value] of Object.entries(ansible?.web?.docker?.env ?? {})) {
    env[`WEB_DOCKER_ENV_${key}`] = value;
  }

  return env;
}

export async function runAnsible(
  pulumiHosts: PulumiHosts,
  config: MaestroConfig,
  sshKeyTempFile: string,
  requiredVars: string[],
): Promise<void> {
  // Role-based provisioning: skip playbooks if no server has that role
  const roles = Object.values(config?.pulumi?.stacks ?? {})
    .flatMap((s) => s.servers.flatMap((srv) => srv.roles))
    .reduce((prev, curr) => prev.add(curr), new Set<ServerRole>());
  const skipWeb = !roles.has(ServerRole.Web);
  const skipBackend = !roles.has(ServerRole.Backend);

  log("Ensuring required commands exist...");
  requireCmds(["docker"]);

  log("Ensuring required flags...");
  const sshHostsJson = JSON.stringify(pulumiHosts);
  requireVar(
    sshHostsJson,
    "--ssh-hosts must be provided with at least one hostname.",
  );
  if (sshHostsJson === "null") {
    throw new Error("--ssh-hosts must not be null.");
  }

  if (!skipWeb) {
    validateWebConfig(config);
  }

  log("Ensuring required configuration from environment...");
  requireVar(
    String(config.ansible?.backend?.port ?? ""),
    "BACKEND_PORT is required (set in maestro.yaml).",
  );

  log("Ensuring required secrets...");
  requireBwsSecret("GHCR_TOKEN");
  requireBwsSecret("GHCR_USERNAME");
  requireBwsSecret("VPS_SSH_KEY");

  await ensureAnsibleTooling();

  // Validate backend image configuration when deploying backend
  if (!skipBackend) {
    requireVar(
      config.ansible?.backend?.image,
      "BACKEND_IMAGE is required when deploying backend (set in maestro.yaml).",
    );
    requireVar(
      config.ansible?.backend?.tag,
      "BACKEND_IMAGE_TAG is required when deploying backend (set in maestro.yaml).",
    );
  }

  await buildExecutionEnvironment();

  const websiteAssetsDir = await prepareWebsiteAssets(config, skipWeb);

  const env = buildAnsibleEnv(pulumiHosts, config, requiredVars);

  try {
    if (!skipWeb) {
      log("Provisioning web server...");
      await runPlaybook("web.yml", env, sshKeyTempFile, requiredVars, {
        websiteAssetsDir,
      });
    } else {
      log("Skipping provisioning web server...");
    }

    if (!skipBackend) {
      log("Provisioning backend...");
      await runPlaybook("backend.yml", env, sshKeyTempFile, requiredVars);
    } else {
      log("Skipping provisioning backend...");
    }

    // Security hardening always runs on all servers.
    // We recommend running this playbook last because it may block connections.
    log("Applying security hardening...");
    await runPlaybook("security.yml", env, sshKeyTempFile, requiredVars);
  } finally {
    if (websiteAssetsDir) {
      await rm(websiteAssetsDir, { recursive: true, force: true });
    }
  }
}
