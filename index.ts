#!/usr/bin/env bun
/**
 * Maestro - Infrastructure orchestration for Pulumi and Ansible
 *
 * Usage:
 *   bun .                    # Run full provisioning
 *   bun . --dry-run          # Validate config and display settings
 */

import {
  loadConfig,
  displayConfig,
  type StackName,
  ServerRole,
  type MaestroConfig,
} from "./lib/config";
import { loadBwsSecrets } from "./lib/secrets.ts";
import {
  log,
  requireCmds,
  requireBwsVar,
  createTempSecretFile,
  removeTempFile,
  runCommandWithTee,
  parseArgs,
} from "./lib/helpers.ts";
import {
  parsePulumiHosts,
  mergeHosts,
  waitForTunnelsReady,
  type PulumiHosts,
} from "./lib/ssh.ts";

// ============================================
// Script Setup
// ============================================

const SCRIPT_DIR = import.meta.dir;
const PULUMI_RUN = `${SCRIPT_DIR}/pulumi/run.sh`;
const ANSIBLE_RUN = `${SCRIPT_DIR}/ansible/run.sh`;
const CONFIG_FILE = `${SCRIPT_DIR}/maestro.yaml`;

// ============================================
// Pulumi Orchestration
// ============================================

async function capturePulumiHosts(
  stackName: StackName,
  pulumiCommand: string,
  serversJson: string,
  config: MaestroConfig,
  _sshKeyPath: string,
  showLogs: boolean = true,
): Promise<PulumiHosts> {
  const { pulumi } = config;
  const env: Record<string, string> = {
    DOMAIN: config.domain,
    CLOUDFLARE_ACCOUNT_ID: pulumi?.cloudflareAccountId ?? "",
    SSH_PORT: String(pulumi?.sshPort ?? ""),
    BACKEND_PORT: String(config?.ansible?.backend?.port ?? ""),
    PULUMI_STACK: stackName,
    PULUMI_SERVERS_JSON: serversJson,
  };

  const args = [PULUMI_RUN, "--command", pulumiCommand, "--skip-bws"];

  if (showLogs) {
    // Run with output streamed to console (tee-like behavior)
    const { stdout, exitCode } = await runCommandWithTee(args, env);

    if (exitCode !== 0) {
      throw new Error(`Pulumi command failed with exit code ${exitCode}`);
    }

    return parsePulumiHosts(stdout);
  } else {
    // Run silently, capture output
    const proc = Bun.spawn(args, {
      env: { ...process.env, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new Error(`Pulumi command failed with exit code ${exitCode}`);
    }

    return parsePulumiHosts(stdout);
  }
}

// ============================================
// Ansible Orchestration
// ============================================

async function runAnsible(
  pulumiHosts: PulumiHosts,
  config: MaestroConfig,
  secretsRequiredVarsJson: string,
): Promise<void> {
  const { ansible } = config;
  const env: Record<string, string> = {
    DOMAIN: config.domain,
    BACKEND_PORT: String(ansible?.backend?.port),
    BACKEND_IMAGE: ansible?.backend?.image ?? "",
    BACKEND_IMAGE_TAG: ansible?.backend?.tag ?? "",
    WEB_MODE: ansible?.web?.docker
      ? "docker"
      : ansible?.web?.static
      ? "static"
      : "",
    // FIXME: ensure empty value is ok
    WEB_STATIC_SOURCE: ansible?.web?.static?.source ?? "",
    WEB_STATIC_DIR: ansible?.web?.static?.dir ?? "",
    WEB_STATIC_BUILD: ansible?.web?.static?.build ?? "",
    WEB_STATIC_DIST: ansible?.web?.static?.dist ?? "",
    WEB_STATIC_IMAGE: ansible?.web?.static?.image ?? "",
    WEB_STATIC_TAG: ansible?.web?.static?.tag ?? "",
    WEB_STATIC_PATH: ansible?.web?.static?.path ?? "",
    WEB_DOCKER_IMAGE: ansible?.web?.docker?.image ?? "",
    WEB_DOCKER_TAG: ansible?.web?.docker?.tag ?? "",
    WEB_DOCKER_PORT: String(ansible?.web?.docker?.port),
    MANAGED_GROUPS: JSON.stringify(ansible?.groups ?? []),
    SECRETS_REQUIRED_VARS_JSON: secretsRequiredVarsJson,
  };

  // Export backend environment variables (BACKEND_ENV_*)
  for (const [key, value] of Object.entries(
    config.ansible?.backend?.env ?? {},
  )) {
    env[`BACKEND_ENV_${key}`] = value;
  }

  // Auto-inject PORT into the container environment from backend.port
  env["BACKEND_ENV_PORT"] = String(config.ansible?.backend?.port ?? "");

  // Export web docker environment variables (WEB_DOCKER_ENV_*)
  for (const [key, value] of Object.entries(
    config?.ansible?.web?.docker?.env ?? {},
  )) {
    env[`WEB_DOCKER_ENV_${key}`] = value;
  }

  const args = [
    ANSIBLE_RUN,
    "--ssh-hosts",
    JSON.stringify(pulumiHosts),
    "--skip-bws",
  ];

  // Role-based provisioning: skip playbooks if no server has that role
  let roles = Object.values(config?.pulumi?.stacks ?? {})
    .flatMap((s) => s.servers.flatMap((srv) => srv.roles))
    .reduce((prev, curr) => prev.add(curr), new Set<ServerRole>());
  if (!Array.from(roles).includes(ServerRole.Web)) {
    args.push("--skip-web");
  }
  if (!Array.from(roles).includes(ServerRole.Backend)) {
    args.push("--skip-backend");
  }

  const proc = Bun.spawn(args, {
    env: { ...process.env, ...env },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`Ansible command failed with exit code ${exitCode}`);
  }
}

// ============================================
// Main Execution
// ============================================

async function main(): Promise<void> {
  const { dryRun } = parseArgs();

  log("Parsing arguments...");

  log("Ensuring required commands exist...");
  requireCmds(["bws", "cloudflared"]);

  log(`Loading configuration from ${CONFIG_FILE}...`);
  const config = await loadConfig(CONFIG_FILE);

  if (dryRun) {
    log("Dry-run mode enabled. Configuration loaded:");
    displayConfig(config);
    process.exit(0);
  }

  // ============================================
  // Fetch secrets from Bitwarden
  // ============================================

  if (config.secrets?.provider === "bws") {
    log("Fetching secrets from Bitwarden...");
    await loadBwsSecrets(config.secrets.projectId || undefined);
  }

  log("Ensuring required secrets and variables exist in the environment...");
  requireBwsVar("GHCR_TOKEN");
  requireBwsVar("VPS_SSH_KEY");

  if (config.pulumi?.enabled || config.ansible?.enabled) {
    requireBwsVar("PULUMI_ACCESS_TOKEN");
  }

  if (config.pulumi?.enabled) {
    requireBwsVar("CLOUDFLARE_API_TOKEN");
    requireBwsVar("DIGITALOCEAN_TOKEN");
  }

  if (config.ansible?.enabled) {
    requireBwsVar("GHCR_USERNAME");
  }

  // Validate user-specified BWS secrets from config
  for (const varName of config.secrets?.requiredVars ?? []) {
    requireBwsVar(varName);
  }

  // Prepare secrets required vars JSON for passing to ansible
  const secretsRequiredVarsJson = JSON.stringify(
    config.secrets?.requiredVars ?? [],
  );

  // ============================================
  // Setup SSH key temp file
  // ============================================

  log("Setting up SSH key...");
  const sshKeyTempFile = await createTempSecretFile("VPS_SSH_KEY");

  // Ensure cleanup on exit
  const cleanup = async () => {
    await removeTempFile(sshKeyTempFile);
  };

  process.on("exit", () => {
    // Sync cleanup for exit event
    Bun.spawnSync(["rm", "-f", sshKeyTempFile]);
  });

  process.on("SIGINT", async () => {
    await cleanup();
    process.exit(130);
  });

  process.on("SIGTERM", async () => {
    await cleanup();
    process.exit(143);
  });

  try {
    // ============================================
    // Run Pulumi provisioning
    // ============================================

    let allHosts: PulumiHosts = { hosts: [] };

    const stackNames = Object.keys(config.pulumi?.stacks ?? {}) as StackName[];
    if (config.pulumi?.enabled) {
      log(`Provisioning ${stackNames.length} stack(s)...`);

      for (const stackName of stackNames) {
        log(`Provisioning stack: ${stackName}`);
        const stack = config.pulumi?.stacks?.[stackName];
        const serversJson = JSON.stringify(stack?.servers ?? []);

        const stackHosts = await capturePulumiHosts(
          stackName,
          config.pulumi?.command!,
          serversJson,
          config,
          sshKeyTempFile,
        );

        allHosts = mergeHosts(allHosts, stackHosts);
      }
    } else if (config.ansible?.enabled) {
      log("Fetching existing Pulumi outputs for Ansible...");

      for (const stackName of stackNames) {
        const stack = config.pulumi?.stacks?.[stackName];
        const serversJson = JSON.stringify(stack?.servers ?? []);

        const stackHosts = await capturePulumiHosts(
          stackName,
          "output",
          serversJson,
          config,
          sshKeyTempFile,
          false, // don't show logs for output-only
        );

        allHosts = mergeHosts(allHosts, stackHosts);
      }
    } else {
      log("Skipping pulumi provisioning");
    }

    // ============================================
    // Run Ansible provisioning
    // ============================================

    const hasValidHosts = allHosts.hosts.length > 0;

    if (config.ansible?.enabled && hasValidHosts) {
      log("Checking tunnel readiness before running Ansible...");
      await waitForTunnelsReady(allHosts, sshKeyTempFile);

      log("Provisioning ansible...");
      await runAnsible(allHosts, config, secretsRequiredVarsJson);
    } else {
      log("Skipping ansible provisioning");
    }

    log("Done.");
  } finally {
    await cleanup();
  }
}

// Run main
main().catch((error) => {
  console.error(`[maestro] Error: ${error.message}`);
  process.exit(1);
});
