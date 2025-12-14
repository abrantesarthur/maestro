import { ServerRole, type MaestroConfig } from "./config/index.ts";
import { type PulumiHosts } from "./ssh.ts";

const SCRIPT_DIR = import.meta.dir.replace(/\/lib$/, "");
const ANSIBLE_RUN = `${SCRIPT_DIR}/ansible/run.sh`;

export async function runAnsible(
  pulumiHosts: PulumiHosts,
  config: MaestroConfig,
  secretsRequiredVarsJson: string,
): Promise<void> {
  const { ansible } = config;
  const env: Record<string, string> = {
    DOMAIN: config.domain,
    BACKEND_PORT: String(ansible?.backend?.port),
    BACKEND_IMAGE: ansible?.backend?.image ?? "",
    BACKEND_IMAGE_TAG: ansible?.backend?.tag ?? "",
    WEB_MODE: ansible?.web?.docker
      ? "docker"
      : ansible?.web?.static
      ? "static"
      : "",
    // FIXME: ensure empty value is ok
    WEB_STATIC_SOURCE: ansible?.web?.static?.source ?? "",
    WEB_STATIC_DIR: ansible?.web?.static?.dir ?? "",
    WEB_STATIC_BUILD: ansible?.web?.static?.build ?? "",
    WEB_STATIC_DIST: ansible?.web?.static?.dist ?? "",
    WEB_STATIC_IMAGE: ansible?.web?.static?.image ?? "",
    WEB_STATIC_TAG: ansible?.web?.static?.tag ?? "",
    WEB_STATIC_PATH: ansible?.web?.static?.path ?? "",
    WEB_DOCKER_IMAGE: ansible?.web?.docker?.image ?? "",
    WEB_DOCKER_TAG: ansible?.web?.docker?.tag ?? "",
    WEB_DOCKER_PORT: String(ansible?.web?.docker?.port),
    MANAGED_GROUPS: JSON.stringify(ansible?.groups ?? []),
    SECRETS_REQUIRED_VARS_JSON: secretsRequiredVarsJson,
  };

  // Export backend environment variables (BACKEND_ENV_*)
  for (const [key, value] of Object.entries(
    config.ansible?.backend?.env ?? {},
  )) {
    env[`BACKEND_ENV_${key}`] = value;
  }

  // Auto-inject PORT into the container environment from backend.port
  env["BACKEND_ENV_PORT"] = String(config.ansible?.backend?.port ?? "");

  // Export web docker environment variables (WEB_DOCKER_ENV_*)
  for (const [key, value] of Object.entries(
    config?.ansible?.web?.docker?.env ?? {},
  )) {
    env[`WEB_DOCKER_ENV_${key}`] = value;
  }

  const args = [
    ANSIBLE_RUN,
    "--ssh-hosts",
    JSON.stringify(pulumiHosts),
    "--skip-bws",
  ];

  // Role-based provisioning: skip playbooks if no server has that role
  let roles = Object.values(config?.pulumi?.stacks ?? {})
    .flatMap((s) => s.servers.flatMap((srv) => srv.roles))
    .reduce((prev, curr) => prev.add(curr), new Set<ServerRole>());
  if (!Array.from(roles).includes(ServerRole.Web)) {
    args.push("--skip-web");
  }
  if (!Array.from(roles).includes(ServerRole.Backend)) {
    args.push("--skip-backend");
  }

  const proc = Bun.spawn(args, {
    env: { ...process.env, ...env },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`Ansible command failed with exit code ${exitCode}`);
  }
}
