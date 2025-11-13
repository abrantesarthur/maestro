import * as command from "@pulumi/command";
import * as pulumi from "@pulumi/pulumi";
import path from "node:path";

/** The options for creating a cloudflared command */
export interface SetCloudflaredOptions {
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

/**
 * Creates a pulumi command that runs the start.sh script on create and stop.sh on destroy
 * of an cloudflare tunnel.
 *
 * The start.sh script installs and runs a cloudflared program in the remote server that we
 * are setting up the tunnel for. This effectivelly establishes the tunnelling connection
 * between the server and cloudflare.
 *
 * The stop.sh script stops the cloudflared daemon in the server, thus removing its connection
 * to the tunnel. Otherwise, cloudflare blocks pulumi from destroying the tunnel.
 *
 * @param params - the arguments
 * @returns - a pulumi command
 */
export const createSetCloudflaredCommand = ({
  namePrefix,
  ipv4,
  accountId,
  tunnel,
  cloudflareApiToken,
}: SetCloudflaredOptions): command.local.Command => {
  const localScript = JSON.stringify(path.resolve(__dirname, "start.sh"));
  const remoteScript = JSON.stringify("/tmp/start.sh");
  const stopScript = JSON.stringify(path.resolve(__dirname, "stop.sh"));
  const identityFile = "/root/.ssh/ssh_dalhe_ai";
  const apiTokenEnvVar = "CLOUDFLARE_API_TOKEN";
  const hostEnvVar = "HOST";
  const tunnelId = tunnel.id;

  return new command.local.Command(
    `${namePrefix}-set-cloudflared`,
    {
      interpreter: ["/bin/bash", "-c"],
      environment: {
        // pass sensitive values in the environment to avoid log leaks
        [apiTokenEnvVar]: pulumi.secret(cloudflareApiToken),
        [hostEnvVar]: pulumi.secret(ipv4),
      },
      create: pulumi
        .all({
          host: ipv4,
          accountId,
          tunnelId,
          apiToken: cloudflareApiToken,
        })
        .apply(({ host, accountId, tunnelId, apiToken }) => {
          // keep dependencies so changes trigger replacements without leaking the value
          void apiToken;
          void host;
          const lines = [
            "set -euo pipefail",
            "",
            // pre-populate ~/.ssh/known_hosts so the host is trusted by scp and ssh
            `ssh-keyscan $${hostEnvVar} >> ~/.ssh/known_hosts`,
            "",
            `scp -i ${identityFile} ${localScript} root@$${hostEnvVar}:${remoteScript}`,
            "",
            [
              `ssh -i ${identityFile} root@$${hostEnvVar} bash ${remoteScript}`,
              ` --cloudflare-account-id ${accountId}`,
              ` --cloudflare-tunnel-id ${tunnelId}`,
              ` --cloudflare-api-key $${apiTokenEnvVar}`,
            ].join(""),
          ];

          return lines.join("\n");
        }),
      delete: pulumi
        .output(ipv4)
        .apply((host) => `bash ${stopScript} ${JSON.stringify(host)}`),
    },
    {
      parent: tunnel,
      dependsOn: tunnel,
    },
  );
};
