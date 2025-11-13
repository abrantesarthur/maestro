import * as pulumi from "@pulumi/pulumi";
import { getVirtualServers } from "./providers";
import {
  DnsRecord,
  DnsRecordArgs,
  SshTunnel,
  SshTunnelArgs,
} from "./resources";

// get the provisioned servers
const stackConfig = new pulumi.Config("dalhe");
const domain = stackConfig.require("domain");
const prodIpv4s = stackConfig.getObject<string[]>("prodIpv4s");
const virtualServers = getVirtualServers(prodIpv4s ? { ipv4: prodIpv4s } : {});

// create one ssh tunnel for each virtual server
const SSH_TUNNELS: SshTunnelArgs[] = virtualServers.map((vs) => {
  const tunnelName =
    (vs.tags ?? []).find((t) => t.startsWith("ssh-")) ?? `ssh-${vs.name}`;
  return {
    name: tunnelName,
    ipv4: vs.ipv4,
    hostname: `${tunnelName}.${domain}`,
  };
});
const sshTunnels = SSH_TUNNELS.map((t) => new SshTunnel(t));

// FIXME: support creating DNS records for multiple servers (or for only the webservers)
// create A DNS records for each production server
const DNS_RECORDS: DnsRecordArgs[] = [
  { content: virtualServers[0].ipv4, type: "A", domain },
  { content: virtualServers[0].ipv4, type: "A", domain, subdomain: "www" },
];
DNS_RECORDS.forEach((r) => {
  new DnsRecord(r);
});

// export the outputs we care about so they can be consumed by the pulumi cli
export const sshHostnames = sshTunnels.map((t) => t.hostname);
