import { describe, expect, test } from "bun:test";
import { parseArgs } from "../lib/helpers";

describe("parseArgs", () => {
  test("defaults: ./maestro.yaml in cwd, no dry-run", () => {
    expect(parseArgs([])).toEqual({
      dryRun: false,
      configPath: "./maestro.yaml",
    });
  });

  test("parses --dry-run", () => {
    expect(parseArgs(["--dry-run"]).dryRun).toBe(true);
  });

  test("parses --config with a separate value", () => {
    expect(parseArgs(["--config", "/apps/foo/maestro.yaml"]).configPath).toBe(
      "/apps/foo/maestro.yaml",
    );
  });

  test("parses --config=value", () => {
    expect(parseArgs(["--config=../maestro.yaml"]).configPath).toBe(
      "../maestro.yaml",
    );
  });

  test("parses combined flags", () => {
    const parsed = parseArgs(["--config", "cfg.yaml", "--dry-run"]);
    expect(parsed).toEqual({
      dryRun: true,
      configPath: "cfg.yaml",
    });
  });
});
