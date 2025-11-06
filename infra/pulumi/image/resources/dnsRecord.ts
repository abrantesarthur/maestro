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
  /** The DNS record's content (e.g., an IPv4 address). */
  content: pulumi.Input<string>;
  /** Whether Cloudflare should proxy the record. Defaults to true. */
  proxied?: pulumi.Input<boolean>;
}

/** A bag of options that control this resource's behavior. */
export interface DnsRecordOptions {
  /** An optional parent resource to which this resource belongs. */
  parent?: pulumi.Resource;
}

export class DnsRecord extends pulumi.ComponentResource {
  readonly id: pulumi.Output<string>;

  constructor(args: DnsRecordArgs, opts?: DnsRecordOptions) {
    super("dalhe:cloudflare:DnsRecord", DnsRecord.buildResourceName(args), {
      ...(opts?.parent ? { parent: opts.parent } : {}),
    });
    const name = DnsRecord.buildResourceName(args);

    const defaults: Required<
      Pick<DnsRecordArgs, "subdomain" | "ttl" | "proxied">
    > = {
      subdomain: "@",
      ttl: 1,
      proxied: true,
    };
    const { domain, subdomain, ttl, type, content, proxied } = {
      ...defaults,
      ...args,
    };

    const record = new cloudflare.DnsRecord(
      name,
      {
        name: subdomain,
        ttl,
        type,
        zoneId: this.getZoneId(domain),
        content,
        proxied,
      },
      { parent: this },
    );

    this.id = record.id;
    this.registerOutputs({
      id: this.id,
    });
  }

  /**
   * Resolve a the Cloudflare zone identifier from its domain name.
   *
   * @param domain
   * @returns the Cloudflare zone ID as a Pulumi Output
   */
  private getZoneId = (domain: pulumi.Input<string>): pulumi.Output<string> =>
    pulumi.output(domain).apply(async (dnsName) => {
      const { results } = await cloudflare.getZones({
        name: dnsName,
        match: "all",
      });
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
  private static buildResourceName = (a: DnsRecordArgs): string =>
    `dns-${a.subdomain ? a.subdomain : a.domain}-${a.type}`;
}
