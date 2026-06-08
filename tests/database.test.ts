import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  runCommandWithTee,
  createRedactingTee,
  PULUMI_OUTPUTS_BEGIN_MARKER,
  PULUMI_OUTPUTS_END_MARKER,
} from "../lib/helpers";
import { parsePulumiHosts, mergeHosts } from "../lib/ssh";
import { buildPulumiRunArgs } from "../lib/runPulumi";
import { buildPlaybookArgs, buildAnsibleEnv } from "../lib/runAnsible";
import type { MaestroConfig } from "../lib/config/index.ts";

const BEGIN = "__PULUMI_OUTPUTS_BEGIN__";
const END = "__PULUMI_OUTPUTS_END__";

/** A realistic stack-output payload with the DB password between the markers. */
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

describe("runCommandWithTee secret-safe redaction", () => {
  let writes: string[];
  const originalWrite = process.stdout.write.bind(process.stdout);

  beforeEach(() => {
    writes = [];
    // Capture everything teed to the console without printing it.
    const spy = (chunk: string | Uint8Array): boolean => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    };
    process.stdout.write = spy as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = originalWrite as typeof process.stdout.write;
  });

  test("keeps the secret in the returned buffer but hides it from the console (single chunk)", async () => {
    const payload = `before\n${BEGIN}\n${JSON.stringify(SAMPLE_OUTPUT, null, 2)}\n${END}\nafter\n`;
    const { stdout, exitCode } = await runCommandWithTee([
      "bash",
      "-c",
      `cat <<'EOF'\n${payload}EOF`,
    ]);

    expect(exitCode).toBe(0);

    // The full text (with the secret) must be captured for parsing.
    expect(stdout).toContain(BEGIN);
    expect(stdout).toContain(END);
    expect(stdout).toContain(SECRET_PASSWORD);

    // The console echo must NOT leak the secret.
    const console = writes.join("");
    expect(console).not.toContain(SECRET_PASSWORD);

    // Text outside the marker block is still shown to the user.
    expect(console).toContain("before");
    expect(console).toContain("after");
  });

  test("hides the secret even when the markers are split across read chunks", async () => {
    // Emit the BEGIN marker, the secret block, and the END marker as separate
    // writes with tiny sleeps so the reader observes them in distinct chunks.
    // This exercises the cross-chunk (byte-split) redaction path.
    const body = JSON.stringify(SAMPLE_OUTPUT);
    const script = [
      `printf 'before\\n'`,
      `sleep 0.05`,
      `printf '${BEGIN}\\n'`,
      `sleep 0.05`,
      `printf '%s\\n' '${body}'`,
      `sleep 0.05`,
      `printf '${END}\\n'`,
      `sleep 0.05`,
      `printf 'after\\n'`,
    ].join("; ");

    const { stdout, exitCode } = await runCommandWithTee([
      "bash",
      "-c",
      script,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain(SECRET_PASSWORD);

    const console = writes.join("");
    expect(console).not.toContain(SECRET_PASSWORD);
    expect(console).toContain("before");
    expect(console).toContain("after");
  });

  test("createRedactingTee hides the secret across a TRUE mid-marker / mid-secret split", () => {
    const tee = createRedactingTee();
    const half = Math.floor(SECRET_PASSWORD.length / 2);
    const firstHalf = SECRET_PASSWORD.slice(0, half);
    const secondHalf = SECRET_PASSWORD.slice(half);

    // Split the BEGIN marker mid-bytes, and split the secret across two pushes
    // while inside the redacted block.
    const beginCut = Math.floor(PULUMI_OUTPUTS_BEGIN_MARKER.length / 2);
    const out: string[] = [];
    out.push(tee.push(`before\n${PULUMI_OUTPUTS_BEGIN_MARKER.slice(0, beginCut)}`));
    out.push(tee.push(`${PULUMI_OUTPUTS_BEGIN_MARKER.slice(beginCut)}\n${firstHalf}`));
    out.push(
      tee.push(`${secondHalf}\n${PULUMI_OUTPUTS_END_MARKER}\nafter\n`),
    );
    out.push(tee.flush());

    const consoleText = out.join("");
    expect(consoleText).not.toContain(SECRET_PASSWORD);
    expect(consoleText).toContain("before");
    expect(consoleText).toContain("after");
  });
});

describe("parsePulumiHosts threads the postgres output per host", () => {
  function wrap(obj: unknown): string {
    return `noise\n${BEGIN}\n${JSON.stringify(obj)}\n${END}\ntrailing\n`;
  }

  test("stamps host/password from the postgres output onto backend-tagged hosts", () => {
    const parsed = parsePulumiHosts(wrap(SAMPLE_OUTPUT));
    const host = parsed.hosts.find((h) => h.hostname === "ssh0.example.com");
    expect(host).toBeDefined();
    expect(host?.postgresHost).toBe(SAMPLE_OUTPUT.postgres.host);
    // Port is the DO-assigned cluster.port, stringified for the container env.
    expect(host?.postgresPort).toBe(String(SAMPLE_OUTPUT.postgres.port));
    expect(host?.postgresPassword).toBe(SAMPLE_OUTPUT.postgres.password);
  });

  test("stamps postgres only onto backend hosts, never web-only hosts", () => {
    // Local output (don't mutate the shared SAMPLE_OUTPUT) with a postgres block
    // and two hosts: one backend, one web-only.
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

    const parsed = parsePulumiHosts(wrap(output));
    const backend = parsed.hosts.find((h) => h.hostname === "backend.example.com");
    const web = parsed.hosts.find((h) => h.hostname === "web.example.com");

    expect(backend?.postgresHost).toBe(output.postgres.host);
    expect(backend?.postgresPort).toBe(String(output.postgres.port));
    expect(backend?.postgresPassword).toBe(output.postgres.password);

    // The DB password must never reach a web-only droplet.
    expect(web?.postgresHost).toBeUndefined();
    expect(web?.postgresPort).toBeUndefined();
    expect(web?.postgresPassword).toBeUndefined();
  });

  test("parses the JSON even when Pulumi interleaves terminal control sequences", () => {
    // Under a TTY (`docker run -it`) Pulumi emits ANSI/OSC control sequences to
    // stdout — color codes, cursor moves, `ESC[6n` cursor-position reports, and
    // `ESC]11;?BEL` background-color queries — which land inside the captured
    // output block and break a naive JSON.parse.
    const CSI = "\x1b[38;5;13m\x1b[1m";
    const RESET = "\x1b[0m";
    const OSC = "\x1b]11;?\x1b\\\x1b[6n";
    const json = JSON.stringify(SAMPLE_OUTPUT);
    const contaminated =
      `${CSI}noise${RESET}\n${BEGIN}\n${OSC}${json}${OSC}\n${END}${RESET}\n`;

    const parsed = parsePulumiHosts(contaminated);
    const host = parsed.hosts.find((h) => h.hostname === "ssh0.example.com");
    expect(host).toBeDefined();
    expect(host?.postgresHost).toBe(SAMPLE_OUTPUT.postgres.host);
    expect(host?.postgresPassword).toBe(SAMPLE_OUTPUT.postgres.password);
  });

  test("leaves hosts unchanged when the stack has no postgres output", () => {
    const parsed = parsePulumiHosts(
      wrap({
        hosts: [
          {
            hostname: "ssh0.example.com",
            tags: ["prod", "backend"],
            effectiveDomain: "example.com",
          },
        ],
      }),
    );
    const host = parsed.hosts[0];
    expect(host.postgresHost).toBeUndefined();
    expect(host.postgresPort).toBeUndefined();
    expect(host.postgresPassword).toBeUndefined();
  });
});

describe("mergeHosts keeps per-stack credentials isolated", () => {
  function wrap(obj: unknown): string {
    return `noise\n${BEGIN}\n${JSON.stringify(obj)}\n${END}\ntrailing\n`;
  }

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
      parsePulumiHosts(wrap(stackA)),
      parsePulumiHosts(wrap(stackB)),
    );

    const a = merged.hosts.find((h) => h.hostname === "a-backend.example.com");
    const b = merged.hosts.find((h) => h.hostname === "b-backend.example.com");

    expect(a?.postgresPassword).toBe(passwordA);
    expect(a?.postgresPassword).not.toBe(passwordB);
    expect(b?.postgresPassword).toBe(passwordB);
    expect(b?.postgresPassword).not.toBe(passwordA);
  });
});

