import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolveStackHosts, mergeHosts } from "../lib/hosts";
import { buildStackConfig } from "../lib/runPulumi";
import { buildPlaybookArgs, buildAnsibleEnv } from "../lib/runAnsible";
import type { MaestroConfig } from "../lib/config/index.ts";

/** A realistic resolved stack-outputs payload (as `stack.outputs()` yields it). */
const SECRET_PASSWORD = "s3cr3t-db-pa55word-do-generated";
const SAMPLE_OUTPUT = {
  hosts: [
    {
      hostname: "ssh0.example.com",
      tags: ["prod", "backend", "web"],
      effectiveDomain: "example.com",
    },
  ],
  postgres: {
    host: "private-db-postgresql-nyc1-00000.b.db.ondigitalocean.test",
    port: 25060,
    user: "appuser",
    database: "appdb",
    password: SECRET_PASSWORD,
    sslmode: "require",
  },
};

/** Deep-clone so tests never mutate the shared sample (hosts are stamped in place). */
function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

describe("resolveStackHosts threads the postgres output per host", () => {
  test("stamps host/password from the postgres output onto backend-tagged hosts", () => {
    const parsed = resolveStackHosts(clone(SAMPLE_OUTPUT));
    const host = parsed.hosts.find((h) => h.hostname === "ssh0.example.com");
    expect(host).toBeDefined();
    expect(host?.postgresHost).toBe(SAMPLE_OUTPUT.postgres.host);
    // Port is the DO-assigned cluster.port, stringified for the container env.
    expect(host?.postgresPort).toBe(String(SAMPLE_OUTPUT.postgres.port));
    expect(host?.postgresPassword).toBe(SAMPLE_OUTPUT.postgres.password);
  });

  test("stamps postgres only onto backend hosts, never web-only hosts", () => {
    const output = {
      hosts: [
        {
          hostname: "backend.example.com",
          tags: ["prod", "backend"],
          effectiveDomain: "example.com",
        },
        {
          hostname: "web.example.com",
          tags: ["prod", "web"],
          effectiveDomain: "example.com",
        },
      ],
      postgres: {
        host: "private-db-postgresql-nyc1-11111.b.db.ondigitalocean.test",
        port: 25060,
        user: "appuser",
        database: "appdb",
        password: SECRET_PASSWORD,
        sslmode: "require",
      },
    };

    const parsed = resolveStackHosts(clone(output));
    const backend = parsed.hosts.find(
      (h) => h.hostname === "backend.example.com",
    );
    const web = parsed.hosts.find((h) => h.hostname === "web.example.com");

    expect(backend?.postgresHost).toBe(output.postgres.host);
    expect(backend?.postgresPort).toBe(String(output.postgres.port));
    expect(backend?.postgresPassword).toBe(output.postgres.password);

    // The DB password must never reach a web-only droplet.
    expect(web?.postgresHost).toBeUndefined();
    expect(web?.postgresPort).toBeUndefined();
    expect(web?.postgresPassword).toBeUndefined();
  });

  test("leaves hosts unchanged when the stack has no postgres output", () => {
    const parsed = resolveStackHosts({
      hosts: [
        {
          hostname: "ssh0.example.com",
          tags: ["prod", "backend"],
          effectiveDomain: "example.com",
        },
      ],
    });
    const host = parsed.hosts[0]!;
    expect(host.postgresHost).toBeUndefined();
    expect(host.postgresPort).toBeUndefined();
    expect(host.postgresPassword).toBeUndefined();
  });

  test("returns no hosts for empty outputs (e.g. a never-deployed stack)", () => {
    expect(resolveStackHosts({}).hosts).toEqual([]);
  });
});

