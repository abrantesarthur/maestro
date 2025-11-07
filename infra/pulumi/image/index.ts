import * as pulumi from "@pulumi/pulumi";
import { server } from "./providers";
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

const ipv4 = server.getIPv4();
const DNS_RECORDS: DnsRecordArgs[] = [
  {
    content: ipv4,
    type: "A",
    domain,
  },
  {
    content: ipv4,
    type: "A",
    domain,
    subdomain: "www",
  },
];

// create the DNS records
DNS_RECORDS.forEach((r) => {
  new DnsRecord(r);
});
