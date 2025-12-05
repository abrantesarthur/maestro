import * as command from "@pulumi/command";
import * as pulumi from "@pulumi/pulumi";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  REMOTE_CERT_DIR,
  REMOTE_CERT_PATH,
  REMOTE_KEY_DIR,
  REMOTE_KEY_PATH,
} from "./constants";
import { InstallCertificateOptions } from "./types";

/**
 * Reads the ssh key file, ensuring it exists.
 * @returns the ssh key
 * */
const readSshKey = (): string => {
  const stackConfig = new pulumi.Config("maestro");
  const sshKeyPath = stackConfig.require("sshKeyPath");
  try {
    return fs.readFileSync(sshKeyPath, "utf8");
  } catch (error) {
    throw new Error(
      `Failed to read SSH identity file at ${sshKeyPath}: ${
        error instanceof Error ? error.message : error
      }`,
    );
  }
};

/**
 * Hashes the value
 * @param value the value to hash
 * @returns the hashed value
 */
const createContentHash = (
  value: pulumi.Input<string>,
): pulumi.Output<string> =>
  pulumi.output(value).apply((content) => {
    if (content === undefined) {
      return "pending";
    }
    return crypto.createHash("sha256").update(content).digest("hex");
  });

/**
 * Materializes content into a temp file because CopyToRemote only accepts path-based assets.
 * @param filename the name of the file to create under the temp directory
 * @param contents the content to write into the file
 * @returns a FileAsset pointing to the created file
 */
const createTempFileAsset = (
  filename: string,
  contents: pulumi.Input<string>,
): pulumi.Output<pulumi.asset.FileAsset> => {
  const directory = path.join(os.tmpdir(), "pulumi-cert-assets");
  return pulumi.output(contents).apply((content) => {
    if (content === undefined) {
      throw new Error("Certificate content is undefined; cannot create asset");
    }
    fs.mkdirSync(directory, { recursive: true });
    const filePath = path.join(directory, filename);
    fs.writeFileSync(filePath, content, { encoding: "utf8", mode: 0o600 });
    return new pulumi.asset.FileAsset(filePath);
  });
};

/**
 * Installs the provided Origin CA certificate and private key into the remote host.
 *
 * @param options - configuration for connecting to the host and the PEM payloads
 * @returns the remote command that enforces permissions on the installed files
 */
export const installCertificate = ({
  nameSuffix,
  ipv4,
  certificatePem,
  privateKeyPem,
  parent,
  dependsOn,
}: InstallCertificateOptions): command.remote.Command => {
  const sshPrivateKey = readSshKey();
  const connection: command.types.input.remote.ConnectionArgs = {
    host: ipv4,
    user: "root",
    port: 22,
    privateKey: pulumi.secret(sshPrivateKey),
  };

  // create the /etc/ssl/certs and /etc/ssl/private folders in the remote host
  const prepare = new command.remote.Command(
    `prepare-cert-${nameSuffix}`,
    {
      connection,
      create: [
        "set -euo pipefail",
        `install -d -m 0755 ${REMOTE_CERT_DIR}`,
        `install -d -m 0700 ${REMOTE_KEY_DIR}`,
      ].join("\n"),
    },
    {
      parent,
      dependsOn,
    },
  );

  // hash the sensitive values so they can safely trigger command replacements in case of changes
  const privateKeyHash = createContentHash(privateKeyPem);
  const certificateHash = createContentHash(certificatePem);
  const privateKeyAsset = createTempFileAsset(
    `cert-${nameSuffix}.key`,
    privateKeyPem,
  );
  const certificateAsset = createTempFileAsset(
    `cert-${nameSuffix}.pem`,
    certificatePem,
  );

  // copy the private key to the remote server
  const installKey = pulumi
    .all([privateKeyAsset, privateKeyHash])
    .apply(([asset, hash]) => {
      return new command.remote.CopyToRemote(
        `install-key-${nameSuffix}`,
        {
          connection,
          source: asset,
          remotePath: REMOTE_KEY_PATH,
          triggers: [hash],
        },
        {
          parent,
          dependsOn: [...dependsOn, prepare],
        },
      );
    });

  // copy the certificate to the remote server
  const installCert = pulumi
    .all([certificateAsset, certificateHash])
    .apply(([asset, hash]) => {
      return new command.remote.CopyToRemote(
        `install-cert-${nameSuffix}`,
        {
          connection,
          source: asset,
          remotePath: REMOTE_CERT_PATH,
          triggers: [hash],
        },
        {
          parent,
          dependsOn: [...dependsOn, prepare],
        },
      );
    });

  // update remote permissions of the private key and certificate
  return new command.remote.Command(
    `set-cert-permissions-${nameSuffix}`,
    {
      connection,
      create: [
        "set -euo pipefail",
        `chown root:root ${REMOTE_KEY_PATH}`,
        `chmod 600 ${REMOTE_KEY_PATH}`,
        `chown root:root ${REMOTE_CERT_PATH}`,
        `chmod 644 ${REMOTE_CERT_PATH}`,
      ].join("\n"),
      triggers: [privateKeyHash, certificateHash],
    },
    {
      parent,
      dependsOn: [...dependsOn, installKey, installCert],
    },
  );
};
