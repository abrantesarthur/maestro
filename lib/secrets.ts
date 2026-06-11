import { createTempSecretFile, removeTempFile } from "./helpers.ts";

/**
 * Setup SSH key temp file with automatic cleanup on process exit
 *
 * @returns The path to the temporary SSH key file
 * @throws Error if VPS_SSH_KEY is not set in environment
 */
export async function setupSshKeyTempFile(): Promise<string> {
  // Stable (non-random) filename: the path lands in Pulumi stack config
  // (sshKeyPath) and inside local.Command create scripts, so it must not
  // change between runs on the same machine or those resources would be
  // replaced on every deploy. The file lives in the per-user temp dir with
  // 0600 permissions and is removed on exit.
  const sshKeyTempFile = await createTempSecretFile(
    "VPS_SSH_KEY",
    "vps_ssh_key",
  );

  const cleanup = async () => {
    await removeTempFile(sshKeyTempFile);
  };

  process.on("exit", () => {
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

  process.on("SIGHUP", async () => {
    await cleanup();
    process.exit(129);
  });

  return sshKeyTempFile;
}

/** Shape of a secret from BWS JSON output */
interface BwsSecret {
  id: string;
  key: string;
  value: string;
  organizationId: string;
  projectId: string | null;
  creationDate: string;
  revisionDate: string;
}

/**
 * Load secrets from Bitwarden Secrets Manager and inject them into process.env
 *
 * @param projectId - Optional project ID to filter secrets
 * @throws Error if BWS_ACCESS_TOKEN is not set or if bws command fails
 */
export async function loadBwsSecrets(projectId?: string): Promise<void> {
  const accessToken = process.env["BWS_ACCESS_TOKEN"];

  if (!accessToken) {
    throw new Error(
      "BWS_ACCESS_TOKEN environment variable is required for Bitwarden Secrets Manager",
    );
  }

  // Build the command arguments - use JSON output for reliable parsing of multi-line values
  const args = ["bws", "secret", "list", "-o", "json"];
  if (projectId) {
    args.push(projectId);
  }

  const proc = Bun.spawn(args, {
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`bws secret list failed: ${stderr || "unknown error"}`);
  }

  // Parse JSON output - handles multi-line values correctly
  const secrets: BwsSecret[] = JSON.parse(stdout);

  for (const secret of secrets) {
    process.env[secret.key] = secret.value;
  }
}

/**
 * Require that a secret exists in process.env (loaded from BWS)
 *
 * @param varName - The environment variable name to check
 * @throws Error if the variable is not set
 */
export function requireBwsSecret(varName: string): void {
  const value = process.env[varName];
  if (!value) {
    throw new Error(`Missing ${varName} from the Bitwarden Secrets Manager.`);
  }
}
