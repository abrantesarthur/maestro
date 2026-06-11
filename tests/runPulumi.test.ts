import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { buildStackConfig, needsProviderCreds } from "../lib/runPulumi";

const BASE_ENV = {
  DOMAIN: "example.com",
  BACKEND_PORT: "8080",
  SSH_PORT: "22",
  CLOUDFLARE_ACCOUNT_ID: "cf-acct",
  PULUMI_PROJECT_NAME: "proj",
  PULUMI_STACK: "prod",
};

describe("needsProviderCreds", () => {
  test("only the output command skips provider credentials", () => {
    expect(needsProviderCreds("output")).toBe(false);
    for (const cmd of ["up", "refresh", "cancel", "destroy"]) {
      expect(needsProviderCreds(cmd)).toBe(true);
    }
  });
});

describe("buildStackConfig", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    process.env["POSTGRES_USER"] = "appuser";
    process.env["POSTGRES_DB"] = "appdb";
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  test("namespaces every key under the project (existing stack config is reused)", () => {
    const config = buildStackConfig(BASE_ENV, "/tmp/key", false);
    expect(config["proj:domain"]).toEqual({ value: "example.com" });
    expect(config["proj:cloudflareAccountId"]).toEqual({ value: "cf-acct" });
    expect(config["proj:backendPort"]).toEqual({ value: "8080" });
    expect(config["proj:sshPort"]).toEqual({ value: "22" });
    expect(Object.keys(config).every((k) => k.startsWith("proj:"))).toBe(true);
  });

  test("sshKeyPath is the host key file path", () => {
    const config = buildStackConfig(BASE_ENV, "/tmp/maestro_vps_ssh_key", false);
    expect(config["proj:sshKeyPath"]).toEqual({
      value: "/tmp/maestro_vps_ssh_key",
    });
  });

  test("servers/database settings are not in stack config (passed to the program directly)", () => {
    const config = buildStackConfig(BASE_ENV, "/tmp/key", true);
    expect(config["proj:servers"]).toBeUndefined();
    expect(config["proj:database"]).toBeUndefined();
  });

  test("includes postgresUser/postgresDb only when the database tier is enabled", () => {
    const without = buildStackConfig(BASE_ENV, "/tmp/key", false);
    expect(without["proj:postgresUser"]).toBeUndefined();
    expect(without["proj:postgresDb"]).toBeUndefined();

    const withDb = buildStackConfig(BASE_ENV, "/tmp/key", true);
    expect(withDb["proj:postgresUser"]).toEqual({ value: "appuser" });
    expect(withDb["proj:postgresDb"]).toEqual({ value: "appdb" });
  });

  test("never includes provider credentials or POSTGRES_PORT in stack config", () => {
    process.env["CLOUDFLARE_API_TOKEN"] = "cf-token";
    process.env["DIGITALOCEAN_ACCESS_TOKEN"] = "do-token";
    process.env["POSTGRES_PORT"] = "25060";
    const config = buildStackConfig(BASE_ENV, "/tmp/key", true);
    const values = Object.values(config).map((v) => v.value);
    expect(values).not.toContain("cf-token");
    expect(values).not.toContain("do-token");
    expect(values).not.toContain("25060");
    expect(config["proj:postgresPort"]).toBeUndefined();
  });
});
