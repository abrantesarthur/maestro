import * as pulumi from "@pulumi/pulumi";
import * as digitalOcean from "@pulumi/digitalocean";
import {
  DnsRecord,
  ManagedDatabase,
  PostgresVersion,
  ZoneSettings,
  VirtualServer,
  type VirtualServerArgs,
  VpsTag,
} from "./resources";
import { SIZE_MAP, REGION_MAP, DATABASE_SIZE_MAP } from "./constants";

/** Server configuration from maestro.yaml */
export interface ServerConfig {
  roles: string[];
  tags?: string[];
  groups?: string[]; // Optional per-server groups override for security hardening
  image?: string;
  size?: string;
  region?: string;
}

/**
 * Effective managed-database settings for this stack. Maestro merges the
 * pulumi.database global defaults with the pulumi.stacks.<s>.database override
 * (override wins) and passes the result directly to `pulumiProgram`.
 */
export interface DatabaseConfig {
  enabled: boolean;
  version?: PostgresVersion;
  size?: string;
  nodeCount?: number;
}

// Documented managed-database defaults (NOT encoded in the maestro.yaml codecs).
// The region is NOT a database field: a DigitalOcean VPC is region-scoped and the
// private endpoint only resolves inside it, so the database always co-locates with
// the stack's droplets' region (see `region` below), resolved separately.
const DATABASE_DEFAULTS: Required<Omit<DatabaseConfig, "enabled" | "size">> & {
  size: digitalOcean.DatabaseSlug;
} = {
  version: PostgresVersion.V16,
  size: digitalOcean.DatabaseSlug.DB_1VPCU1GB,
  nodeCount: 1,
};

/** Stack outputs consumed by maestro (lib/runPulumi.ts). */
export interface PulumiProgramOutputs {
  hosts: {
    hostname: pulumi.Output<string>;
    tags: pulumi.Output<string[]>;
    effectiveDomain: pulumi.Output<string>;
    groups?: string[];
  }[];
  postgres?: {
    host: pulumi.Output<string>;
    port: pulumi.Output<number>;
    user: pulumi.Output<string>;
    database: pulumi.Output<string>;
    password: pulumi.Output<string>;
    adminUser: pulumi.Output<string>;
    adminPassword: pulumi.Output<string>;
    sslmode: string;
  };
}

/**
 * The Pulumi program, run in-process by maestro via the Automation API
 * (`@pulumi/pulumi/automation`). The returned object's keys become the stack
 * outputs (`hosts`, and `postgres` when the database tier is enabled).
 *
 * Since the program runs in-process, the maestro.yaml-derived server and
 * database settings are passed as typed arguments (captured by the closure in
 * lib/runPulumi.ts) rather than serialized through stack config.
 */
