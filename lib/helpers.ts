/**
 * Helper utilities for Maestro
 * Logging, command checking, temp file management
 */

import { $ } from "bun";

// ============================================
// CLI Parsing
// ============================================

export function parseArgs(): { dryRun: boolean } {
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
// Logging
// ============================================

/**
 * Create a logger with a specific prefix
 */
function createLogger(prefix: string): (message: string) => void {
  return (message: string) => {
    console.log(`[${prefix}] ${message}`);
  };
}
export const log = createLogger("maestro");

// ============================================
// Requirement Checks
// ============================================

/**
 * Require that a command exists in PATH
 *
 * @param cmd - The command to check
 * @throws Error if the command is not found
 */
export function requireCmds(cmds: string[]): void {
  for (const cmd of cmds) {
    const result = Bun.spawnSync(["which", cmd], {
      stdout: "pipe",
      stderr: "pipe",
    });

    if (result.exitCode !== 0) {
      throw new Error(`Error: required command '${cmd}' not found in PATH.`);
    }
  }
}

/**
 * Require that a variable has a value
 *
 * @param value - The value to check
 * @param message - Error message if the value is empty
 * @throws Error if the value is empty or undefined
 */
export function requireVar(
  value: string | undefined | null,
  message: string,
): asserts value is string {
  if (!value) {
    throw new Error(message);
  }
}

/**
 * Require that an environment variable exists (loaded from BWS)
 *
 * @param varName - The environment variable name to check
 * @throws Error if the variable is not set
 */
export function requireBwsVar(varName: string): void {
  const value = process.env[varName];
  if (!value) {
    throw new Error(`Missing ${varName} from the bws response.`);
  }
}

// ============================================
// Temp File Management
// ============================================

/**
 * Create a temporary file with a secret value from an environment variable
 * Normalizes escaped newlines and ensures proper permissions
 *
 * @param varName - The environment variable containing the secret
 * @returns The path to the temporary file
 * @throws Error if the variable is not set
 */
export async function createTempSecretFile(varName: string): Promise<string> {
  const secretValue = process.env[varName];

  if (!secretValue) {
    throw new Error(`Missing ${varName} in the environment.`);
  }

  const tmpPath = `/tmp/maestro_${varName.toLowerCase()}_${Date.now()}`;

  // Normalize escaped newlines, strip CRs, and ensure a trailing newline for OpenSSH
  const normalizedValue =
    secretValue.replace(/\\n/g, "\n").replace(/\r/g, "") + "\n";

  await Bun.write(tmpPath, normalizedValue);

  // Set restrictive permissions (chmod 600)
  Bun.spawnSync(["chmod", "600", tmpPath]);

  return tmpPath;
}

/**
 * Remove a temporary file
 *
 * @param path - The path to the file to remove
 */
export async function removeTempFile(path: string): Promise<void> {
  try {
    await $`rm -f ${path}`.quiet();
  } catch {
    // Ignore errors when removing temp files
  }
}

// ============================================
// Process Utilities
// ============================================

export interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a shell command and capture output
 *
 * @param args - Command and arguments
 * @param options - Spawn options
 * @returns The spawn result with exit code, stdout, and stderr
 */
export async function runCommand(
  args: string[],
  options?: {
    env?: Record<string, string | undefined>;
    cwd?: string;
    stdin?: "inherit" | "pipe" | "ignore";
    stdout?: "inherit" | "pipe" | "ignore";
    stderr?: "inherit" | "pipe" | "ignore";
  },
): Promise<SpawnResult> {
  const proc = Bun.spawn(args, {
    env: { ...process.env, ...options?.env },
    cwd: options?.cwd,
    stdin: options?.stdin ?? "inherit",
    stdout: options?.stdout ?? "pipe",
    stderr: options?.stderr ?? "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    options?.stdout === "pipe"
      ? new Response(proc.stdout).text()
      : Promise.resolve(""),
    options?.stderr === "pipe"
      ? new Response(proc.stderr).text()
      : Promise.resolve(""),
  ]);

  const exitCode = await proc.exited;

  return { exitCode, stdout, stderr };
}

/**
 * Run a shell command with output streamed to console (tee-like behavior)
 * Captures stdout while also displaying it
 *
 * @param args - Command and arguments
 * @param env - Environment variables to set
 * @returns Object with captured stdout and exit code
 */
export async function runCommandWithTee(
  args: string[],
  env?: Record<string, string | undefined>,
): Promise<{ stdout: string; exitCode: number }> {
  const proc = Bun.spawn(args, {
    env: { ...process.env, ...env },
    stdin: "inherit",
    stdout: "pipe",
    stderr: "inherit",
  });

  // Read stdout incrementally and tee to console
  const chunks: string[] = [];
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value);
    chunks.push(text);
    process.stdout.write(text);
  }

  const exitCode = await proc.exited;
  return { stdout: chunks.join(""), exitCode };
}
