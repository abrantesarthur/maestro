#!/usr/bin/env bun
/**
 * Maestro - Infrastructure orchestration for Pulumi and Ansible
 *
 * Usage:
 *   maestro                       # Run full provisioning (./maestro.yaml)
 *   maestro --config <path>       # Use a config file elsewhere
 *   maestro --dry-run             # Validate config and display settings
 *
 * (When developing maestro itself: `bun index.ts` from the repo root.)
 */

import { resolve } from "node:path";
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
// Main Execution
// ============================================

async function main(): Promise<void> {
  log("Parsing arguments...");
  const { dryRun, configPath } = parseArgs();

  // Config lives with the consuming app: resolve --config (default
  // ./maestro.yaml) against the invocation cwd, not maestro's install dir.
  const configFile = resolve(process.cwd(), configPath);

  log("Cleaning up stale temp files...");
  await cleanupStaleTempFiles();

  log("Ensuring required commands exist...");
  // `pulumi` is driven in-process via the Automation API, which shells out to
  // the host CLI; `docker` is still required by the Ansible execution env.
  requireCmds(["bws", "cloudflared", "pulumi"]);

  log(`Loading configuration from ${configFile}...`);
  const config = await loadConfig(configFile);

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
    requireBwsSecret("DIGITALOCEAN_ACCESS_TOKEN");
  }

  // POSTGRES_HOST, POSTGRES_PORT, and POSTGRES_PASSWORD are DigitalOcean-derived Pulumi outputs
  if (config.pulumi?.database?.enabled) {
    requireBwsSecret("POSTGRES_USER");
    requireBwsSecret("POSTGRES_DB");
  }

  if (config.ansible?.enabled) {
    requireBwsSecret("GHCR_TOKEN");
    requireBwsSecret("GHCR_USERNAME");
  }

  // Validate user-specified BWS secrets from config
  for (const varName of config.secrets?.requiredVars ?? []) {
    requireBwsSecret(varName);
  }

  // Secrets required vars to forward to ansible playbooks
  const secretsRequiredVars = config.secrets?.requiredVars ?? [];

  log("Setting up SSH key...");
  const sshKeyTempFile = await setupSshKeyTempFile();

  const allHosts = await runPulumi(config, sshKeyTempFile);

  const hasValidHosts = allHosts.hosts.length > 0;
  const isDestroy = config.pulumi?.command === "destroy";
  if (config.ansible?.enabled && hasValidHosts && !isDestroy) {
    log("Checking tunnel readiness before running Ansible...");
    await waitForTunnelsReady(allHosts, sshKeyTempFile);

    log("Provisioning ansible...");
    await runAnsible(allHosts, config, sshKeyTempFile, secretsRequiredVars);
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
