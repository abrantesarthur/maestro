/**
 * Host data shared between the Pulumi (provisioning) and Ansible (configuration)
 * halves of maestro: the types describing stack hosts, plus the helpers that
 * shape resolved Pulumi stack outputs into the hosts Ansible consumes.
 */

export interface HostInfo {
  hostname: string;
  roles?: string[];
  tags?: string[];
  effective_domain?: string;
  postgresHost?: string;
  postgresPort?: string;
  postgresPassword?: string;
  /** Cluster admin (doadmin) creds — used only to grant the app user privileges. */
  postgresAdminUser?: string;
  postgresAdminPassword?: string;
}

export interface PulumiHosts {
  hosts: HostInfo[];
}

/** The `postgres` stack output's resolved shape (when the database tier is enabled). */
interface PostgresOutput {
  host?: string;
  port?: number | string;
  password?: string;
  adminUser?: string;
  adminPassword?: string;
}

/**
 * Resolved Pulumi stack outputs as maestro consumes them (Automation API
 * `stack.outputs()` values, secrets already revealed).
 */
export interface PulumiStackOutputs {
  hosts?: HostInfo[];
  postgres?: PostgresOutput;
}

/**
 * Convert resolved Pulumi stack outputs into the hosts Ansible consumes.
 *
 * SECURITY: the postgres output carries secret values (POSTGRES_PASSWORD and
 * admin creds) in plaintext — never log the input or the returned hosts.
 *
 * @param outputs - Resolved stack outputs (`hosts`, optional `postgres`)
 * @returns Hosts object with per-stack database creds stamped on backend hosts
 */
export function resolveStackHosts(
  outputs: Record<string, unknown>,
): PulumiHosts {
  const { hosts = [], postgres } = outputs as PulumiStackOutputs;

  // If this stack provisioned a database, copy its connection details onto the
  // stack's backend hosts so each backend reaches its own database. (USER/DB are
  // set globally elsewhere; only HOST/PORT/PASSWORD are per-stack here.)
  if (postgres?.host) {
    for (const host of hosts) {
      if (host.tags?.includes("backend")) {
        host.postgresHost = postgres.host;
        host.postgresPort = String(postgres.port);
        host.postgresPassword = postgres.password;
        // Only when present, so older stacks don't get undefined keys.
        if (postgres.adminUser) host.postgresAdminUser = postgres.adminUser;
        if (postgres.adminPassword)
          host.postgresAdminPassword = postgres.adminPassword;
      }
    }
  }

  return { hosts };
}

/**
 * Merge hosts from multiple Pulumi stacks
 *
 * @param existing - Existing hosts object
 * @param newHosts - New hosts to merge
 * @returns Merged hosts object
 */
export function mergeHosts(
  existing: PulumiHosts,
  newHosts: PulumiHosts,
): PulumiHosts {
  return {
    hosts: [...existing.hosts, ...(newHosts.hosts ?? [])],
  };
}
