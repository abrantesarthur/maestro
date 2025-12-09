#!/usr/bin/env bun
/**
 * Maestro - Infrastructure orchestration for Pulumi and Ansible
 *
 * Usage:
 *   bun .                    # Run full provisioning
 *   bun . --dry-run          # Validate config and display settings
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadConfig,
  displayConfig,
  type LoadedConfig,
  type StackName,
} from "./lib/config.js";
import { loadBwsSecrets } from "./lib/secrets.js";
import {
  log,
  requireCmd,
  requireVar,
  requireBwsVar,
  createTempSecretFile,
  removeTempFile,
  runCommandWithTee,
} from "./lib/helpers.js";
import {
  parsePulumiHosts,
  mergeHosts,
  waitForTunnelsReady,
  type PulumiHosts,
} from "./lib/ssh.js";

// ============================================
// Script Setup
// ============================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PULUMI_RUN = resolve(__dirname, "pulumi/run.sh");
const ANSIBLE_RUN = resolve(__dirname, "ansible/run.sh");
const CONFIG_FILE = resolve(__dirname, "maestro.yaml");

// ============================================
// CLI Parsing
// ============================================

function parseArgs(): { dryRun: boolean } {
  const args = Bun.argv.slice(2);

  for (const arg of args) {
    if (arg === "--dry-run") {
      continue;
    }
    console.error(`Unknown option: ${arg}`);
    console.error(`Usage: bun . [--dry-run]`);
    process.exit(1);
  }

  return {
    dryRun: args.includes("--dry-run"),
  };
}

// ============================================
// Pulumi Orchestration
// ============================================

async function capturePulumiHosts(
  stackName: StackName,
  pulumiCommand: string,
  serversJson: string,
  config: LoadedConfig,
  sshKeyPath: string,
  showLogs: boolean = true,
): Promise<PulumiHosts> {
  const env: Record<string, string> = {
    DOMAIN: config.domain,
    CLOUDFLARE_ACCOUNT_ID: config.pulumi.cloudflareAccountId,
    SSH_PORT: String(config.pulumi.sshPort),
    BACKEND_PORT: String(config.ansible.backend.port),
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
  config: LoadedConfig,
  secretsRequiredVarsJson: string,
): Promise<void> {
  const env: Record<string, string> = {
    DOMAIN: config.domain,
    BACKEND_PORT: String(config.ansible.backend.port),
    BACKEND_IMAGE: config.ansible.backend.image,
    BACKEND_IMAGE_TAG: config.ansible.backend.tag,
    WEB_MODE: config.ansible.web.mode ?? "",
    WEB_STATIC_SOURCE: config.ansible.web.static.source,
    WEB_STATIC_DIR: config.ansible.web.static.dir,
    WEB_STATIC_BUILD: config.ansible.web.static.build,
    WEB_STATIC_DIST: config.ansible.web.static.dist,
    WEB_STATIC_IMAGE: config.ansible.web.static.image,
    WEB_STATIC_TAG: config.ansible.web.static.tag,
    WEB_STATIC_PATH: config.ansible.web.static.path,
    WEB_DOCKER_IMAGE: config.ansible.web.docker.image,
    WEB_DOCKER_TAG: config.ansible.web.docker.tag,
    WEB_DOCKER_PORT: String(config.ansible.web.docker.port),
    MANAGED_GROUPS: JSON.stringify(config.ansible.groups),
    SECRETS_REQUIRED_VARS_JSON: secretsRequiredVarsJson,
  };

  // Export backend environment variables (BACKEND_ENV_*)
  for (const [key, value] of Object.entries(config.ansible.backend.env)) {
    env[`BACKEND_ENV_${key}`] = value;
  }

  // Auto-inject PORT into the container environment from backend.port
  env["BACKEND_ENV_PORT"] = String(config.ansible.backend.port);

  // Export web docker environment variables (WEB_DOCKER_ENV_*)
  for (const [key, value] of Object.entries(config.ansible.web.docker.env)) {
    env[`WEB_DOCKER_ENV_${key}`] = value;
  }

  const args = [
    ANSIBLE_RUN,
    "--ssh-hosts",
    JSON.stringify(pulumiHosts),
    "--skip-bws",
  ];

  // Role-based provisioning: skip playbooks if no server has that role
  if (!config.roles.hasWeb) {
    args.push("--skip-web");
  }
  if (!config.roles.hasBackend) {
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
  requireCmd("bws");
  requireCmd("cloudflared");

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

  if (config.secrets.provider === "bws") {
    log("Fetching secrets from Bitwarden...");
    await loadBwsSecrets(config.secrets.projectId || undefined);
  }

  log("Ensuring required secrets and variables exist in the environment...");
  requireBwsVar("GHCR_TOKEN");
  requireBwsVar("VPS_SSH_KEY");

  if (config.pulumi.enabled || config.ansible.enabled) {
    requireBwsVar("PULUMI_ACCESS_TOKEN");
  }

  if (config.pulumi.enabled) {
    requireBwsVar("CLOUDFLARE_API_TOKEN");
    requireBwsVar("DIGITALOCEAN_TOKEN");
  }

  if (config.ansible.enabled) {
    requireBwsVar("GHCR_USERNAME");
  }

  // Validate user-specified BWS secrets from config
  for (const varName of config.secrets.requiredVars) {
    requireBwsVar(varName);
  }

  // Prepare secrets required vars JSON for passing to ansible
  const secretsRequiredVarsJson = JSON.stringify(config.secrets.requiredVars);

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

    if (config.pulumi.enabled) {
      log(`Provisioning ${config.pulumi.stackNames.length} stack(s)...`);

      for (const stackName of config.pulumi.stackNames) {
        log(`Provisioning stack: ${stackName}`);
        const stack = config.pulumi.stacks[stackName];
        const serversJson = JSON.stringify(stack?.servers ?? []);

        const stackHosts = await capturePulumiHosts(
          stackName,
          config.pulumi.command,
          serversJson,
          config,
          sshKeyTempFile,
        );

        allHosts = mergeHosts(allHosts, stackHosts);
      }
    } else if (config.ansible.enabled) {
      log("Fetching existing Pulumi outputs for Ansible...");

      for (const stackName of config.pulumi.stackNames) {
        const stack = config.pulumi.stacks[stackName];
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

    if (config.ansible.enabled && hasValidHosts) {
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
