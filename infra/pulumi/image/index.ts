import * as pulumi from "@pulumi/pulumi";
import { getVirtualServers } from "./providers";
import { SshTunnel, DnsRecord, DnsRecordArgs } from "./resources";

const stackConfig = new pulumi.Config("dalhe");
const domain = stackConfig.require("domain");
const tunnelHostname = stackConfig.require("tunnelHostname");
new SshTunnel({
  name: "ssh",
  configuration: {
    ingresses: [
      {
        hostname: tunnelHostname,
        service: "ssh://localhost:22",
      },
      {
        service: "http_status:404",
      },
    ],
  },
});

// create A DNS records for each production server
const prodIpv4s = stackConfig.getObject<string[]>("prodIpv4s");
const virtualServers = getVirtualServers(prodIpv4s ? { ipv4: prodIpv4s } : {});
const DNS_RECORDS: DnsRecordArgs[] = virtualServers.reduce<DnsRecordArgs[]>(
  (acc, prev) => [
    ...acc,
    { content: prev.ipv4, type: "A", domain },
    { content: prev.ipv4, type: "A", domain, subdomain: "www" },
  ],
  [],
);
DNS_RECORDS.forEach((r) => {
  new DnsRecord(r);
});