describe("buildPulumiRunArgs carries the database inputs", () => {
  const savedEnv = { ...process.env };
  const BASE_ENV = {
    DOMAIN: "example.com",
    BACKEND_PORT: "8080",
    SSH_PORT: "22",
    CLOUDFLARE_ACCOUNT_ID: "cf-acct",
    PULUMI_PROJECT_NAME: "proj",
    PULUMI_STACK: "prod",
    PULUMI_SERVERS_JSON: "[]",
    PULUMI_DATABASE_JSON: '{"enabled":true,"version":"16"}',
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

  test("passes POSTGRES_USER/DB and PULUMI_DATABASE_JSON as -e flags, never POSTGRES_PORT", () => {
    const args = buildPulumiRunArgs("up", BASE_ENV, "/tmp/key", true);
    const joined = args.join(" ");
    expect(joined).toContain("-e POSTGRES_USER=appuser");
    expect(joined).toContain("-e POSTGRES_DB=appdb");
    expect(joined).toContain(
      `-e PULUMI_DATABASE_JSON=${BASE_ENV.PULUMI_DATABASE_JSON}`,
    );
    // The port is derived from the cluster output, never passed into Pulumi —
    // even though it is present in process.env here, it must not leak into args.
    expect(joined).not.toContain("POSTGRES_PORT");
  });

  test("defaults PULUMI_DATABASE_JSON to {} when absent", () => {
    const args = buildPulumiRunArgs(
      "up",
      { ...BASE_ENV, PULUMI_DATABASE_JSON: "" },
      "/tmp/key",
      true,
    );
    expect(args.join(" ")).toContain("-e PULUMI_DATABASE_JSON={}");
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
    // A backend host carrying postgres data (as parsePulumiHosts would stamp it)
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
