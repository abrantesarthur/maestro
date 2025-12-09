import { ServerRole, type MaestroConfig } from "./types";

/**
 * Validates semantic constraints that cannot be expressed in JSON Schema
 * (e.g., filesystem existence checks, cross-field business logic)
 */
export const validateSemanticConfig = async ({
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
