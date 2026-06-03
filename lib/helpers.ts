/**
 * Helper utilities for Maestro
 * Logging, command checking, temp file management
 */

import { $ } from "bun";
import { chmod } from "node:fs/promises";

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
    if (!commandExists(cmd)) {
      throw new Error(`Error: required command '${cmd}' not found in PATH.`);
    }
  }
}

/**
 * Check whether a command is available on PATH (non-throwing).
 *
 * @param cmd - The command to look up
 * @returns true if the command is found in PATH
 */
export function commandExists(cmd: string): boolean {
  const result = Bun.spawnSync(["which", cmd], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return result.exitCode === 0;
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

// ============================================
// Temp File Management
// ============================================

/** Prefix used for all maestro temp files */
const TEMP_FILE_PREFIX = "maestro_";

/** Legacy temp-file prefix from the old shell implementation; swept once for cleanup */
const LEGACY_TEMP_FILE_PREFIX = "secret_";

/**
 * Get the secure temp directory for the current platform
 * Uses $TMPDIR (per-user on macOS) with fallback to /tmp
 */
function getSecureTempDir(): string {
  return process.env["TMPDIR"] ?? "/tmp";
}

/**
 * Create a temporary file with a secret value from an environment variable
 * Normalizes escaped newlines and ensures proper permissions
 *
 * Security features:
 * - Uses umask to create file with 600 permissions atomically
 * - Uses cryptographically random filename
 * - Uses per-user temp directory when available
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

  // Generate cryptographically random filename
  const randomSuffix = crypto.randomUUID();
  const tmpPath = `${getSecureTempDir()}/${TEMP_FILE_PREFIX}${randomSuffix}`;

  // Normalize escaped newlines, strip CRs, and ensure a trailing newline for OpenSSH
  // NOTE: intentionally narrower than the old shell's `printf '%b'`, which expanded ALL
  // backslash escapes (\t, \\, octal, ...). We only handle \n and strip \r, which is
  // sufficient for the only current caller (VPS_SSH_KEY / PEM keys). A future secret
  // relying on other escapes would need this widened.
  const normalizedValue =
    secretValue.replace(/\\n/g, "\n").replace(/\r/g, "") + "\n";

  // Set restrictive umask before writing to avoid race condition
  // 0o077 means new files are created with 600 permissions (owner read/write only)
  const oldUmask = process.umask(0o077);
  try {
    await Bun.write(tmpPath, normalizedValue);
    // belt-and-suspenders: guarantee 0600 regardless of umask behavior
    await chmod(tmpPath, 0o600);
  } finally {
    process.umask(oldUmask);
  }

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

/**
 * Cleanup stale maestro temp files from previous runs
 * Removes any files matching the maestro_ prefix in the temp directory
 */
export async function cleanupStaleTempFiles(): Promise<void> {
  const tempDir = getSecureTempDir();
  try {
    const result =
      await $`find ${tempDir} -maxdepth 1 -name "${TEMP_FILE_PREFIX}*" -type f -delete`.quiet();
    if (result.exitCode !== 0) {
      // Silently ignore errors - stale files are not critical
    }
    // Also sweep legacy secret_* files left behind by the old shell implementation
    // (may contain decrypted SSH keys from prior crashed runs)
    const legacyResult =
      await $`find ${tempDir} -maxdepth 1 -name "${LEGACY_TEMP_FILE_PREFIX}*" -type f -delete`.quiet();
    if (legacyResult.exitCode !== 0) {
      // Silently ignore errors - stale files are not critical
    }
  } catch {
    // Ignore errors when cleaning up stale files
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
