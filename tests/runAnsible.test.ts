import { describe, expect, test } from "bun:test";
import { buildPlaybookArgs } from "../lib/runAnsible";

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

  test("always forwards the static set of penv variables", () => {
    const args = buildPlaybookArgs("security.yml", "/tmp/key", []);
    const joined = args.join(" ");
    for (const v of [
      "SSH_HOSTS",
      "SSH_KEY_PATH",
      "GHCR_TOKEN",
      "GHCR_USERNAME",
      "BACKEND_IMAGE",
      "BACKEND_IMAGE_TAG",
      "BACKEND_PORT",
    ]) {
      expect(joined).toContain(`--penv ${v}`);
    }
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
    const penvCount = args.filter((a) => a === "--penv").length;
    // 7 static + 1 real dynamic
    expect(penvCount).toBe(8);
    expect(args.join(" ")).toContain("--penv REAL");
  });

  test("forwards BACKEND_ENV_* and WEB_DOCKER_ENV_* vars from the env", () => {
    const args = buildPlaybookArgs("backend.yml", "/tmp/key", [], {
      BACKEND_ENV_BWS_ACCESS_TOKEN: "token",
      BACKEND_ENV_PORT: "3000",
      WEB_DOCKER_ENV_FOO: "bar",
      SOME_OTHER_VAR: "ignored",
    });
    const joined = args.join(" ");
    expect(joined).toContain("--penv BACKEND_ENV_BWS_ACCESS_TOKEN");
    expect(joined).toContain("--penv BACKEND_ENV_PORT");
    expect(joined).toContain("--penv WEB_DOCKER_ENV_FOO");
    expect(joined).not.toContain("--penv SOME_OTHER_VAR");
  });
});
