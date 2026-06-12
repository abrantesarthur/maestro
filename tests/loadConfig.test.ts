import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../lib/config/loadConfig";
import { resolveConfigPaths } from "../lib/config/resolveConfigPaths";
import { validateSchema } from "../lib/config/validateSchema";

async function staticWebConfig(dir: string) {
  return validateSchema(`
domain: example.com
ansible:
  enabled: true
  web:
    static:
      source: local
      dir: ${dir}
      dist: dist
`);
}

describe("resolveConfigPaths", () => {
  test("resolves a relative web.static.dir against the config directory", async () => {
    const config = await staticWebConfig("./website");
    const resolved = resolveConfigPaths(config, "/apps/foo");
    expect(resolved.ansible?.web?.static?.dir).toBe("/apps/foo/website");
  });

  test("leaves an absolute web.static.dir untouched", async () => {
    const config = await staticWebConfig("/srv/website");
    const resolved = resolveConfigPaths(config, "/apps/foo");
    expect(resolved.ansible?.web?.static?.dir).toBe("/srv/website");
  });

  test("is a no-op when no static dir is configured", async () => {
    const config = await validateSchema(`
domain: example.com
ansible:
  enabled: true
`);
    expect(resolveConfigPaths(config, "/apps/foo")).toBe(config);
  });

  test("does not clobber sibling web/static settings", async () => {
    const config = await validateSchema(`
domain: example.com
ansible:
  enabled: true
  web:
    static:
      source: local
      dir: ./website
      build: npm run build
      dist: out
`);
    const resolved = resolveConfigPaths(config, "/apps/foo");
    expect(resolved.ansible?.web?.static?.build).toBe("npm run build");
    expect(resolved.ansible?.web?.static?.dist).toBe("out");
    expect(resolved.ansible?.enabled).toBe(true);
  });
});

describe("loadConfig", () => {
  test("resolves relative paths against the config file's directory, not cwd", async () => {
    const dir = await mkdtemp(join(tmpdir(), "maestro-test-"));
    try {
      const configPath = join(dir, "maestro.yaml");
      await writeFile(
        configPath,
        `
domain: example.com
ansible:
  enabled: true
  web:
    static:
      source: local
      dir: ./website
      dist: dist
`,
      );
      const config = await loadConfig(configPath);
      expect(config.ansible?.web?.static?.dir).toBe(join(dir, "website"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("the static.dir existence check runs against the resolved path, not cwd", async () => {
    // Regression: with a web-role stack the semantic validator stats
    // static.dir on disk. The relative dir exists next to the config file but
    // not in the test process's cwd — resolution must happen first.
    const dir = await mkdtemp(join(tmpdir(), "maestro-test-"));
    try {
      const configPath = join(dir, "maestro.yaml");
      await mkdir(join(dir, "website"));
      await writeFile(
        configPath,
        `
domain: example.com
pulumi:
  enabled: true
  projectName: example
  command: up
  cloudflareAccountId: deadbeef
  sshPort: 22
  stacks:
    prod:
      servers:
        - roles: [web]
ansible:
  enabled: true
  web:
    static:
      source: local
      dir: ./website
      dist: dist
`,
      );
      const config = await loadConfig(configPath);
      expect(config.ansible?.web?.static?.dir).toBe(join(dir, "website"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("throws a helpful error when the config file is missing", async () => {
    expect(loadConfig("/nonexistent/maestro.yaml")).rejects.toThrow(
      "Config file not found",
    );
  });
});
