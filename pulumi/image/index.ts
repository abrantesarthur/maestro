import * as pulumi from "@pulumi/pulumi";
import * as digitalOcean from "@pulumi/digitalocean";
import {
  DnsRecord,
  ZoneSettings,
  VirtualServer,
  VirtualServerArgs,
  VpsTag,
} from "./resources";

const stackConfig = new pulumi.Config("maestro");
const domain = stackConfig.require("domain");
console.log({ domain });

// enforce zone-level settings
new ZoneSettings({ domain });

// provision the virtual private servers.
const VPS_ARGS: Omit<VirtualServerArgs, "index">[] = [
  {
    image: "ubuntu-25-04-x64",
    size: digitalOcean.DropletSlug.DropletS1VCPU1GB,
    region: digitalOcean.Region.NYC1,
    sshKeys: ["51520910"],
    tags: [VpsTag.Prod, VpsTag.Backend, VpsTag.Web],
  },
];
const virtualServers = VPS_ARGS.map(
  (a, index) => new VirtualServer({ ...a, index }),
);

// create A DNS records for each web production server
const webProdVirualServers = virtualServers.filter((vs) =>
  vs.tags.apply((ts) => ts.includes(VpsTag.Web) && ts.includes(VpsTag.Prod)),
);

webProdVirualServers.map((vs) =>
  vs.ipv4.apply((ipv4) => {
    new DnsRecord({ content: ipv4, type: "A", domain });
    new DnsRecord({ content: ipv4, type: "A", domain, subdomain: "www" });
  }),
);

// export the outputs we care about so they can be consumed by the pulumi cli
export const hosts = virtualServers.map((vs) => ({
  hostname: vs.sshHostname,
  tags: vs.tags,
}));
