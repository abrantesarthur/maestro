import { server } from "./providers";
import { DnsRecord, DnsRecordArgs } from "./resources";

const ipv4 = server.getIPv4();
const DNS_RECORDS: DnsRecordArgs[] = [
  {
    ipv4,
    type: "A",
    domain: "dalhe.ai",
  },
  // TOOD: support CNAME for a tunnel
];

// create the DNS records
DNS_RECORDS.forEach((r) => {
  new DnsRecord(r);
});
