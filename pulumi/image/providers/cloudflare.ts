import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";

/**
 * Get a cloudflare zone id from a domain.
 * @param domain the cloudflare domain from which to get the zone
 * @returns a zone id
 */
export const getZoneId = (
  domain: pulumi.Input<string>,
): pulumi.Output<string> =>
  pulumi.output(domain).apply(async (dnsName) => {
    const { results } = await cloudflare.getZones({
      name: dnsName,
      match: "all",
    });
    const zone = results.find((z) => z.name === dnsName);
    if (!zone) {
      throw new Error(`Cloudflare zone for ${dnsName} not found.`);
    }
    return zone.id;
  });
