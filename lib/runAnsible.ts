import { existsSync } from "node:fs";
import { rm, mkdir } from "node:fs/promises";
import { ServerRole, type MaestroConfig } from "./config/index.ts";
import {
  log,
  requireCmds,
  requireVar,
  commandExists,
  runCommand,
} from "./helpers.ts";
import { requireBwsSecret } from "./secrets.ts";
import { buildWebsiteAssets } from "./website.ts";
import { type PulumiHosts } from "./ssh.ts";

const SCRIPT_DIR = import.meta.dir.replace(/\/lib$/, "");
const ANSIBLE_DIR = `${SCRIPT_DIR}/ansible`;
const EE_DEFINITION_FILE = `${ANSIBLE_DIR}/execution_environment/execution-environment.yml`;
const WEBSITE_ASSETS_DIR = `${ANSIBLE_DIR}/execution_environment/files/website`;
const EE_IMAGE = "ansible_ee";
/** Path the SSH private key is mounted to inside the EE container */
const CONTAINER_SSH_KEY_PATH = "/tmp/vps_ssh_key";

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

/** Recreate the website assets directory as empty. */
async function resetWebsiteAssetsDir(): Promise<void> {
  await rm(WEBSITE_ASSETS_DIR, { recursive: true, force: true });
  await mkdir(WEBSITE_ASSETS_DIR, { recursive: true });
}

/**
 * Prepare static website assets for the execution environment, mirroring
 * ansible/run.sh: build from a local directory, extract from a container
 * image, or create an empty directory when web provisioning is skipped.
 */
async function prepareWebsiteAssets(
  config: MaestroConfig,
  skipWeb: boolean,
): Promise<void> {
  const web = config.ansible?.web;
  const webMode = resolveWebMode(config);

  if (!skipWeb && webMode === "static") {
    const source = web?.static?.source;
    if (source === "local") {
      log("Preparing static website assets from local directory...");
      await buildWebsiteAssets({
        websiteDir: web!.static!.dir!,
        outputDir: WEBSITE_ASSETS_DIR,
        buildCommand: web?.static?.build,
        distDir: web?.static?.dist,
      });
      return;
    }

    if (source === "image") {
      log("Extracting static website assets from container image...");
      await resetWebsiteAssetsDir();

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
          [
            "docker",
            "cp",
            `${containerId}:${path}/.`,
            `${WEBSITE_ASSETS_DIR}/`,
          ],
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
      return;
    }
  }

  log("Skipping website assets preparation; creating empty directory...");
  await resetWebsiteAssetsDir();
}

/**
 * Build the Ansible execution environment image.
 *
 * @throws Error if the build fails
 */
async function buildExecutionEnvironment(): Promise<void> {
  log(`Building Ansible execution environment image '${EE_IMAGE}'...`);
  const { exitCode } = await runCommand(
    [
      "ansible-builder",
      "build",
      "--container-runtime",
      "docker",
      "--tag",
      EE_IMAGE,
      "-f",
      EE_DEFINITION_FILE,
    ],
    {
      cwd: ANSIBLE_DIR,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if (exitCode !== 0) {
    throw new Error(`ansible-builder build failed with exit code ${exitCode}.`);
  }
}

/**
 * Assemble the `ansible-navigator run` argv for a playbook, including the
 * SSH-key mount and a `--penv` flag for every env var the playbooks need.
 */
export function buildPlaybookArgs(
  playbook: string,
  sshKeyTempFile: string,
  requiredVars: string[],
  env: Record<string, string> = {},
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

  return [
    "ansible-navigator",
    "run",
    `playbooks/${playbook}`,
    `--container-options=-v=${sshKeyTempFile}:${CONTAINER_SSH_KEY_PATH}:ro`,
    ...penvArgs,
  ];
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
): Promise<void> {
  const args = buildPlaybookArgs(playbook, sshKeyTempFile, requiredVars, env);
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
  // per-host credential sets stay consistent: parsePulumiHosts stamps
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

  log("Ensuring required files...");
  if (!existsSync(EE_DEFINITION_FILE)) {
    throw new Error(
      `execution environment definition not found at ${EE_DEFINITION_FILE}.`,
    );
  }

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

  await prepareWebsiteAssets(config, skipWeb);

  await buildExecutionEnvironment();

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

  const env = buildAnsibleEnv(pulumiHosts, config, requiredVars);

  if (!skipWeb) {
    log("Provisioning web server...");
    await runPlaybook("web.yml", env, sshKeyTempFile, requiredVars);
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
}
