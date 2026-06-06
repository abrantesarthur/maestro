import * as pulumi from "@pulumi/pulumi";
import * as digitalOcean from "@pulumi/digitalocean";
import {
  DnsRecord,
  ManagedDatabase,
  PostgresVersion,
  ZoneSettings,
  VirtualServer,
  VirtualServerArgs,
  VpsTag,
} from "./resources";
import { SIZE_MAP, REGION_MAP, DATABASE_SIZE_MAP } from "./constants";

/** Server configuration from maestro.yaml */
interface ServerConfig {
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
 * (override wins) and passes the result as the `database` Pulumi config JSON.
 */
interface DatabaseConfig {
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

// Read servers configuration from maestro.yaml (passed via Pulumi config)
const serversJson = stackConfig.require("servers");
const serversConfig: ServerConfig[] = JSON.parse(serversJson);

// Read the merged managed-database settings (defaults + per-stack override).
// Defaults to disabled when the `database` config key is absent.
const databaseConfig: DatabaseConfig = JSON.parse(
  stackConfig.get("database") ?? "{}",
);

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
// avoid the account-global region-default VPC (shared, not isolated). retainOnDelete
// so a backend `pulumi destroy` never orphans the database that lives inside it.
//
// region is immutable: changing it on a provisioned DB stack replaces the VPC,
// which forces replacement of the protect:true cluster and Pulumi hard-stops.
// Moving regions requires the unprotect + recreate runbook (see pulumi/README.md).
const vpc = new digitalOcean.Vpc(
  `vpc-${stackName}`,
  {
    name: `vpc-${stackName}`,
    region,
  },
  { retainOnDelete: true },
);

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

  const size = server.size || digitalOcean.DropletSlug.DropletS1VCPU1GB;
  const region = server.region || digitalOcean.Region.NYC1;

  return {
    args: {
      image: server.image || "ubuntu-24-04-x64",
      size: SIZE_MAP[size] || digitalOcean.DropletSlug.DropletS1VCPU1GB,
      region: REGION_MAP[region] || digitalOcean.Region.NYC1,
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

// export the outputs we care about so they can be consumed by the pulumi cli
// includes per-server groups override for security hardening if specified
// includes effectiveDomain for Ansible nginx configuration
export const hosts = virtualServersWithConfig.map((v) => {
  const base: {
    hostname: pulumi.Output<string>;
    tags: pulumi.Output<string[]>;
    effectiveDomain: pulumi.Output<string>;
    groups?: string[];
  } = {
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

// Connection bundle Maestro reads to wire the backend to its database.
export const postgres = managedDatabase
  ? {
      host: managedDatabase.host,
      port: managedDatabase.port,
      user: managedDatabase.user,
      database: managedDatabase.database,
      password: managedDatabase.password,
      sslmode: "require",
    }
  : undefined;
