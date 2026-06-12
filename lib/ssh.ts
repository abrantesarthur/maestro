/**
 * SSH tunnel utilities for Cloudflare tunnel connections
 */

import { log } from "./helpers.ts";
import { type PulumiHosts } from "./hosts.ts";

/** Strict DNS-label pattern; rejects shell metacharacters before host is interpolated into ssh ProxyCommand (which runs via /bin/sh -c). */
const VALID_HOSTNAME = /^[A-Za-z0-9.-]+$/;

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
