/**
 * Configuration loading and validation for Maestro
 * Uses Bun's native YAML parsing
 */

// Re-export all types
export * from "./types";

import { validateSchema, formatAjvErrors } from "./schema";
import {
  type LoadedConfig,
  type MaestroConfig,
  type StackConfig,
  StackName,
  ServerRole,
  PulumiCommand,
} from "./types";

// ============================================
// Semantic Validations (filesystem checks that AJV cannot handle)
// ============================================

/**
 * Validates semantic constraints that cannot be expressed in JSON Schema
 * (e.g., filesystem existence checks, cross-field business logic)
 */
const validateSemanticConfig = async ({
  raw,
  roles,
}: {
  raw: MaestroConfig;
  roles: Set<ServerRole>;
}): Promise<void> => {
  // Validate ansible.web configuration when web role is present
  if ((raw.ansible?.enabled ?? false) && roles.has(ServerRole.Web)) {
    const webConfig = raw.ansible?.web ?? {};
    const hasStatic = !!webConfig.static;
    const hasDocker = !!webConfig.docker;

    if (!hasStatic && !hasDocker) {
      throw new Error(
        `ansible.web.static or ansible.web.docker must be configured when servers have the 'web' role`,
      );
    }

    // Validate that static.dir exists on the filesystem (local source only)
    if (hasStatic && webConfig.static?.source === "local") {
      const dir = webConfig.static.dir;
      if (dir) {
        try {
          await Bun.file(dir).stat();
        } catch {
          throw new Error(`ansible.web.static.dir does not exist at ${dir}`);
        }
      }
    }
  }

  // Validate ansible.backend configuration when backend role is present
  if ((raw.ansible?.enabled ?? false) && roles.has(ServerRole.Backend)) {
    const backendConfig = raw.ansible?.backend;
    if (!backendConfig?.image || !backendConfig?.tag) {
      throw new Error(
        `ansible.backend.image and ansible.backend.tag are required when servers have the 'backend' role`,
      );
    }
  }
};

// ============================================
// Config Loading
// ============================================

export async function loadConfig(configPath: string): Promise<LoadedConfig> {
  const file = Bun.file(configPath);

  if (!(await file.exists())) {
    throw new Error(
      `Config file not found at ${configPath}\n` +
        `Create a maestro.yaml file. See example.maestro.yaml for a template.`,
    );
  }

  const content = await file.text();
  const parsed = Bun.YAML.parse(content);

  // Validate schema using AJV
  if (!validateSchema(parsed)) {
    throw new Error(
      `Invalid configuration in ${configPath}:\n${formatAjvErrors(
        validateSchema.errors,
      )}`,
    );
  }

  // After validation, we can safely cast to MaestroConfig
  const raw = parsed as MaestroConfig;

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

// ============================================
// Dry Run Display
// ============================================

export function displayConfig(config: LoadedConfig): void {
  console.log("  domain:", config.domain);
  console.log("  pulumi.enabled:", config.pulumi.enabled);
  console.log("  pulumi.command:", config.pulumi.command);
  console.log(
    "  pulumi.cloudflare_account_id:",
    config.pulumi.cloudflareAccountId,
  );
  console.log("  pulumi.ssh_port:", config.pulumi.sshPort);
  console.log("  pulumi.stacks:", JSON.stringify(config.pulumi.stacks));
  console.log("  detected roles:", JSON.stringify(config.roles));
  console.log("  ansible.enabled:", config.ansible.enabled);
  console.log(`  ansible.web:`);
  console.log("    mode:", config.ansible.web.static ? "static" : "docker");

  if (config.ansible.web.static) {
    console.log("    static.source:", config.ansible.web.static.source);
    if (config.ansible.web.static.source === "local") {
      console.log("    static.dir:", config.ansible.web.static.dir);
      console.log(
        "    static.build:",
        config.ansible.web.static.build || "<none>",
      );
      console.log("    static.dist:", config.ansible.web.static.dist);
    } else {
      console.log("    static.image:", config.ansible.web.static.image);
      console.log("    static.tag:", config.ansible.web.static.tag);
      console.log("    static.path:", config.ansible.web.static.path);
    }
  } else if (config.ansible.web.docker) {
    console.log("    docker.image:", config.ansible.web.docker.image);
    console.log("    docker.tag:", config.ansible.web.docker.tag);
    console.log("    docker.port:", config.ansible.web.docker.port);
  }

  console.log(`  ansible.backend:`);
  console.log("    image:", config.ansible.backend.image);
  console.log("    tag:", config.ansible.backend.tag);
  console.log("    port:", config.ansible.backend.port);
  console.log("  ansible.groups:", JSON.stringify(config.ansible.groups));
  console.log("  secrets.provider:", config.secrets.provider);
  console.log("  secrets.project_id:", config.secrets.projectId || "<not set>");
  console.log(
    "  secrets.required_vars:",
    JSON.stringify(config.secrets.requiredVars),
  );

  // Show backend environment variables
  console.log("  Backend environment variables:");
  const backendEnvKeys = Object.keys(config.ansible.backend.env);
  if (backendEnvKeys.length > 0) {
    for (const key of backendEnvKeys) {
      console.log(`    ${key}=${config.ansible.backend.env[key]}`);
    }
  } else {
    console.log("    (none)");
  }

  // Show web docker environment variables if docker mode
  if (config.ansible.web.docker) {
    console.log("  Web docker environment variables:");
    const webDockerEnvKeys = Object.keys(config.ansible.web.docker.env);
    if (webDockerEnvKeys.length > 0) {
      for (const key of webDockerEnvKeys) {
        console.log(`    ${key}=${config.ansible.web.docker.env[key]}`);
      }
    } else {
      console.log("    (none)");
    }
  }
}

