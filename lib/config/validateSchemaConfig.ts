import { ServerRole, type MaestroConfig } from "./schema";

/**
 * Validates semantic constraints that cannot be expressed in io-ts codecs
 * (e.g., filesystem existence checks, cross-field business logic, conditional requirements)
 */
export const validateSemanticConfig = async ({
  raw,
  roles,
}: {
  raw: MaestroConfig;
  roles: Set<ServerRole>;
}): Promise<void> => {
  // Conditional validation: pulumi.enabled requires cloudflareAccountId and at
  // least one defined stack. We don't require `prod` specifically — a dev-only or
  // staging-only deployment is valid (it just lives on a prefixed subdomain;
  // `prod` is the environment that maps to the apex domain). The guard only
  // prevents an enabled-but-empty stacks config, which would provision nothing.
  if (raw.pulumi?.enabled) {
    if (!raw.pulumi.cloudflareAccountId) {
      throw new Error(
        `pulumi.cloudflareAccountId is required when pulumi.enabled is true`,
      );
    }
    if (!raw.pulumi.stacks || Object.keys(raw.pulumi.stacks).length === 0) {
      throw new Error(
        `at least one stack must be defined in pulumi.stacks when pulumi.enabled is true`,
      );
    }
  }

  // Conditional validation: the database tier is Pulumi-provisioned infra, so
  // enabling it requires pulumi.enabled. The Bitwarden POSTGRES_USER/DB pair is
  // enforced separately in index.ts at runtime.
  if (raw.pulumi?.database?.enabled && !raw.pulumi.enabled) {
    throw new Error(
      `pulumi.enabled must be true when pulumi.database.enabled is true`,
    );
  }

  // A per-stack database override is only meaningful as a sizing override on top
  // of the global pulumi.database block. Without it, runPulumi's merge drops the
  // override silently, so reject the orphaned config explicitly.
  if (!raw.pulumi?.database) {
    for (const [stackName, stack] of Object.entries(raw.pulumi?.stacks ?? {})) {
      if (stack?.database) {
        throw new Error(
          `stack "${stackName}" defines a database override but pulumi.database is not configured`,
        );
      }
    }
  }

  // Mixed-region guard: a stack gets a single region-scoped VPC and every droplet
  // must join it, so all servers in a stack must share one region. The stack's
  // effective region is servers[0].region ?? "nyc1" (matching pulumi/image/index.ts).
  // Servers that omit region inherit it; an explicit differing region is invalid.
  for (const [stackName, stack] of Object.entries(raw.pulumi?.stacks ?? {})) {
    const stackRegion = stack.servers[0]?.region ?? "nyc1";
    for (const server of stack.servers) {
      if (server.region && server.region !== stackRegion) {
        throw new Error(
          `stack "${stackName}" mixes regions: all servers must share one region, but found "${server.region}" alongside the stack region "${stackRegion}"`,
        );
      }
    }
  }

  // Conditional validation: web.static with source "local" requires dir and dist
  if (raw.ansible?.web?.static?.source === "local") {
    if (!raw.ansible.web.static.dir) {
      throw new Error(
        `ansible.web.static.dir is required when source is "local"`,
      );
    }
    if (!raw.ansible.web.static.dist) {
      throw new Error(
        `ansible.web.static.dist is required when source is "local"`,
      );
    }
  }

  // Conditional validation: web.static with source "image" requires image, tag, and path
  if (raw.ansible?.web?.static?.source === "image") {
    if (
      !raw.ansible.web.static.image ||
      !raw.ansible.web.static.tag ||
      !raw.ansible.web.static.path
    ) {
      throw new Error(
        `ansible.web.static image, tag, and path are required when source is "image"`,
      );
    }
  }

  // Mutual exclusion: cannot have both ansible.web.static and ansible.web.docker
  if (raw.ansible?.web?.static && raw.ansible?.web?.docker) {
    throw new Error(
      `ansible.web.static and ansible.web.docker cannot both be specified`,
    );
  }

  // Require at least one of static or docker when web is specified
  if (raw.ansible?.web && !raw.ansible.web.static && !raw.ansible.web.docker) {
    throw new Error(
      `ansible.web.static or ansible.web.docker must be specified when ansible.web is configured`,
    );
  }

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
