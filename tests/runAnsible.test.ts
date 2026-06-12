import { describe, expect, test } from "bun:test";
import { buildAnsibleEnv, buildPlaybookArgs } from "../lib/runAnsible";
import { validateSchema } from "../lib/config/validateSchema";
import type { PulumiHosts } from "../lib/hosts";

const NO_HOSTS: PulumiHosts = { hosts: [] };

/** Build a typed MaestroConfig with a backend block plus optional knobs. */
async function backendConfig(extra = ""): Promise<
  Awaited<ReturnType<typeof validateSchema>>
> {
  return validateSchema(`
domain: example.com
ansible:
  enabled: true
  backend:
    image: myapp
    tag: latest
    port: 8080
${extra}`);
}

describe("buildPlaybookArgs", () => {
  test("runs the given playbook and mounts the ssh key", () => {
    const args = buildPlaybookArgs("web.yml", "/tmp/key", []);
    expect(args.slice(0, 3)).toEqual([
      "ansible-navigator",
      "run",
      "playbooks/web.yml",
    ]);
    expect(args).toContain(
      "--container-options=-v=/tmp/key:/tmp/vps_ssh_key:ro",
    );
  });

  test("always forwards the GHCR pull credentials via --penv", () => {
    // GHCR_TOKEN/GHCR_USERNAME live in process.env (not the env dict) and are
    // always forwarded via --penv.
    const args = buildPlaybookArgs("security.yml", "/tmp/key", []);
    const joined = args.join(" ");
    expect(joined).toContain("--penv GHCR_TOKEN");
    expect(joined).toContain("--penv GHCR_USERNAME");
  });

  test("appends a --penv flag for each required var", () => {
    const args = buildPlaybookArgs("backend.yml", "/tmp/key", [
      "API_KEY",
      "DB_PASSWORD",
    ]);
    const joined = args.join(" ");
    expect(joined).toContain("--penv API_KEY");
    expect(joined).toContain("--penv DB_PASSWORD");
  });

  test("ignores empty required var names", () => {
    const args = buildPlaybookArgs("backend.yml", "/tmp/key", ["", "REAL"]);
    const joined = args.join(" ");
    // empty names are skipped; the real one plus the always-on GHCR creds remain
    expect(joined).not.toMatch(/--penv\s+--penv/);
    expect(joined).toContain("--penv REAL");
  });

  test("mounts the staged website assets dir when provided", () => {
    const args = buildPlaybookArgs("web.yml", "/tmp/key", [], {}, {
      websiteAssetsDir: "/tmp/maestro_website_abc",
    });
    expect(args).toContain(
      "--container-options=-v=/tmp/maestro_website_abc:/opt/website:ro",
    );
    // the ssh key mount must survive alongside the website mount
    expect(args).toContain(
      "--container-options=-v=/tmp/key:/tmp/vps_ssh_key:ro",
    );
  });

  test("omits the website mount when no assets dir is provided", () => {
    const args = buildPlaybookArgs("backend.yml", "/tmp/key", []);
    expect(args.join(" ")).not.toContain("/opt/website");
  });

  test("writes the navigator log to the temp dir, not the package dir", () => {
    const args = buildPlaybookArgs("web.yml", "/tmp/key", []);
    const lfIndex = args.indexOf("--lf");
    expect(lfIndex).toBeGreaterThan(-1);
    expect(args[lfIndex + 1]).toMatch(/maestro_ansible-navigator\.log$/);
  });

  test("forwards every non-empty env var via --penv, skipping empty ones", () => {
    const args = buildPlaybookArgs("backend.yml", "/tmp/key", [], {
      BACKEND_ENV_BWS_ACCESS_TOKEN: "token",
      BACKEND_ENV_PORT: "3000",
      WEB_DOCKER_ENV_FOO: "bar",
      SOME_OTHER_VAR: "value",
      EMPTY_VAR: "",
    });
    const joined = args.join(" ");
    expect(joined).toContain("--penv BACKEND_ENV_BWS_ACCESS_TOKEN");
    expect(joined).toContain("--penv BACKEND_ENV_PORT");
    expect(joined).toContain("--penv WEB_DOCKER_ENV_FOO");
    // all non-empty vars are forwarded, not just the dynamically-named prefixes
    expect(joined).toContain("--penv SOME_OTHER_VAR");
    // empty values are skipped to preserve "unset stays unset" semantics
    expect(joined).not.toContain("--penv EMPTY_VAR");
  });
});

