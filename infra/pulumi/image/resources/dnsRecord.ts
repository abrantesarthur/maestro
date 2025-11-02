import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";

/** The arguments for constructing a DnsRecord instance */
export interface DnsRecordArgs {
  /** The DNS domain */
  domain: pulumi.Input<string>;
  /** the subdomain for the DNS record. Defaults to "@", the zone apex. */
  subdomain?: pulumi.Input<string>;
  /** Time To Live (TTL) of the DNS record in seconds. Defaults to automatic. */
  ttl?: pulumi.Input<number>;
  /** The DNS record type. Defaults to 'A' */
  type: pulumi.Input<"A" | "CNAME">;
  /** The DNS record's IPv4 address, its content. */
  ipv4: pulumi.Input<string>;
  /** Whether Cloudflare should proxy the record. Defaults to true. */
  proxied?: pulumi.Input<boolean>;
}

export class DnsRecord extends pulumi.ComponentResource {
  readonly record: cloudflare.DnsRecord;
  readonly domain: pulumi.Input<string>;

  constructor(args: DnsRecordArgs) {
    super("dalhe:cloudflare:DnsRecord", DnsRecord.buildResourceName(args), {});
    const name = DnsRecord.buildResourceName(args);

    const defaults: Required<Pick<DnsRecordArgs, "subdomain" | "ttl" | "proxied">> = {
      subdomain: "@",
      ttl: 1,
      proxied: true,
    };
    const { domain, subdomain, ttl, type, ipv4, proxied } = { ...defaults, ...args };

    this.domain = domain;

    this.record = new cloudflare.DnsRecord(name, {
      name: subdomain,
      ttl,
      type,
      zoneId: this.getZoneId(),
      content: ipv4,
      proxied,
    }, {parent: this});

    this.registerOutputs({
      recordId: this.record.id,
    });
  }

  /**
   * Resolve a the Cloudflare zone identifier from its domain name.
   *
   * @returns the Cloudflare zone ID as a Pulumi Output
   */
  getZoneId = (): pulumi.Output<string> =>
    pulumi.output(this.domain).apply(async (dnsName) => {
      const { results } = await cloudflare.getZones({ name: dnsName, match: "all" });
      const zone = results.find((zone) => zone.name === dnsName);
      if (!zone) {
        throw new Error(`Cloudflare zone for ${dnsName} not found.`);
      }
      return zone.id;
    });

  /**
   * Build the Pulumi resource name, encoding every attribute that should trigger replacement.
   * Pulumi keys resources by this string; including subdomain, type, and IPv4 ensures a change
   * in any of these fields results in a new record instead of silently reusing the old one.
   *
   * @param a - the arguments for building a DnsRecord
   * @returns the name of the DNS record within Pulumi
   */
  static buildResourceName = (a: DnsRecordArgs): string =>
    `${a.subdomain ? `${a.subdomain}.` : ""}${a.domain}_${a.type}_${a.ipv4}`;
}
