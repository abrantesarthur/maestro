// ============================================
// Config Loading
// ============================================
import { validateSchema } from "./schema";
import {
  PulumiCommand,
  StackName,
  type LoadedConfig,
  type ServerRole,
  type StackConfig,
} from "./types";
import { validateSemanticConfig } from "./validateSchemaConfig";

export async function loadConfig(configPath: string): Promise<LoadedConfig> {
  const file = Bun.file(configPath);

  if (!(await file.exists())) {
    throw new Error(
      `Config file not found at ${configPath}\n` +
        `Create a maestro.yaml file. See example.maestro.yaml for a template.`,
    );
  }

  // validate the Maestro configuration according to the yaml schema
  const content = await file.text();
  const raw = validateSchema(content);

  // Collect all unique roles from all stacks
  const roles = Object.values(raw.pulumi?.stacks ?? {})
    .flatMap((s) => s.servers.flatMap((srv) => srv.roles))
    .reduce((prev, curr) => prev.add(curr), new Set<ServerRole>());

  // Semantic validations (filesystem checks that AJV cannot handle)
  await validateSemanticConfig({ raw, roles });

  // Build the loaded config with defaults
  return {
    domain: raw.domain,
    pulumi: {
      enabled: raw.pulumi?.enabled ?? false,
      command: raw.pulumi?.command ?? PulumiCommand.Up,
      cloudflareAccountId: raw.pulumi?.cloudflare_account_id ?? "",
      sshPort: raw.pulumi?.ssh_port ?? 22,
      stacks: (raw.pulumi?.stacks ?? {}) as Record<StackName, StackConfig>,
    },
    ansible: {
      enabled: raw.ansible?.enabled ?? false,
      groups: raw.ansible?.groups ?? ["devops"],
      web: {
        static: {
          source: raw.ansible?.web?.static?.source,
          dir: raw.ansible?.web?.static?.dir ?? "",
          build: raw.ansible?.web?.static?.build ?? "",
          dist: raw.ansible?.web?.static?.dist ?? "dist",
          image: raw.ansible?.web?.static?.image ?? "",
          tag: raw.ansible?.web?.static?.tag ?? "latest",
          path: raw.ansible?.web?.static?.path ?? "/app/dist",
        },
        docker: {
          image: raw.ansible?.web?.docker?.image ?? "",
          tag: raw.ansible?.web?.docker?.tag ?? "latest",
          port: raw.ansible?.web?.docker?.port ?? 3000,
          env: raw.ansible?.web?.docker?.env ?? {},
        },
      },
      backend: {
        image: raw.ansible?.backend?.image ?? "",
        tag: raw.ansible?.backend?.tag ?? "",
        port: raw.ansible?.backend?.port ?? 3000,
        env: raw.ansible?.backend?.env ?? {},
      },
    },
    secrets: {
      provider: "bws",
      projectId: raw.secrets?.project_id ?? "",
      requiredVars: raw.secrets?.required_vars ?? [],
    },
    roles: Array.from(roles),
  };
}
