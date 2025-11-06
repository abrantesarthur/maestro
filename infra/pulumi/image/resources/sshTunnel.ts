import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import { DnsRecord, DnsRecordArgs } from "./dnsRecord";

/** The SshTunnel configuration options */
export type SshTunnelConfiguration =
  cloudflare.types.input.ZeroTrustTunnelCloudflaredConfigConfig;

/** Arguments for constructing a SshTunnel component */
export interface SshTunnelArgs {
  /** Human-friendly tunnel name shown in Cloudflare Zero Trust */
  name: string;
  /** Cloudflare tunnel configuration describing ingresses and origin settings */
  configuration: pulumi.Input<SshTunnelConfiguration>;
}

export class SshTunnel extends pulumi.ComponentResource {
  readonly tunnelId: pulumi.Output<string>;
  readonly tunnelConfigId: pulumi.Output<string>;
  readonly dnsRecordIds: pulumi.Output<string[]>;

  constructor(args: SshTunnelArgs, opts?: pulumi.ComponentResourceOptions) {
    super("dalhe:cloudflare:Tunnel", args.name, opts);
    const resourceName = SshTunnel.buildResourceName(args.name);
    const stackConfig = new pulumi.Config("dalhe");
    const accountId = stackConfig.require("cloudflareAccountId");
    const domain = stackConfig.require("domain");
    const configSrc = "cloudflare";

    // ensure the configuration has valid ingresses property
    const { configuration } = args;
    pulumi.output(configuration).apply((config) => {
      const ingresses = config.ingresses ?? [];
      if (ingresses.length === 0) {
        throw new Error(
          `SshTunnel expects the "configuration.ingresses" array to be defined and not empty`,
        );
      }

      // at least one ingresses entry must have hostname
      if (ingresses.filter((i) => (i.hostname ?? "").length > 0).length === 0) {
        throw new Error(
          `At least one SshTunnel configuration.ingresses.hostname must be defined`,
        );
      }

      const domainSuffix = `.${domain}`;
      ingresses.forEach((ingress, index) => {
        const hostname = ingress.hostname ?? "";
        if (hostname.length === 0) {
          return;
        }
        if (!hostname.endsWith(domainSuffix)) {
          throw new Error(
            `SshTunnel configuration.ingresses[${index}].hostname must end with "${domainSuffix}"`,
          );
        }

        const subdomain = hostname.slice(0, -domainSuffix.length);
        if (subdomain.length === 0 || subdomain.includes(".")) {
          throw new Error(
            `SshTunnel configuration.ingresses[${index}].hostname must be in the form <subdomain>${domainSuffix}`,
          );
        }
      });
    });

    // create the tunnel
    const tunnel = new cloudflare.ZeroTrustTunnelCloudflared(
      resourceName,
      {
        accountId,
        name: resourceName,
        configSrc,
      },
      { parent: this },
    );

    // create the tunnel configuration
    const tunnelConfig = new cloudflare.ZeroTrustTunnelCloudflaredConfig(
      `${resourceName}-config`,
      {
        accountId,
        tunnelId: tunnel.id,
        config: configuration,
        source: configSrc,
      },
      { parent: this },
    );

    // create the CNAME dns records
    const dnsRecordIds = pulumi.output(configuration).apply((config) => {
      const ingresses = config.ingresses ?? [];

      const type = "CNAME";
      const records: DnsRecordArgs[] = ingresses
        .filter((i) => (i.hostname ?? "").length > 0)
        .map((i) => ({
          content: pulumi.interpolate`${tunnel.id}.cfargotunnel.com`,
          type,
          domain,
          subdomain: i.hostname!.split(".")[0],
        }));

      const recordIds = records.map((r) => {
        const createdRecord = new DnsRecord(r, { parent: this });
        return createdRecord.id;
      });

      return pulumi.all(recordIds);
    });

    this.tunnelId = tunnel.id;
    this.tunnelConfigId = tunnelConfig.id;
    this.dnsRecordIds = dnsRecordIds;
    this.registerOutputs({
      tunnelId: tunnel.id,
      tunnelConfigId: tunnelConfig.id,
      dnsRecordIds,
    });
  }

  private static buildResourceName = (name: string): string => `${name}-tunnel`;
}
