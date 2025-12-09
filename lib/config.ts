/**
 * Configuration types and loading for Maestro
 * Uses Bun's native YAML parsing
 */

// ============================================
// Type Definitions
// ============================================

export type StackName = "dev" | "staging" | "prod";
export type ServerRole = "backend" | "web";
export type PulumiCommand = "up" | "refresh" | "cancel" | "output";
export type WebMode = "static" | "docker";
export type StaticSource = "local" | "image";

export interface ServerConfig {
  roles: ServerRole[];
  groups?: string[];
  tags?: string[];
  image?: string;
  size?: string;
  region?: string;
}

export interface StackConfig {
  servers: ServerConfig[];
}

export interface PulumiConfig {
  enabled?: boolean;
  command?: PulumiCommand;
  cloudflare_account_id: string;
  ssh_port?: number;
  stacks: Partial<Record<StackName, StackConfig>>;
}

export interface WebStaticConfig {
  source: StaticSource;
  dir?: string;
  build?: string;
  dist?: string;
  image?: string;
  tag?: string;
  path?: string;
}

export interface WebDockerConfig {
  image: string;
  tag?: string;
  port?: number;
  env?: Record<string, string>;
}

export interface WebConfig {
  static?: WebStaticConfig;
  docker?: WebDockerConfig;
}

export interface BackendConfig {
  image: string;
  tag: string;
  port?: number;
  env?: Record<string, string>;
}

export interface AnsibleConfig {
  enabled?: boolean;
  groups?: string[];
  web?: WebConfig;
  backend?: BackendConfig;
}

export interface SecretsConfig {
  provider?: "bws";
  project_id?: string;
  required_vars?: string[];
}

export interface MaestroConfig {
  domain: string;
  pulumi?: PulumiConfig;
  ansible?: AnsibleConfig;
  secrets?: SecretsConfig;
}

// ============================================
// Loaded Configuration (with defaults applied)
// ============================================

export interface LoadedConfig {
  domain: string;
  pulumi: {
    enabled: boolean;
    command: PulumiCommand;
    cloudflareAccountId: string;
    sshPort: number;
    stacks: Record<StackName, StackConfig>;
    stackNames: StackName[];
  };
  ansible: {
    enabled: boolean;
    groups: string[];
    web: {
      mode: WebMode | null;
      static: {
        source: StaticSource;
        dir: string;
        build: string;
        dist: string;
        image: string;
        tag: string;
        path: string;
      };
      docker: {
        image: string;
        tag: string;
        port: number;
        env: Record<string, string>;
      };
    };
    backend: {
      image: string;
      tag: string;
      port: number;
      env: Record<string, string>;
    };
  };
  secrets: {
    provider: "bws";
    projectId: string;
    requiredVars: string[];
  };
  roles: {
    hasWeb: boolean;
    hasBackend: boolean;
    all: ServerRole[];
  };
}