describe("mergeHosts keeps per-stack credentials isolated", () => {
  test("each stack's password rides only its own backend host", () => {
    const passwordA = "stack-A-pa55word";
    const passwordB = "stack-B-pa55word";

    const stackA = {
      hosts: [
        {
          hostname: "a-backend.example.com",
          tags: ["prod", "backend"],
          effectiveDomain: "a.example.com",
        },
      ],
      postgres: {
        host: "a-db.b.db.ondigitalocean.test",
        port: 25060,
        user: "appuser",
        database: "appdb",
        password: passwordA,
        sslmode: "require",
      },
    };
    const stackB = {
      hosts: [
        {
          hostname: "b-backend.example.com",
          tags: ["prod", "backend"],
          effectiveDomain: "b.example.com",
        },
      ],
      postgres: {
        host: "b-db.b.db.ondigitalocean.test",
        port: 25060,
        user: "appuser",
        database: "appdb",
        password: passwordB,
        sslmode: "require",
      },
    };

    const merged = mergeHosts(
      resolveStackHosts(stackA),
      resolveStackHosts(stackB),
    );

    const a = merged.hosts.find((h) => h.hostname === "a-backend.example.com");
    const b = merged.hosts.find((h) => h.hostname === "b-backend.example.com");

    expect(a?.postgresPassword).toBe(passwordA);
    expect(a?.postgresPassword).not.toBe(passwordB);
    expect(b?.postgresPassword).toBe(passwordB);
    expect(b?.postgresPassword).not.toBe(passwordA);
  });
});