describe("buildAnsibleEnv (blue/green deploy knobs)", () => {
  test("emits BACKEND_MIGRATE_COMMAND as JSON when migrate is present", async () => {
    const config = await backendConfig(`    migrate:
      command:
        - npm
        - run
        - migrate`);
    const env = buildAnsibleEnv(NO_HOSTS, config, []);
    expect(env.BACKEND_MIGRATE_COMMAND).toBe(
      JSON.stringify(["npm", "run", "migrate"]),
    );
  });

  test("emits an empty BACKEND_MIGRATE_COMMAND when migrate is absent", async () => {
    const config = await backendConfig();
    const env = buildAnsibleEnv(NO_HOSTS, config, []);
    expect(env.BACKEND_MIGRATE_COMMAND).toBe("");
  });

  test("emits the configured BACKEND_HEALTH_PATH", async () => {
    const config = await backendConfig(`    healthCheck:
      path: /ready`);
    const env = buildAnsibleEnv(NO_HOSTS, config, []);
    expect(env.BACKEND_HEALTH_PATH).toBe("/ready");
  });

  test("defaults BACKEND_HEALTH_PATH to /health when healthCheck is absent", async () => {
    const config = await backendConfig();
    const env = buildAnsibleEnv(NO_HOSTS, config, []);
    expect(env.BACKEND_HEALTH_PATH).toBe("/health");
  });

  test("does not forward the blue/green knobs as BACKEND_ENV_* app vars", async () => {
    // They are top-level container env vars, not BACKEND_ENV_*-prefixed app
    // vars, so they must not leak into the container env as app vars.
    const config = await backendConfig(`    migrate:
      command:
        - npm
        - run
        - migrate
    healthCheck:
      path: /ready`);
    const env = buildAnsibleEnv(NO_HOSTS, config, []);
    expect(env.BACKEND_ENV_MIGRATE_COMMAND).toBeUndefined();
    expect(env.BACKEND_ENV_HEALTH_PATH).toBeUndefined();
    expect(
      Object.keys(env).some((k) => k.startsWith("BACKEND_ENV_MIGRATE")),
    ).toBe(false);
  });

  test("the blue/green knobs ARE --penv-forwarded by buildPlaybookArgs", async () => {
    // The knobs reach the execution environment via --penv. If they were not
    // forwarded, the role's lookup('env', ...) would return empty inside the EE
    // and the feature would be silently dead-wired (migration skipped, health
    // path defaulted) — green tests, broken deploy. This asserts the wiring.
    const config = await backendConfig(`    migrate:
      command:
        - npm
        - run
        - migrate
    healthCheck:
      path: /ready`);
    const env = buildAnsibleEnv(NO_HOSTS, config, []);
    const args = buildPlaybookArgs("backend.yml", "/tmp/key", [], env);
    const joined = args.join(" ");
    expect(joined).toContain("--penv BACKEND_MIGRATE_COMMAND");
    expect(joined).toContain("--penv BACKEND_HEALTH_PATH");
  });

  test("the dynamic inventory var SSH_HOSTS is --penv-forwarded", () => {
    // Regression guard: SSH_HOSTS must be --penv-forwarded, otherwise the
    // dynamic inventory is empty and every play matches no hosts.
    const hosts: PulumiHosts = {
      hosts: [{ hostname: "ssh0.example.com", tags: ["backend"] }],
    };
    const args = buildPlaybookArgs("backend.yml", "/tmp/key", [], {
      SSH_HOSTS: JSON.stringify(hosts),
    });
    expect(args.join(" ")).toContain("--penv SSH_HOSTS");
  });
});
