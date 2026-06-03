import { type StackName, type MaestroConfig } from "./config/index.ts";
import { log, requireVar, runCommand, runCommandWithTee } from "./helpers.ts";
import { requireBwsSecret } from "./secrets.ts";
import { parsePulumiHosts, mergeHosts, type PulumiHosts } from "./ssh.ts";

const SCRIPT_DIR = import.meta.dir.replace(/\/lib$/, "");
const IMAGE_NAME = "maestro_pulumi";
const BUILD_CONTEXT = `${SCRIPT_DIR}/pulumi/image`;
/** Path the SSH private key is mounted to inside the container */
const PULUMI_SSH_KEY_PATH = "/root/.ssh/id_rsa";

/** Pulumi commands that don't need cloud provider credentials or the SSH key */
function needsProviderCreds(pulumiCommand: string): boolean {
  return pulumiCommand !== "output";
}

/**
 * Build the Docker image used to run Pulumi.
 *
 * @throws Error if the build fails (with Docker's combined output)
 */
async function buildPulumiImage(): Promise<void> {
  log(`Building Docker image ${IMAGE_NAME}...`);
  const { exitCode, stdout, stderr } = await runCommand(
    ["docker", "build", "-t", IMAGE_NAME, BUILD_CONTEXT],
    { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );

  if (exitCode !== 0) {
    throw new Error(
      `Failed to build Docker image "${IMAGE_NAME}". Docker responded with:\n${stderr || stdout}`,
    );
  }
}

/**
 * Assemble the `docker run` argv for the Pulumi container.
 *
 * Mirrors pulumi/run.sh: provider credentials and the SSH key mount are only
 * added when the command actually needs them (everything except `output`).
 *
 * `interactive` allocates a TTY (`-t`) and keeps stdin open (`-i`). It must only
 * be set on the streaming (`showLogs`) path that inherits the user's real TTY;
 * the silent capture path pipes stdout, where `docker run -t` would abort with
 * "the input device is not a TTY".
 */
export function buildPulumiRunArgs(
  pulumiCommand: string,
  env: Record<string, string>,
  sshKeyPath: string,
  interactive: boolean,
): string[] {
  const withProviderCreds = needsProviderCreds(pulumiCommand);

  // PULUMI_ACCESS_TOKEN, CLOUDFLARE_API_TOKEN and DIGITALOCEAN_TOKEN are read
  // directly from process.env (where the secrets layer injects them) rather than
  // threaded through `env`. This sourcing difference is intentional.
  const dockerEnv = [
    "-e",
    `DOMAIN=${env["DOMAIN"] ?? ""}`,
    "-e",
    `BACKEND_PORT=${env["BACKEND_PORT"] ?? ""}`,
    "-e",
    `SSH_PORT=${env["SSH_PORT"] ?? ""}`,
    "-e",
    `CLOUDFLARE_ACCOUNT_ID=${env["CLOUDFLARE_ACCOUNT_ID"] ?? ""}`,
    "-e",
    `PULUMI_ACCESS_TOKEN=${process.env["PULUMI_ACCESS_TOKEN"] ?? ""}`,
    "-e",
    `PULUMI_COMMAND=${pulumiCommand}`,
    "-e",
    `PULUMI_PROJECT_NAME=${env["PULUMI_PROJECT_NAME"] ?? ""}`,
    "-e",
    `PULUMI_STACK=${env["PULUMI_STACK"] ?? ""}`,
    "-e",
    `PULUMI_SSH_KEY_PATH=${PULUMI_SSH_KEY_PATH}`,
    "-e",
    `PULUMI_SERVERS_JSON=${env["PULUMI_SERVERS_JSON"] || "[]"}`,
  ];

  const args = ["docker", "run", ...(interactive ? ["-it"] : []), "--rm"];

  if (withProviderCreds) {
    dockerEnv.push(
      "-e",
      `CLOUDFLARE_API_TOKEN=${process.env["CLOUDFLARE_API_TOKEN"] ?? ""}`,
      "-e",
      `DIGITALOCEAN_TOKEN=${process.env["DIGITALOCEAN_TOKEN"] ?? ""}`,
    );
    args.push("-v", `${sshKeyPath}:${PULUMI_SSH_KEY_PATH}:ro`);
  }

  args.push(...dockerEnv, IMAGE_NAME);
  return args;
}

/**
 * Validate the configuration and secrets required to run the Pulumi container.
 *
 * @throws Error if any required value is missing
 */
function validatePulumiRequirements(
  pulumiCommand: string,
  env: Record<string, string>,
): void {
  log("Ensuring required configuration from environment...");
  requireVar(env["DOMAIN"], "DOMAIN is required (set in maestro.yaml).");
  requireVar(
    env["CLOUDFLARE_ACCOUNT_ID"],
    "CLOUDFLARE_ACCOUNT_ID is required (set in maestro.yaml).",
  );
  requireVar(
    env["PULUMI_PROJECT_NAME"],
    "PULUMI_PROJECT_NAME is required (set in maestro.yaml).",
  );
  requireVar(env["SSH_PORT"], "SSH_PORT is required (set in maestro.yaml).");
  requireVar(
    env["BACKEND_PORT"],
    "BACKEND_PORT is required (set in maestro.yaml).",
  );
  requireVar(
    env["PULUMI_STACK"],
    "PULUMI_STACK is required (derived from maestro.yaml stacks).",
  );

  log("Ensuring required secrets...");
  requireBwsSecret("PULUMI_ACCESS_TOKEN");
  if (needsProviderCreds(pulumiCommand)) {
    requireBwsSecret("CLOUDFLARE_API_TOKEN");
    requireBwsSecret("DIGITALOCEAN_TOKEN");
  }
  requireBwsSecret("VPS_SSH_KEY");
}

/**
 * Provision (or read outputs for) a single Pulumi stack and return its hosts.
 *
 * The command is derived from config: when Pulumi is enabled we run the
 * configured command (`up`, `destroy`, …) and stream logs; when it's disabled
 * but Ansible still needs host data, we fall back to a silent `output`.
 */
async function runPulumiStack(
  stackName: StackName,
  config: MaestroConfig,
  sshKeyPath: string,
): Promise<PulumiHosts> {
  const { pulumi } = config;
  const pulumiCommand =
    pulumi?.enabled && pulumi.command ? pulumi.command : "output";
  const showLogs = pulumi?.enabled ?? false;
  const serversJson = JSON.stringify(
    pulumi?.stacks?.[stackName]?.servers ?? [],
  );

  const env: Record<string, string> = {
    DOMAIN: config.domain,
    CLOUDFLARE_ACCOUNT_ID: pulumi?.cloudflareAccountId ?? "",
    SSH_PORT: String(pulumi?.sshPort ?? ""),
    BACKEND_PORT: String(config?.ansible?.backend?.port ?? ""),
    PULUMI_PROJECT_NAME: pulumi?.projectName ?? "",
    PULUMI_STACK: stackName,
    PULUMI_SERVERS_JSON: serversJson,
  };

  validatePulumiRequirements(pulumiCommand, env);

  await buildPulumiImage();

  log(`Running the ${IMAGE_NAME} image...`);
  const args = buildPulumiRunArgs(pulumiCommand, env, sshKeyPath, showLogs);

  let stdout: string;
  if (showLogs) {
    // Run with output streamed to console (tee-like behavior)
    const result = await runCommandWithTee(args);
    if (result.exitCode !== 0) {
      throw new Error(
        `Pulumi command failed with exit code ${result.exitCode}`,
      );
    }
    stdout = result.stdout;
  } else {
    // Run silently, capture output
    const result = await runCommand(args, {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `Pulumi command failed with exit code ${result.exitCode}`,
      );
    }
    stdout = result.stdout;
  }

  // destroy command has no hosts to parse
  if (pulumiCommand === "destroy") {
    return { hosts: [] };
  }

  return parsePulumiHosts(stdout);
}

export async function runPulumi(
  config: MaestroConfig,
  sshKeyTempFile: string,
): Promise<PulumiHosts> {
  const stackNames = Object.keys(config.pulumi?.stacks ?? {}) as StackName[];

  if (!config.pulumi?.enabled && !config.ansible?.enabled) {
    log("Skipping pulumi provisioning");
    return { hosts: [] };
  }

  if (config.pulumi?.enabled) {
    log(`Provisioning ${stackNames.length} stack(s)...`);
  } else {
    log("Fetching existing Pulumi outputs for Ansible...");
  }

  let allHosts: PulumiHosts = { hosts: [] };
  for (const stackName of stackNames) {
    if (config.pulumi?.enabled) {
      log(`Provisioning stack: ${stackName}`);
    }
    const stackHosts = await runPulumiStack(stackName, config, sshKeyTempFile);
    allHosts = mergeHosts(allHosts, stackHosts);
  }

  return allHosts;
}
