import * as pulumi from "@pulumi/pulumi";

/** The options for creating a cloudflared command */
export interface InstallCloudflaredOptions {
  /** Resource name prefix used for the command instances */
  namePrefix: string;
  /** the tunnel resource backing the command */
  tunnel: pulumi.CustomResource;
  /** The IP of the server whose tunnel is being set up */
  ipv4: pulumi.Input<string>;
  /** The cloudflare account ID */
  accountId: pulumi.Input<string>;
  /** the cloudflare api key */
  cloudflareApiToken: pulumi.Input<string>;
}
