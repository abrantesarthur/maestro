import * as pulumi from "@pulumi/pulumi";

/** The options for installing an Origin CA certificate in a remote host */
export interface InstallCertificateOptions {
  /** Resource name suffix used for the command instances */
  nameSuffix: string;
  /** The IPv4 address of the server receiving the certificate */
  ipv4: pulumi.Input<string>;
  /** The certificate body */
  certificatePem: pulumi.Input<string>;
  /** The private key that matches the certificate */
  privateKeyPem: pulumi.Input<string>;
  /** Optional parent resource */
  parent?: pulumi.Resource;
  /** dependencies */
  dependsOn: pulumi.Input<pulumi.Resource>[];
}
