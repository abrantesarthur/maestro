/**
 * Bitwarden Secrets Manager integration
 *
 * Uses the bws CLI to fetch secrets and inject them into process.env.
 * This approach matches the original bash behavior and works with
 * project-scoped access tokens.
 */

/**
 * Load secrets from Bitwarden Secrets Manager and inject them into process.env
 *
 * @param projectId - Optional project ID to filter secrets
 * @throws Error if BWS_ACCESS_TOKEN is not set or if bws command fails
 */
export async function loadBwsSecrets(projectId?: string): Promise<void> {
  const accessToken = process.env.BWS_ACCESS_TOKEN;

  if (!accessToken) {
    throw new Error(
      "BWS_ACCESS_TOKEN environment variable is required for Bitwarden Secrets Manager",
    );
  }

  // Build the command arguments
  const args = ["bws", "secret", "list", "-o", "env"];
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

  // Parse the env output format (KEY=value lines)
  // The bws CLI with -o env outputs in shell-compatible format
  const lines = stdout.trim().split("\n");

  for (const line of lines) {
    if (!line || line.startsWith("#")) {
      continue;
    }

    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }

    const key = line.slice(0, eqIndex);
    let value = line.slice(eqIndex + 1);

    // Remove surrounding quotes if present (bws outputs quoted values)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Handle escaped characters in the value
    value = value
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\r")
      .replace(/\\\\/g, "\\")
      .replace(/\\"/g, '"');

    process.env[key] = value;
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
    throw new Error(`Missing ${varName} from the bws response.`);
  }
}
