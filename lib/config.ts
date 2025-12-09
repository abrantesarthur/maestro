/**
 * Configuration types and loading for Maestro
 * Uses Bun's native YAML parsing
 */

// ============================================
// Type Definitions
// ============================================

export enum StackName {
  Dev = "dev",
  Staging = "staging",
  Prod = "prod",
}
export enum ServerRole {
  Backend = "backend",
  Web = "web",
}
export type PulumiCommand = "up" | "refresh" | "cancel" | "output";
export type WebMode = "static" | "docker";
export enum StaticSource {
  Local = "local",
  Image = "image",
}

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

const validStacks = Object.values(StackName)
  .map((s) => `'${s}'`)
  .join(", ");

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
  };
  ansible: {
    enabled: boolean;
    groups: string[];
    web: {
      static: {
        source?: StaticSource;
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
  roles: ServerRole[];
}

// ============================================
// Config Loading and Validation
// ============================================

const validatePulumiStackServers = ({
  stackName,
  servers,
}: {
  stackName: StackName;
  servers: ServerConfig[];
}): void => {
  for (let i = 0; i < servers.length; i++) {
    const server = servers[i]!;
    if (!server.roles || server.roles.length === 0) {
      throw new Error(
        `pulumi.stacks.${stackName}.servers[${i}].roles is required (must include at least one of: backend, web)`,
      );
    }

    const serverRoles = Object.values(ServerRole);
    const invalidRole = server.roles.find((r) => !serverRoles.includes(r));
    if (invalidRole) {
      throw new Error(
        `pulumi.stacks.${stackName}.servers[${i}].roles contains invalid role '${invalidRole}' (must be one of ${serverRoles.join(
          ", ",
        )})`,
      );
    }
  }
};

const validatePulumiStack = ({
  stackName,
  stackConfig,
}: {
  stackName: StackName;
  stackConfig: StackConfig;
}): void => {
  if (!stackConfig?.servers || stackConfig.servers.length === 0) {
    throw new Error(
      `pulumi.stacks.${stackName}.servers is required. Define at least one server.`,
    );
  }
  validatePulumiStackServers({ stackName, servers: stackConfig.servers });
};

const validatePulumiStacks = (
  stacks: Partial<Record<StackName, StackConfig>>,
): void => {
  const stackNames = Object.keys(stacks) as StackName[];

  if (stackNames.length === 0) {
    throw new Error(
      `pulumi.stacks is required when pulumi is enabled. Define at least one stack (${validStacks}).`,
    );
  }

  const invalidStackName = stackNames.find(
    (sn) =>
      ![StackName.Dev, StackName.Staging, StackName.Prod].includes(
        sn as StackName,
      ),
  );
  if (invalidStackName) {
    throw new Error(
      `pulumi.stacks constains invalid stack '${invalidStackName}'. Must be one of ${validStacks}.`,
    );
  }

  for (const stackEntry of Object.entries(stacks)) {
    validatePulumiStack({
      stackName: stackEntry[0] as StackName,
      stackConfig: stackEntry[1],
    });
  }
};

const validatePulumiConfig = (raw: MaestroConfig): void => {
  if (raw.pulumi?.enabled ?? false) {
    const pulumi = raw.pulumi!;

    if (!pulumi.cloudflare_account_id) {
      throw new Error(
        `pulumi.cloudflare_account_id is required when pulumi is enabled`,
      );
    }

    validatePulumiStacks(pulumi.stacks ?? {});
  }
};

const validateAnsibleWeb = async (webConfig: WebConfig): Promise<void> => {
  const staticConfig = webConfig.static;
  const dockerConfig = webConfig.docker;

  let webMode: WebMode | null = staticConfig
    ? "static"
    : dockerConfig
    ? "docker"
    : null;
  if (!webMode) {
    throw new Error(
      `ansible.web.static or ansible.web.docker must be configured when servers have the 'web' role`,
    );
  }

  if (webMode === "docker") {
    if (!dockerConfig?.image) {
      throw new Error(`ansible.web.docker.image is required for docker mode`);
    }
    if (!dockerConfig?.tag) {
      throw new Error(`ansible.web.docker.tag is required for docker mode`);
    }
  }

  if (webMode === "static") {
    const { source, dir, image, tag } = staticConfig ?? {};

    if (!source) {
      throw new Error(
        `ansible.web.static.source is required. Must be one of ${Object.values(
          StaticSource,
        )
          .map((s) => `'${s}'`)
          .join(", ")}`,
      );
    }
    if (source === "local") {
      if (!dir) {
        throw new Error(
          `ansible.web.static.dir is required when source is 'local'`,
        );
      }
      try {
        (await Bun.file(dir).stat()).isDirectory();
      } catch (error) {
        throw new Error(`ansible.web.static.dir does not exist at ${dir}`);
      }
    }
    if (source === "image") {
      if (!image) {
        throw new Error(
          `ansible.web.static.image is required when source is 'image'`,
        );
      }
      if (!tag) {
        throw new Error(
          `ansible.web.static.tag is required when source is 'image'`,
        );
      }
    }
  }
};

const validateAnsibleBackend = (
  backendConfig: Partial<BackendConfig>,
): void => {
  if (!backendConfig?.image) {
    throw new Error(`ansible.backend.image is required`);
  }
  if (!backendConfig?.tag) {
    throw new Error(`ansible.backend.tag is required`);
  }
};

const validateAnsibleConfig = async ({
  raw,
  roles,
}: {
  raw: MaestroConfig;
  roles: Set<ServerRole>;
}): Promise<void> => {
  if (raw.ansible?.enabled ?? false) {
    if (roles.has(ServerRole.Web)) {
      await validateAnsibleWeb(raw.ansible?.web ?? {});
    }

    if (roles.has(ServerRole.Backend)) {
      validateAnsibleBackend(raw.ansible?.backend ?? {});
    }
  }
};

export async function loadConfig(configPath: string): Promise<LoadedConfig> {
  const file = Bun.file(configPath);

  if (!(await file.exists())) {
    throw new Error(
      `Config file not found at ${configPath}\n` +
        `Create a maestro.yaml file. See example.maestro.yaml for a template.`,
    );
  }

  // FIXME: use ajv to validate the yaml schema
  const content = await file.text();
  const raw = Bun.YAML.parse(content) as MaestroConfig;

  // Validate required fields
  if (!raw.domain) {
    throw new Error(`Missing 'domain' in ${configPath}`);
  }

  validatePulumiConfig(raw);

  // Collect all unique roles from all stacks
  const roles = Object.values(raw.pulumi?.stacks ?? {})
    .flatMap((s) => s.servers.flatMap((s) => s.roles))
    .reduce((prev, curr) => prev.add(curr), new Set<ServerRole>());

  await validateAnsibleConfig({ raw, roles });

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
      enabled: raw.pulumi?.enabled ?? false,
      command: raw.pulumi?.command ?? "up",
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
