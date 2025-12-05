import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import * as digitalOcean from "@pulumi/digitalocean";
import * as tls from "@pulumi/tls";
import { installCertificate } from "../commands/installCertificate";
import { Tunnel, TunnelIngress, TunnelIngressProtocol } from "./tunnel";

/** The arguments for constructing a VirtualServer instance */
export interface VirtualServerArgs {
  /** The DNS domain */
  image: pulumi.Input<string>;
  /** The virtual server size */
  size: pulumi.Input<digitalOcean.DropletSlug>;
  /** The virtual server region */
  region: pulumi.Input<digitalOcean.Region>;
  /** A list of SSH key IDs to enable in this virtual server */
  sshKeys: pulumi.Input<string[]>;
  /** A list of tags to add to this droplet (environment + roles + custom) */
  tags: pulumi.Input<string[]>;
  /** The virtual server index */
  index: pulumi.Input<number>;
}

/** The pre-defined tag values for a VirtualServer */
export enum VpsTag {
  /** The VPS runs the development environment */
  Dev = "dev",
  /** The VPS runs the staging environment */
  Staging = "staging",
  /** The VPS runs the production environment */
  Prod = "prod",
  /** The VPS hosts the backend application */
  Backend = "backend",
  /** The VPS hosts the web application */
  Web = "web",
}

export class VirtualServer extends pulumi.ComponentResource {
  readonly id: pulumi.Output<string>;
  readonly name: pulumi.Output<string>;
  readonly tags: pulumi.Output<string[]>;
  readonly ipv4: pulumi.Output<string>;
  readonly index: pulumi.Output<number | undefined>;
  readonly sshHostname: pulumi.Output<string>;
  readonly httpHostname: pulumi.Output<string>;

  constructor(args: VirtualServerArgs, opts?: pulumi.ComponentResourceOptions) {
    super("dalhe:VirtualServer", VirtualServer.buildResourceName(args), opts);
    const name = VirtualServer.buildResourceName(args);
    const { image, size, region, sshKeys, tags } = args;

    const virtualServer = new digitalOcean.Droplet(
      name,
      {
        image,
        size,
        region,
        sshKeys,
        name,
        tags,
      },
      { parent: this },
    );

    const stackConfig = new pulumi.Config("maestro");
    const domain = stackConfig.require("domain");
    const backendPort = stackConfig.require("backendPort");
    const certHostnames = [`*.${domain}`, domain];
    const privateKey = new tls.PrivateKey(
      `cert-key-${name}`,
      {
        algorithm: "RSA",
        rsaBits: 2048,
      },
      { parent: virtualServer },
    );
    const certificateRequest = new tls.CertRequest(
      `cert-csr-${name}`,
      {
        privateKeyPem: pulumi.secret(privateKey.privateKeyPem),
        dnsNames: certHostnames,
        subject: {
          commonName: domain,
        },
      },
      { parent: virtualServer },
    );
    const originCaCertificate = new cloudflare.OriginCaCertificate(
      `cert-ca-${name}`,
      {
        csr: certificateRequest.certRequestPem,
        hostnames: certHostnames,
        requestType: "origin-rsa",
        requestedValidity: 5475, // 15 years
      },
      { parent: virtualServer },
    );
    installCertificate({
      nameSuffix: name,
      ipv4: virtualServer.ipv4Address,
      certificatePem: pulumi.secret(originCaCertificate.certificate),
      privateKeyPem: pulumi.secret(privateKey.privateKeyPem),
      parent: virtualServer,
      dependsOn: [virtualServer, originCaCertificate],
    });

    // create one tunnel per server so we can SSH and send http requests via hostnames while hiding the IP.
    // IMPORTANT: For now we support only one prod server. To add more, we need to consider
    // how to load balance requests from api.dalhe.ai to 2 production servers.
    const ingresses = pulumi
      .all([args.index, args.tags])
      .apply(([index, tags]) => {
        const ingressList: TunnelIngress[] = [
          {
            hostname: `ssh${index}.${domain}`,
            protocol: TunnelIngressProtocol.Ssh,
            port: 22,
          },
        ];
        if (tags.includes(VpsTag.Backend as string)) {
          const isStaging = tags.includes(VpsTag.Staging as string);
          const isDev = tags.includes(VpsTag.Dev as string);
          const envPrefix = isDev ? "dev-" : isStaging ? "staging-" : "";
          ingressList.push({
            hostname: `${envPrefix}api.${domain}`,
            protocol: TunnelIngressProtocol.Http,
            port: Number(backendPort),
          });
        }
        return ingressList;
      });

    const tunnel = new Tunnel(
      {
        name,
        ipv4: virtualServer.ipv4Address,
        ingresses,
      },
      { parent: virtualServer },
    );

    this.id = virtualServer.id;
    this.name = virtualServer.name;
    this.tags = virtualServer.tags.apply((t) => t ?? []);
    this.ipv4 = virtualServer.ipv4Address;
    this.index = pulumi.output(args.index);
    this.sshHostname = tunnel.sshHostname;
    this.httpHostname = tunnel.httpHostname;
    this.registerOutputs({
      id: this.id,
      name: this.name,
      tags: this.tags,
      ipv4: this.ipv4,
      index: this.index,
    });
  }

  /**
   * Build the Pulumi resource name, encoding every attribute that should trigger replacement.
   *
   * @param a - the arguments for building a VirtualServer
   * @returns the name of the VirtualServer record within Pulumi
   */
  private static buildResourceName = (a: VirtualServerArgs): string =>
    `vps-${a.index}-${a.image}-${a.size}-${a.region}`;
}
