import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import { DnsRecord } from "./dnsRecord";
import { installCloudflared } from "../commands";

/** The SshTunnel configuration options */
export type SshTunnelConfiguration =
  cloudflare.types.input.ZeroTrustTunnelCloudflaredConfigConfig;

/** Arguments for constructing a SshTunnel component */
export interface SshTunnelArgs {
  /** Human-friendly tunnel name shown in Cloudflare Zero Trust */
  name: string;
  /** The hostname used to ssh into the tunnel */
  hostname: pulumi.Input<string>;
  /** The IPv4 address of the server this tunnel refers to */
  ipv4: pulumi.Input<string>;
}

export class SshTunnel extends pulumi.ComponentResource {
  readonly hostname: pulumi.Output<string>;

  constructor(args: SshTunnelArgs, opts?: pulumi.ComponentResourceOptions) {
    super("dalhe:cloudflare:Tunnel", args.name, opts);
    const resourceName = SshTunnel.buildResourceName(args.name);
    const stackConfig = new pulumi.Config("dalhe");
    const accountId = stackConfig.require("cloudflareAccountId");
    const domain = stackConfig.require("domain");
    const configSrc = "cloudflare";

    const { ipv4 } = args;

    const { CLOUDFLARE_API_TOKEN } = process.env;
    if (!CLOUDFLARE_API_TOKEN) {
      throw new Error(
        "CLOUDFLARE_API_TOKEN environment variable must be set to manage Cloudflare tunnels.",
      );
    }

    this.validateHostname(args.hostname, domain);

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
    new cloudflare.ZeroTrustTunnelCloudflaredConfig(
      `${resourceName}-config`,
      {
        accountId,
        tunnelId: tunnel.id,
        config: {
          ingresses: [
            {
              hostname: args.hostname,
              service: "ssh://localhost:22",
            },
            {
              service: "http_status:404",
            },
          ],
        },
        source: configSrc,
      },
      { parent: tunnel },
    );

    // create the CNAME dns records
    this.hostname = pulumi.output(args.hostname);
    this.hostname.apply((hostname) => {
      new DnsRecord(
        {
          content: pulumi.interpolate`${tunnel.id}.cfargotunnel.com`,
          type: "CNAME",
          domain,
          subdomain: hostname.split(".")[0],
        },
        { parent: this },
      );
    });

    // create a commands to set and destroy cloudflared on set and destroy this SshTunnel
    installCloudflared({
      namePrefix: resourceName,
      ipv4,
      accountId,
      tunnel,
      cloudflareApiToken: CLOUDFLARE_API_TOKEN,
    });

    this.registerOutputs({
      hostname: this.hostname,
    });
  }

  private validateHostname(
    hostname: pulumi.Input<string>,
    domain: string,
  ): void {
    pulumi.output(hostname).apply((h) => {
      const domainSuffix = `.${domain}`;
      if (h.length === 0) {
        return;
      }
      if (!h.endsWith(domainSuffix)) {
        throw new Error(`SshTunnel hostname must end with "${domainSuffix}"`);
      }

      const subdomain = h.slice(0, -domainSuffix.length);
      if (subdomain.length === 0 || subdomain.includes(".")) {
        throw new Error(
          `SshTunnel hostname must be in the form <subdomain>${domainSuffix}`,
        );
      }
    });
  }

  private static buildResourceName = (name: string): string => `${name}-tunnel`;
}
