#!/usr/bin/env bun
/**
 * Maestro - Infrastructure orchestration for Pulumi and Ansible
 *
 * Usage:
 *   bun .                    # Run full provisioning
 *   bun . --dry-run          # Validate config and display settings
 */

import { loadConfig, displayConfig } from "./lib/config/index.ts";
import {
  loadBwsSecrets,
  requireBwsSecret,
  setupSshKeyTempFile,
} from "./lib/secrets.ts";
import {
  log,
  requireCmds,
  parseArgs,
  cleanupStaleTempFiles,
} from "./lib/helpers.ts";
import { waitForTunnelsReady } from "./lib/ssh.ts";
import { runPulumi } from "./lib/runPulumi.ts";
import { runAnsible } from "./lib/runAnsible.ts";

// ============================================
// Script Setup
// ============================================

const SCRIPT_DIR = import.meta.dir;
const CONFIG_FILE = `${SCRIPT_DIR}/maestro.yaml`;

// ============================================
// Main Execution
// ============================================

async function main(): Promise<void> {
  log("Parsing arguments...");
  const { dryRun } = parseArgs();

  log("Cleaning up stale temp files...");
  await cleanupStaleTempFiles();

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
    await loadBwsSecrets(config.secrets.projectId);
  }

  log("Ensuring required secrets and variables exist in the environment...");

  if (config.pulumi?.enabled || config.ansible?.enabled) {
    requireBwsSecret("VPS_SSH_KEY");
  }

  if (config.pulumi?.enabled) {
    requireBwsSecret("PULUMI_ACCESS_TOKEN");
    requireBwsSecret("CLOUDFLARE_API_TOKEN");
    requireBwsSecret("DIGITALOCEAN_TOKEN");
  }

  if (config.ansible?.enabled) {
    requireBwsSecret("GHCR_TOKEN");
    requireBwsSecret("GHCR_USERNAME");
  }

  // Validate user-specified BWS secrets from config
  for (const varName of config.secrets?.requiredVars ?? []) {
    requireBwsSecret(varName);
  }

  // Prepare secrets required vars JSON for passing to ansible
  const secretsRequiredVarsJson = JSON.stringify(
    config.secrets?.requiredVars ?? [],
  );

  log("Setting up SSH key...");
  const sshKeyTempFile = await setupSshKeyTempFile();

  const allHosts = await runPulumi(config, sshKeyTempFile);

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
}

// Run main
main().catch((error) => {
  console.error(`[maestro] Error: ${error.message}`);
  process.exit(1);
});