export async function pulumiProgram(
  serversConfig: ServerConfig[],
  databaseConfig: DatabaseConfig,
): Promise<PulumiProgramOutputs> {
  const projectName = pulumi.getProject();
  const stackConfig = new pulumi.Config(projectName);
  const domain = stackConfig.require("domain");

  // Get the current stack name (dev, staging, or prod) to use as environment tag
  const stackName = pulumi.getStack();

  // Project-namespaced stack tag. Tags are account-global, so a bare stack name
  // ("dev") would trust any droplet in the DO account. This scopes both the droplet
  // tag and the database firewall to THIS project's stack.
  const stackTag = `${projectName}-${stackName}`;

  // Compute the effective domain based on stack name
  // dev -> dev.example.com, staging -> staging.example.com, prod -> example.com
  const envPrefix = stackName !== "prod" ? stackName : undefined;
  const effectiveDomain = envPrefix ? `${envPrefix}.${domain}` : domain;

  // enforce zone-level settings
  new ZoneSettings({ domain });

  // The region the backend droplets and the database share. Both the droplet
  // vpcUuid and the database privateNetworkUuid must point at the SAME VPC for the
  // private endpoint to resolve, and a VPC is region-scoped, so the database is
  // co-located with the droplets. The shared region follows the first server's
  // region (defaulting to nyc1); the database therefore lives in this same region.
  const stackRegion = serversConfig[0]?.region || "nyc1";
  const region = REGION_MAP[stackRegion] || digitalOcean.Region.NYC1;

  // One explicit, per-stack VPC joined by BOTH the droplets and the database. We
  // avoid the account-global region-default VPC (shared, not isolated).
  //
  // region is immutable: changing it on a provisioned DB stack replaces the VPC,
  // which forces replacement of the protect:true cluster and Pulumi hard-stops.
  // Moving regions requires the unprotect + recreate runbook (see pulumi/README.md).
  const vpc = new digitalOcean.Vpc(`vpc-${stackName}`, {
    name: `vpc-${stackName}`,
    region,
  });

  // Build VirtualServerArgs from config, combining stack name + roles + custom tags
  // Also preserve per-server groups for security hardening
  interface VpsConfig {
    args: Omit<VirtualServerArgs, "index">;
    groups?: string[]; // Per-server groups override
  }

  const VPS_CONFIGS: VpsConfig[] = serversConfig.map((server) => {
    // Combine all tags: stack name (as environment) + roles + custom tags
    const allTags: string[] = [
      stackTag,
      ...server.roles,
      ...(server.tags || []),
    ];

    return {
      args: {
        image: server.image || "ubuntu-24-04-x64",
        size:
          (server.size && SIZE_MAP[server.size]) ||
          digitalOcean.DropletSlug.DropletS1VCPU1GB,
        region:
          (server.region && REGION_MAP[server.region]) ||
          digitalOcean.Region.NYC1,
        sshKeys: ["56816254"], // TODO: make this configurable
        tags: allTags,
        effectiveDomain,
        vpcUuid: vpc.id,
      },
      groups: server.groups, // Pass through per-server groups if specified
    };
  });

  const virtualServersWithConfig = VPS_CONFIGS.map((config, index) => ({
    server: new VirtualServer({ ...config.args, index }),
    groups: config.groups,
  }));

  const virtualServers = virtualServersWithConfig.map((v) => v.server);

  // create A DNS records for each web server in this stack
  // For dev: dev.example.com, www.dev.example.com
  // For staging: staging.example.com, www.staging.example.com
  // For prod: example.com, www.example.com
  const webVirtualServers = virtualServers.filter((vs) =>
    vs.tags.apply((ts) => ts.includes(VpsTag.Web as string)),
  );

  webVirtualServers.map((vs) =>
    vs.ipv4.apply((ipv4) => {
      new DnsRecord({
        content: ipv4,
        type: "A",
        domain,
        subdomain: envPrefix ?? "@",
      });
      new DnsRecord({
        content: ipv4,
        type: "A",
        domain,
        subdomain: envPrefix ? `www.${envPrefix}` : "www",
      });
    }),
  );

  // export the outputs we care about so they can be consumed by maestro
  // includes per-server groups override for security hardening if specified
  // includes effectiveDomain for Ansible nginx configuration
  const hosts = virtualServersWithConfig.map((v) => {
    const base: PulumiProgramOutputs["hosts"][number] = {
      hostname: v.server.sshHostname,
      tags: v.server.tags,
      effectiveDomain: v.server.effectiveDomain,
    };
    if (v.groups) {
      base.groups = v.groups;
    }
    return base;
  });

  // Provision the per-stack managed Postgres tier when enabled. Each stack gets its
  // OWN cluster + app database + least-privilege app user, joined to the same VPC as
  // this stack's droplets so the backend reaches it over the private endpoint with TLS.
  let managedDatabase: ManagedDatabase | undefined;
  if (databaseConfig.enabled) {
    const postgresUser = stackConfig.require("postgresUser");
    const postgresDb = stackConfig.require("postgresDb");

    managedDatabase = new ManagedDatabase({
      stackName,
      version: databaseConfig.version || DATABASE_DEFAULTS.version,
      size:
        (databaseConfig.size && DATABASE_SIZE_MAP[databaseConfig.size]) ||
        DATABASE_DEFAULTS.size,
      // Co-located with the droplets in the shared VPC's region.
      region,
      nodeCount: databaseConfig.nodeCount || DATABASE_DEFAULTS.nodeCount,
      vpcUuid: vpc.id,
      database: postgresDb,
      user: postgresUser,
      // The firewall trusts the project-namespaced stack tag (applied to every
      // droplet via allTags), not the disposable droplet id which changes on every
      // rebuild.
      trustedDropletTag: stackTag,
    });
  }

  const outputs: PulumiProgramOutputs = { hosts };

  // Connection bundle Maestro reads to wire the backend to its database. Present
  // only when this stack enabled the database (matching the old `postgres` export,
  // which was undefined when disabled).
  if (managedDatabase) {
    outputs.postgres = {
      host: managedDatabase.host,
      port: managedDatabase.port,
      user: managedDatabase.user,
      database: managedDatabase.database,
      password: managedDatabase.password,
      // doadmin creds, used only to grant the app user privileges before migrating.
      adminUser: managedDatabase.adminUser,
      adminPassword: managedDatabase.adminPassword,
      sslmode: "require",
    };
  }

  return outputs;
}