describe("buildStackConfig carries the database inputs", () => {
  const savedEnv = { ...process.env };
  const BASE_ENV = {
    DOMAIN: "example.com",
    BACKEND_PORT: "8080",
    SSH_PORT: "22",
    CLOUDFLARE_ACCOUNT_ID: "cf-acct",
    PULUMI_PROJECT_NAME: "proj",
    PULUMI_STACK: "prod",
  };

  beforeEach(() => {
    process.env["PULUMI_ACCESS_TOKEN"] = "pulumi-token";
    process.env["CLOUDFLARE_API_TOKEN"] = "cf-token";
    process.env["DIGITALOCEAN_ACCESS_TOKEN"] = "do-token";
    process.env["POSTGRES_USER"] = "appuser";
    process.env["POSTGRES_DB"] = "appdb";
    process.env["POSTGRES_PORT"] = "25060";
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  test("sets postgresUser/postgresDb when the database tier is enabled, never POSTGRES_PORT", () => {
    const config = buildStackConfig(BASE_ENV, "/tmp/key", true);
    expect(config["proj:postgresUser"]).toEqual({ value: "appuser" });
    expect(config["proj:postgresDb"]).toEqual({ value: "appdb" });
    // The port is derived from the cluster output, never passed into Pulumi —
    // even though it is present in process.env here, it must not leak in.
    expect(config["proj:postgresPort"]).toBeUndefined();
    expect(Object.values(config).map((v) => v.value)).not.toContain("25060");
  });

  test("omits postgresUser/postgresDb when the database tier is disabled", () => {
    const config = buildStackConfig(BASE_ENV, "/tmp/key", false);
    expect(config["proj:postgresUser"]).toBeUndefined();
    expect(config["proj:postgresDb"]).toBeUndefined();
  });
});

describe("buildPlaybookArgs forwards the postgres BACKEND_ENV_* vars", () => {
  test("forwards the global USER/DB/SSLMODE container env vars", () => {
    const args = buildPlaybookArgs("backend.yml", "/tmp/key", [], {
      BACKEND_ENV_POSTGRES_USER: "appuser",
      BACKEND_ENV_POSTGRES_DB: "appdb",
      BACKEND_ENV_POSTGRES_SSLMODE: "require",
      BACKEND_ENV_PGSSLMODE: "require",
    });
    const joined = args.join(" ");
    expect(joined).toContain("--penv BACKEND_ENV_POSTGRES_USER");
    expect(joined).toContain("--penv BACKEND_ENV_POSTGRES_DB");
    expect(joined).toContain("--penv BACKEND_ENV_POSTGRES_SSLMODE");
    expect(joined).toContain("--penv BACKEND_ENV_PGSSLMODE");
  });

  test("never forwards POSTGRES_HOST/PORT/PASSWORD globally (they ride per-host)", () => {
    const args = buildPlaybookArgs("backend.yml", "/tmp/key", [], {
      BACKEND_ENV_POSTGRES_USER: "appuser",
    });
    const joined = args.join(" ");
    expect(joined).not.toContain("BACKEND_ENV_POSTGRES_HOST");
    expect(joined).not.toContain("BACKEND_ENV_POSTGRES_PORT");
    expect(joined).not.toContain("BACKEND_ENV_POSTGRES_PASSWORD");
  });
});

describe("buildAnsibleEnv keeps HOST/PORT/PASSWORD out of the global env", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    process.env["POSTGRES_USER"] = "appuser";
    process.env["POSTGRES_DB"] = "appdb";
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  test("includes USER/DB/SSLMODE/PGSSLMODE but never HOST/PORT/PASSWORD", () => {
    // A backend host carrying postgres data (as resolveStackHosts would stamp it)
    // is what gates the global USER/DB/SSLMODE injection.
    const pulumiHosts = {
      hosts: [
        {
          hostname: "backend.example.com",
          tags: ["prod", "backend"],
          postgresHost: SAMPLE_OUTPUT.postgres.host,
          postgresPort: String(SAMPLE_OUTPUT.postgres.port),
          postgresPassword: SAMPLE_OUTPUT.postgres.password,
        },
      ],
    };
    const config: MaestroConfig = {
      domain: "example.com",
      ansible: {
        enabled: true,
        backend: { image: "img", tag: "latest", port: 8080 },
      },
    };

    const env = buildAnsibleEnv(pulumiHosts, config, []);

    expect(env["BACKEND_ENV_POSTGRES_USER"]).toBe("appuser");
    expect(env["BACKEND_ENV_POSTGRES_DB"]).toBe("appdb");
    expect(env["BACKEND_ENV_POSTGRES_SSLMODE"]).toBe("require");
    expect(env["BACKEND_ENV_PGSSLMODE"]).toBe("require");

    // HOST/PORT/PASSWORD ride per-host in SSH_HOSTS, never in the global env.
    const globalKeys = Object.keys(env);
    expect(globalKeys).not.toContain("BACKEND_ENV_POSTGRES_HOST");
    expect(globalKeys).not.toContain("BACKEND_ENV_POSTGRES_PORT");
    expect(globalKeys).not.toContain("BACKEND_ENV_POSTGRES_PASSWORD");
  });
});

describe("no committed Postgres credential literals", () => {
  const repoRoot = `${import.meta.dir}/..`;
  const trackedConfigFiles = [
    "example.maestro.yaml",
    "lib/config/schema.ts",
    "lib/runPulumi.ts",
    "lib/runAnsible.ts",
    "ansible/playbooks/roles/backend_app/defaults/main.yml",
    "ansible/playbooks/roles/backend_app/tasks/main.yml",
  ];

  test("the committed config/source files contain no real DB host or password values", async () => {
    for (const rel of trackedConfigFiles) {
      const text = await Bun.file(`${repoRoot}/${rel}`).text();
      // A concrete managed-Postgres private endpoint ends in
      // ".db.ondigitalocean.<tld>" (e.g. .com, .net); none should be hard-coded.
      expect(text).not.toMatch(/\.db\.ondigitalocean\.[a-z]+/);
      // No assigned literal value for the DB password (also catches quoted keys).
      // A bare snake_case identifier after the assignment is a variable
      // reference (e.g. `POSTGRES_PASSWORD: postgres_password`), not a literal.
      expect(text).not.toMatch(
        /["']?POSTGRES_PASSWORD["']?\s*[:=]\s*["']?(?![a-z_]+\b)\S/,
      );
    }
  });
});