// ============================================
// Config Loading and Validation
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
  const raw = Bun.YAML.parse(content) as MaestroConfig;

  // Validate required fields
  if (!raw.domain) {
    throw new Error(`domain is required in ${configPath}`);
  }

  // Determine web mode
  let webMode: WebMode | null = null;
  if (raw.ansible?.web?.static) {
    webMode = "static";
  } else if (raw.ansible?.web?.docker) {
    webMode = "docker";
  }

  // Extract stack names and validate
  const pulumiEnabled = raw.pulumi?.enabled ?? true;
  const stacks = raw.pulumi?.stacks ?? {};
  const stackNames = Object.keys(stacks).filter(
    (k): k is StackName => k === "dev" || k === "staging" || k === "prod",
  );

  // Validate stacks if pulumi is enabled
  if (pulumiEnabled) {
    if (!raw.pulumi?.cloudflare_account_id) {
      throw new Error(
        `pulumi.cloudflare_account_id is required when pulumi is enabled`,
      );
    }

    if (stackNames.length === 0) {
      throw new Error(
        `pulumi.stacks is required when pulumi is enabled. Define at least one stack (dev, staging, or prod).`,
      );
    }

    // Validate each stack
    for (const stackName of stackNames) {
      const stack = stacks[stackName];
      if (!stack?.servers || stack.servers.length === 0) {
        throw new Error(
          `pulumi.stacks.${stackName}.servers is required. Define at least one server.`,
        );
      }

      for (let i = 0; i < stack.servers.length; i++) {
        const server = stack.servers[i];
        if (!server.roles || server.roles.length === 0) {
          throw new Error(
            `pulumi.stacks.${stackName}.servers[${i}].roles is required (must include at least one of: backend, web)`,
          );
        }

        for (const role of server.roles) {
          if (role !== "backend" && role !== "web") {
            throw new Error(
              `pulumi.stacks.${stackName}.servers[${i}].roles contains invalid role '${role}' (must be one of: backend, web)`,
            );
          }
        }
      }
    }
  }

  // Collect all unique roles from all stacks
  const allRoles = new Set<ServerRole>();
  for (const stackName of stackNames) {
    const stack = stacks[stackName];
    if (stack?.servers) {
      for (const server of stack.servers) {
        for (const role of server.roles) {
          allRoles.add(role);
        }
      }
    }
  }

  const hasRoleWeb = allRoles.has("web");
  const hasRoleBackend = allRoles.has("backend");
  const ansibleEnabled = raw.ansible?.enabled ?? true;

  // Role-based validation
  if (ansibleEnabled && hasRoleWeb) {
    if (!webMode) {
      throw new Error(
        `ansible.web.static or ansible.web.docker must be configured when servers have the 'web' role`,
      );
    }

    if (webMode === "static") {
      const staticConfig = raw.ansible?.web?.static;
      const source = staticConfig?.source ?? "local";

      if (source === "local") {
        if (!staticConfig?.dir) {
          throw new Error(
            `ansible.web.static.dir is required when source is 'local'`,
          );
        }
      } else if (source === "image") {
        if (!staticConfig?.image) {
          throw new Error(
            `ansible.web.static.image is required when source is 'image'`,
          );
        }
      } else {
        throw new Error(
          `ansible.web.static.source must be 'local' or 'image', got '${source}'`,
        );
      }
    } else if (webMode === "docker") {
      if (!raw.ansible?.web?.docker?.image) {
        throw new Error(`ansible.web.docker.image is required for docker mode`);
      }
    }
  }

  if (ansibleEnabled && hasRoleBackend) {
    if (!raw.ansible?.backend?.image) {
      throw new Error(
        `ansible.backend.image is required when servers have the 'backend' role`,
      );
    }
    if (!raw.ansible?.backend?.tag) {
      throw new Error(
        `ansible.backend.tag is required when servers have the 'backend' role`,
      );
    }
  }

  // Validate secrets provider
  const secretsProvider = raw.secrets?.provider ?? "bws";
  if (secretsProvider !== "bws") {
    throw new Error(
      `secrets.provider must be 'bws'. Other providers are not supported yet.`,
    );
  }

  // Build the loaded config with defaults
  return {
    domain: raw.domain,
    pulumi: {
      enabled: pulumiEnabled,
      command: raw.pulumi?.command ?? "up",
      cloudflareAccountId: raw.pulumi?.cloudflare_account_id ?? "",
      sshPort: raw.pulumi?.ssh_port ?? 22,
      stacks: stacks as Record<StackName, StackConfig>,
      stackNames,
    },
    ansible: {
      enabled: ansibleEnabled,
      groups: raw.ansible?.groups ?? ["devops"],
      web: {
        mode: webMode,
        static: {
          source: raw.ansible?.web?.static?.source ?? "local",
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
    roles: {
      hasWeb: hasRoleWeb,
      hasBackend: hasRoleBackend,
      all: Array.from(allRoles),
    },
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
  console.log("  detected roles:", JSON.stringify(config.roles.all));
  console.log("  ansible.enabled:", config.ansible.enabled);
  console.log(`  ansible.web (role=${config.roles.hasWeb}):`);
  console.log("    mode:", config.ansible.web.mode ?? "<not configured>");

  if (config.ansible.web.mode === "static") {
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
  } else if (config.ansible.web.mode === "docker") {
    console.log("    docker.image:", config.ansible.web.docker.image);
    console.log("    docker.tag:", config.ansible.web.docker.tag);
    console.log("    docker.port:", config.ansible.web.docker.port);
  }

  console.log(`  ansible.backend (role=${config.roles.hasBackend}):`);
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
  if (config.ansible.web.mode === "docker") {
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
