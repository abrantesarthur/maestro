import * as pulumi from "@pulumi/pulumi";
import * as digitalOcean from "@pulumi/digitalocean";
import {
  DnsRecord,
  ZoneSettings,
  VirtualServer,
  VirtualServerArgs,
  VpsTag,
} from "./resources";

/** Server configuration from maestro.yaml */
interface ServerConfig {
  roles: string[];
  tags?: string[];
  groups?: string[]; // Optional per-server groups override for security hardening
  image?: string;
  size?: string;
  region?: string;
}

const stackConfig = new pulumi.Config("maestro");
const domain = stackConfig.require("domain");

// Get the current stack name (dev, staging, or prod) to use as environment tag
const stackName = pulumi.getStack();

// Read servers configuration from maestro.yaml (passed via Pulumi config)
const serversJson = stackConfig.require("servers");
const serversConfig: ServerConfig[] = JSON.parse(serversJson);

// enforce zone-level settings
new ZoneSettings({ domain });

// Map DigitalOcean size strings to DropletSlug enum
const sizeMap: Record<string, digitalOcean.DropletSlug> = {
  "s-1vcpu-1gb": digitalOcean.DropletSlug.DropletS1VCPU1GB,
  "s-1vcpu-2gb": digitalOcean.DropletSlug.DropletS1VCPU2GB,
  "s-2vcpu-2gb": digitalOcean.DropletSlug.DropletS2VCPU2GB,
  "s-2vcpu-4gb": digitalOcean.DropletSlug.DropletS2VCPU4GB,
  "s-4vcpu-8gb": digitalOcean.DropletSlug.DropletS4VCPU8GB,
};

// Map region strings to Region enum
const regionMap: Record<string, digitalOcean.Region> = {
  nyc1: digitalOcean.Region.NYC1,
  nyc2: digitalOcean.Region.NYC2,
  nyc3: digitalOcean.Region.NYC3,
  sfo1: digitalOcean.Region.SFO1,
  sfo2: digitalOcean.Region.SFO2,
  sfo3: digitalOcean.Region.SFO3,
  ams2: digitalOcean.Region.AMS2,
  ams3: digitalOcean.Region.AMS3,
  lon1: digitalOcean.Region.LON1,
  fra1: digitalOcean.Region.FRA1,
  tor1: digitalOcean.Region.TOR1,
  blr1: digitalOcean.Region.BLR1,
  sgp1: digitalOcean.Region.SGP1,
};

// Build VirtualServerArgs from config, combining stack name + roles + custom tags
// Also preserve per-server groups for security hardening
interface VpsConfig {
  args: Omit<VirtualServerArgs, "index">;
  groups?: string[]; // Per-server groups override
}

const VPS_CONFIGS: VpsConfig[] = serversConfig.map((server) => {
  // Combine all tags: stack name (as environment) + roles + custom tags
  const allTags: string[] = [
    stackName,
    ...server.roles,
    ...(server.tags || []),
  ];

  const size = server.size || "s-1vcpu-1gb";
  const region = server.region || "nyc1";

  return {
    args: {
      image: server.image || "ubuntu-25-04-x64",
      size: sizeMap[size] || digitalOcean.DropletSlug.DropletS1VCPU1GB,
      region: regionMap[region] || digitalOcean.Region.NYC1,
      sshKeys: ["51520910"], // TODO: make this configurable
      tags: allTags,
    },
    groups: server.groups, // Pass through per-server groups if specified
  };
});

const virtualServersWithConfig = VPS_CONFIGS.map((config, index) => ({
  server: new VirtualServer({ ...config.args, index }),
  groups: config.groups,
}));

const virtualServers = virtualServersWithConfig.map((v) => v.server);

// create A DNS records for each web production server
const webProdVirualServers = virtualServers.filter((vs) =>
  vs.tags.apply(
    (ts) =>
      ts.includes(VpsTag.Web as string) && ts.includes(VpsTag.Prod as string),
  ),
);

webProdVirualServers.map((vs) =>
  vs.ipv4.apply((ipv4) => {
    new DnsRecord({ content: ipv4, type: "A", domain });
    new DnsRecord({ content: ipv4, type: "A", domain, subdomain: "www" });
  }),
);

// export the outputs we care about so they can be consumed by the pulumi cli
// includes per-server groups override for security hardening if specified
export const hosts = virtualServersWithConfig.map((v) => {
  const base: {
    hostname: pulumi.Output<string>;
    tags: pulumi.Output<string[]>;
    groups?: string[];
  } = {
    hostname: v.server.sshHostname,
    tags: v.server.tags,
  };
  if (v.groups) {
    base.groups = v.groups;
  }
  return base;
});
