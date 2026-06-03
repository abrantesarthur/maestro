import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { buildPulumiRunArgs } from "../lib/runPulumi";

const BASE_ENV = {
  DOMAIN: "example.com",
  BACKEND_PORT: "8080",
  SSH_PORT: "22",
  CLOUDFLARE_ACCOUNT_ID: "cf-acct",
  PULUMI_PROJECT_NAME: "proj",
  PULUMI_STACK: "prod",
  PULUMI_SERVERS_JSON: '[{"roles":["web"]}]',
};

describe("buildPulumiRunArgs", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    process.env["PULUMI_ACCESS_TOKEN"] = "pulumi-token";
    process.env["CLOUDFLARE_API_TOKEN"] = "cf-token";
    process.env["DIGITALOCEAN_TOKEN"] = "do-token";
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  test("starts an interactive, auto-removed container when interactive", () => {
    const args = buildPulumiRunArgs("up", BASE_ENV, "/tmp/key", true);
    expect(args.slice(0, 4)).toEqual(["docker", "run", "-it", "--rm"]);
    expect(args[args.length - 1]).toBe("maestro_pulumi");
  });

  test("omits -it for the silent (non-interactive) capture path", () => {
    const args = buildPulumiRunArgs("output", BASE_ENV, "/tmp/key", false);
    expect(args.slice(0, 3)).toEqual(["docker", "run", "--rm"]);
    expect(args).not.toContain("-it");
    expect(args[args.length - 1]).toBe("maestro_pulumi");
  });

  test("passes config and the access token as -e flags", () => {
    const args = buildPulumiRunArgs("up", BASE_ENV, "/tmp/key", true);
    const joined = args.join(" ");
    expect(joined).toContain("-e DOMAIN=example.com");
    expect(joined).toContain("-e PULUMI_COMMAND=up");
    expect(joined).toContain("-e PULUMI_STACK=prod");
    expect(joined).toContain("-e PULUMI_ACCESS_TOKEN=pulumi-token");
    expect(joined).toContain("-e PULUMI_SSH_KEY_PATH=/root/.ssh/id_rsa");
  });

  test("mounts the ssh key and passes provider creds for non-output commands", () => {
    const args = buildPulumiRunArgs("up", BASE_ENV, "/tmp/key", true);
    expect(args).toContain("-v");
    expect(args).toContain("/tmp/key:/root/.ssh/id_rsa:ro");
    const joined = args.join(" ");
    expect(joined).toContain("-e CLOUDFLARE_API_TOKEN=cf-token");
    expect(joined).toContain("-e DIGITALOCEAN_TOKEN=do-token");
  });

  test("omits ssh key mount and provider creds for the output command", () => {
    const args = buildPulumiRunArgs("output", BASE_ENV, "/tmp/key", false);
    expect(args).not.toContain("-v");
    const joined = args.join(" ");
    expect(joined).not.toContain("CLOUDFLARE_API_TOKEN");
    expect(joined).not.toContain("DIGITALOCEAN_TOKEN");
  });

  test("defaults PULUMI_SERVERS_JSON to [] when empty", () => {
    const args = buildPulumiRunArgs(
      "up",
      { ...BASE_ENV, PULUMI_SERVERS_JSON: "" },
      "/tmp/key",
      true,
    );
    expect(args.join(" ")).toContain("-e PULUMI_SERVERS_JSON=[]");
  });
});
