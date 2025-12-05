import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import { DnsRecord } from "./dnsRecord";
import { installCloudflared } from "../commands";

export enum TunnelIngressProtocol {
  Http = "http",
  Ssh = "ssh",
}

/** The Tunnel configuration options */
export interface TunnelIngress {
  /** Fully qualified domain name Cloudflare will route to this ingress. */
  hostname: pulumi.Input<string>;
  /** Protocol used by the origin service (http or ssh). */
  protocol: pulumi.Input<TunnelIngressProtocol>;
  /** Local port on the origin instance the tunnel forwards to. */
  port: pulumi.Input<number>;
}

/** Arguments for constructing a Tunnel component */
export interface TunnelArgs {
  /** Human-friendly tunnel name shown in Cloudflare Zero Trust */
  name: string;
  /** The IPv4 address of the server this tunnel refers to */
  ipv4: pulumi.Input<string>;
  /** List of ingress rules (hostname/protocol/port) to expose through the tunnel. */
  ingresses: pulumi.Input<TunnelIngress[]>;
}

export class Tunnel extends pulumi.ComponentResource {
  readonly sshHostname: pulumi.Output<string>;
  readonly httpHostname: pulumi.Output<string>;

  constructor(args: TunnelArgs, opts?: pulumi.ComponentResourceOptions) {
    super(
      "dalhe:cloudflare:Tunnel",
      Tunnel.buildResourceName(args.name),
      {},
      opts,
    );
    const resourceName = Tunnel.buildResourceName(args.name);
    const stackConfig = new pulumi.Config("maestro");
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

    this.validateIngresses(args.ingresses, domain);
    const ingresses = pulumi.output(args.ingresses);

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
          ingresses: ingresses.apply((is) => [
            ...is.map((i) => ({
              hostname: i.hostname,
              service: `${i.protocol}://localhost:${i.port}`,
            })),
            {
              service: "http_status:404",
            },
          ]),
        },
        source: configSrc,
      },
      { parent: tunnel },
    );

    // create the CNAME dns records, one for each ingress hostname
    const hostnamesByProtocol = ingresses.apply((is) => {
      const ssh: string[] = [];
      const http: string[] = [];
      is.forEach((i) => {
        const subdomain = i.hostname.split(".")[0];
        new DnsRecord(
          {
            content: pulumi.interpolate`${tunnel.id}.cfargotunnel.com`,
            type: "CNAME",
            domain,
            subdomain,
          },
          { parent: this },
        );
        if (i.protocol === TunnelIngressProtocol.Ssh) {
          ssh.push(`${subdomain}.${domain}`);
        } else if (i.protocol === TunnelIngressProtocol.Http) {
          http.push(`${subdomain}.${domain}`);
        }
      });
      return { ssh, http };
    });
    this.sshHostname = hostnamesByProtocol.apply((h) => h.ssh)[0];
    this.httpHostname = hostnamesByProtocol.apply((h) => h.http)[0];

    // create a commands to set and destroy cloudflared on set and destroy this Tunnel
    installCloudflared({
      namePrefix: resourceName,
      ipv4,
      accountId,
      tunnel,
      cloudflareApiToken: CLOUDFLARE_API_TOKEN,
    });

    this.registerOutputs({
      sshHostnames: this.sshHostname,
      httpHostnames: this.httpHostname,
    });
  }

  private validateIngresses(
    ingresses: pulumi.Input<TunnelIngress[]>,
    domain: string,
  ): void {
    const domainSuffix = `.${domain}`;
    pulumi.output(ingresses).apply((is) => {
      const seen = new Set<string>();
      let sshCount = 0;
      let httpCount = 0;
      is.forEach((ingress) => {
        if (ingress.protocol === TunnelIngressProtocol.Ssh) {
          sshCount += 1;
        }
        if (ingress.protocol === TunnelIngressProtocol.Http) {
          httpCount += 1;
        }
        const h = ingress.hostname;
        if (h.length === 0) {
          return;
        }
        if (seen.has(h)) {
          throw new Error(`Duplicate Tunnel ingress hostname: ${h}`);
        }
        seen.add(h);
        if (!h.endsWith(domainSuffix)) {
          throw new Error(
            `Every Tunnel ingress hostname must end with "${domainSuffix}"`,
          );
        }

        const subdomain = h.slice(0, -domainSuffix.length);
        if (subdomain.length === 0 || subdomain.includes(".")) {
          throw new Error(
            `Every Tunnel hostname must be in the form <subdomain>${domainSuffix}`,
          );
        }
      });
      if (sshCount !== 1) {
        throw new Error("Exactly one SSH ingress must be provided per tunnel.");
      }
      if (httpCount !== 1) {
        throw new Error(
          "Exactly one HTTP ingress must be provided per tunnel.",
        );
      }
    });
  }

  private static buildResourceName = (name: string): string => `tunnel-${name}`;
}
