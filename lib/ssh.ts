/**
 * SSH tunnel utilities for Cloudflare tunnel connections
 */

import { log } from "./helpers.ts";

export interface HostInfo {
  hostname: string;
  roles?: string[];
  tags?: string[];
  effective_domain?: string;
  postgresHost?: string;
  postgresPort?: string;
  postgresPassword?: string;
  /** Cluster admin (doadmin) creds — used only to grant the app user privileges. */
  postgresAdminUser?: string;
  postgresAdminPassword?: string;
}

export interface PulumiHosts {
  hosts: HostInfo[];
}

/** Strict DNS-label pattern; rejects shell metacharacters before host is interpolated into ssh ProxyCommand (which runs via /bin/sh -c). */
const VALID_HOSTNAME = /^[A-Za-z0-9.-]+$/;

/**
 * Strip ANSI/terminal control sequences from captured Pulumi output.
 *
 * When the Pulumi container is run with a TTY attached (`docker run -it`),
 * Pulumi believes it is driving a real terminal and emits control sequences to
 * stdout — CSI sequences (colors, cursor moves, `ESC[6n` cursor-position
 * reports) and OSC sequences (e.g. `ESC]11;?BEL` background-color queries).
 * These bytes interleave with the `pulumi stack output --json` block, so the
 * slice between the output markers is no longer valid JSON and `JSON.parse`
 * fails with "Unrecognized token ''". Removing them makes parsing robust
 * regardless of whether a TTY was attached.
 */
function stripAnsi(input: string): string {
  return (
    input
      // OSC: ESC ] ... (BEL | ESC \)
      .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "")
      // CSI: ESC [ ... final byte, and other two-byte ESC sequences
      .replace(/\x1b[@-Z\\-_]|\x1b\[[0-?]*[ -/]*[@-~]/g, "")
      // Any remaining lone ESC or BEL bytes
      .replace(/[\x1b\x07]/g, "")
  );
}

/**
 * Wait for a single tunnel to become reachable via SSH through cloudflared
 *
 * @param host - The hostname to connect to
 * @param sshKeyPath - Path to the SSH private key file
 * @param attempts - Maximum number of connection attempts
 * @param delayMs - Delay between attempts in milliseconds
 * @throws Error if the tunnel is not reachable after all attempts
 */
export async function waitForTunnel(
  host: string,
  sshKeyPath: string,
  attempts: number = 30,
  delayMs: number = 10000,
): Promise<void> {
  if (!VALID_HOSTNAME.test(host)) {
    throw new Error(`Refusing to connect: invalid hostname ${host}`);
  }

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = Bun.spawnSync(
      [
        "ssh",
        "-o",
        `ProxyCommand=cloudflared access ssh --hostname ${host}`,
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=5",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        "-i",
        sshKeyPath,
        `root@${host}`,
        "exit",
      ],
      {
        stdout: "ignore",
        stderr: "ignore",
      },
    );

    if (result.exitCode === 0) {
      log(`Tunnel reachable: ${host}`);
      return;
    }

    log(
      `Waiting for tunnel ${host} to become reachable (attempt ${attempt}/${attempts})...`,
    );
    await Bun.sleep(delayMs);
  }

  throw new Error(`Tunnel ${host} not reachable after ${attempts} attempts.`);
}

/**
 * Wait for all tunnels in the Pulumi hosts JSON to become reachable
 *
 * @param pulumiHosts - The hosts JSON from Pulumi output
 * @param sshKeyPath - Path to the SSH private key file
 * @throws Error if any tunnel is not reachable or if no hostnames found
 */
export async function waitForTunnelsReady(
  pulumiHosts: PulumiHosts,
  sshKeyPath: string,
): Promise<void> {
  const hostnames =
    pulumiHosts.hosts?.map((h) => h.hostname).filter((h): h is string => !!h) ??
    [];

  if (hostnames.length === 0) {
    throw new Error("No tunnel hostnames found in PULUMI_HOSTS.");
  }

  for (const hostname of hostnames) {
    await waitForTunnel(hostname, sshKeyPath);
  }
}

/**
 * Parse Pulumi output to extract hosts JSON
 * Looks for content between __PULUMI_OUTPUTS_BEGIN__ and __PULUMI_OUTPUTS_END__ markers
 *
 * @param output - The raw stdout from Pulumi
 * @returns Parsed hosts object
 * @throws Error if parsing fails
 */
export function parsePulumiHosts(output: string): PulumiHosts {
  const beginMarker = "__PULUMI_OUTPUTS_BEGIN__";
  const endMarker = "__PULUMI_OUTPUTS_END__";

  // Drop terminal control sequences first; when Pulumi runs under a TTY they get
  // interleaved into the output (including the JSON block) and break JSON.parse.
  output = stripAnsi(output);

  const beginIndex = output.indexOf(beginMarker);
  const endIndex = output.indexOf(endMarker);

  if (beginIndex === -1 || endIndex === -1) {
    throw new Error("Could not find Pulumi output markers in stdout");
  }

  const jsonStr = output
    .slice(beginIndex + beginMarker.length, endIndex)
    .trim();

  try {
    const parsed = JSON.parse(jsonStr);
    const hosts: HostInfo[] = parsed.hosts ?? [];

    // If this stack provisioned a database, copy its connection details onto the
    // stack's backend hosts so each backend reaches its own database. (USER/DB are
    // set globally elsewhere; only HOST/PORT/PASSWORD are per-stack here.)
    const postgres = parsed.postgres;
    if (postgres?.host) {
      for (const host of hosts) {
        if (host.tags?.includes("backend")) {
          host.postgresHost = postgres.host;
          host.postgresPort = String(postgres.port);
          host.postgresPassword = postgres.password;
          // Only when present, so older stacks don't get undefined keys.
          if (postgres.adminUser) host.postgresAdminUser = postgres.adminUser;
          if (postgres.adminPassword)
            host.postgresAdminPassword = postgres.adminPassword;
        }
      }
    }

    return { hosts };
  } catch (e) {
    throw new Error(`Failed to parse Pulumi hosts JSON: ${e}`);
  }
}

/**
 * Merge hosts from multiple Pulumi stacks
 *
 * @param existing - Existing hosts object
 * @param newHosts - New hosts to merge
 * @returns Merged hosts object
 */
export function mergeHosts(
  existing: PulumiHosts,
  newHosts: PulumiHosts,
): PulumiHosts {
  return {
    hosts: [...existing.hosts, ...(newHosts.hosts ?? [])],
  };
}
