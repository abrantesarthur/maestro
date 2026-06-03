/**
 * Website asset builder for Maestro (TypeScript port of
 * ansible/scripts/build_website.sh).
 *
 * Optionally runs a build command inside a website source directory, then
 * copies the built artifacts (from a dist subdirectory) into an output
 * directory for packaging into the Ansible execution environment.
 */

import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { rm, mkdir } from "node:fs/promises";
import { log, runCommand } from "./helpers.ts";

export interface BuildWebsiteOptions {
  /** Path to the website source directory (required). */
  websiteDir: string;
  /** Destination directory for the built artifacts. */
  outputDir: string;
  /** Build command to run inside the website directory (optional). */
  buildCommand?: string;
  /** Subdirectory (relative to websiteDir) containing built assets. */
  distDir?: string;
}

/**
 * Build (optionally) and copy a website's static assets into outputDir.
 *
 * @throws Error if the website or dist directory is missing, or a step fails
 */
export async function buildWebsiteAssets(
  options: BuildWebsiteOptions,
): Promise<void> {
  const websiteDir = resolve(options.websiteDir);
  const outputDir = resolve(options.outputDir);
  const distDir = options.distDir || "dist";
  const buildCommand = options.buildCommand;

  if (!existsSync(websiteDir)) {
    throw new Error(`website directory not found at ${websiteDir}.`);
  }

  // Run build command if provided
  if (buildCommand) {
    log(`Building website with command: ${buildCommand}`);
    const { exitCode } = await runCommand(["sh", "-c", buildCommand], {
      cwd: websiteDir,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    if (exitCode !== 0) {
      throw new Error(
        `website build command failed with exit code ${exitCode}.`,
      );
    }
  } else {
    log("No build command specified, skipping build step...");
  }

  // Determine source directory for assets
  const websiteDistDir = resolve(websiteDir, distDir);
  if (!existsSync(websiteDistDir)) {
    throw new Error(
      `assets directory not found at ${websiteDistDir}.\n` +
        `If your site is pre-built, ensure distDir points to the correct subdirectory.`,
    );
  }

  log(`Copying assets from ${websiteDistDir} to ${outputDir}...`);
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  const { exitCode } = await runCommand(
    ["cp", "-R", `${websiteDistDir}/.`, `${outputDir}/`],
    { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );
  if (exitCode !== 0) {
    throw new Error(`failed to copy website assets to ${outputDir}.`);
  }

  log(`Done. Artifacts available at ${outputDir}.`);
}
