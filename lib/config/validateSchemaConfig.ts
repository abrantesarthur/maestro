import { ServerRole, type MaestroConfig } from "./types";

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
  // Conditional validation: pulumi.enabled requires cloudflareAccountId and stacks
  if (raw.pulumi?.enabled) {
    if (!raw.pulumi.cloudflareAccountId) {
      throw new Error(
        `pulumi.cloudflareAccountId is required when pulumi.enabled is true`,
      );
    }
    if (!raw.pulumi.stacks || Object.keys(raw.pulumi.stacks).length === 0) {
      throw new Error(`pulumi.stacks is required when pulumi.enabled is true`);
    }
  }

  // Conditional validation: web.static with source "local" requires dir
  if (raw.ansible?.web?.static?.source === "local") {
    if (!raw.ansible.web.static.dir) {
      throw new Error(
        `ansible.web.static.dir is required when source is "local"`,
      );
    }
  }

  // Conditional validation: web.static with source "image" requires image and tag
  if (raw.ansible?.web?.static?.source === "image") {
    if (!raw.ansible.web.static.image || !raw.ansible.web.static.tag) {
      throw new Error(
        `ansible.web.static.image and ansible.web.static.tag are required when source is "image"`,
      );
    }
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
