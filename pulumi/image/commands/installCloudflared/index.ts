import * as command from "@pulumi/command";
import * as pulumi from "@pulumi/pulumi";
import path from "node:path";
import { InstallCloudflaredOptions } from "./types";

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
export const installCloudflared = ({
  namePrefix,
  ipv4,
  accountId,
  tunnel,
  cloudflareApiToken,
}: InstallCloudflaredOptions): command.local.Command => {
  const localStart = JSON.stringify(path.resolve(__dirname, "start.sh"));
  const remoteStart = JSON.stringify("/tmp/start.sh");
  const localStop = JSON.stringify(path.resolve(__dirname, "stop.sh"));
  const stackConfig = new pulumi.Config("maestro");
  const sshKeyPath = stackConfig.require("sshKeyPath");
  const apiTokenEnvVar = "CLOUDFLARE_API_TOKEN";
  const hostEnvVar = "HOST";
  const tunnelId = tunnel.id;
  const retryAttempts = 30;
  const retryDelaySeconds = 5;

  return new command.local.Command(
    `${namePrefix}-cloudflared`,
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

          /**
           * Wraps a command with a retry policy.
           * @param cmd - the command to retry
           * @returns retriable command
           * */
          const withRetry = (cmd: string): string =>
            `with_retry ${retryAttempts} ${retryDelaySeconds} ${cmd}`;
          const lines = [
            "set -euo pipefail",
            "",
            "with_retry() {",
            "  local attempts=$1",
            "  shift",
            "  local delay=$1",
            "  shift",
            "  local attempt=1",
            "  while true; do",
            '    if "$@"; then',
            "      return 0",
            "    fi",
            "    if (( attempt >= attempts )); then",
            "      return 1",
            "    fi",
            "    attempt=$((attempt + 1))",
            '    sleep "$delay"',
            "  done",
            "}",
            "",
            "mkdir -p ~/.ssh",
            "chmod 700 ~/.ssh",
            "touch ~/.ssh/known_hosts",
            "",
            // pre-populate ~/.ssh/known_hosts so the host is trusted by scp and ssh
            withRetry(`ssh-keyscan $${hostEnvVar} >> ~/.ssh/known_hosts`),
            "",
            withRetry(
              `scp -i ${sshKeyPath} ${localStart} root@$${hostEnvVar}:${remoteStart}`,
            ),
            "",
            withRetry(
              [
                `ssh -i ${sshKeyPath} root@$${hostEnvVar} bash ${remoteStart}`,
                ` --cloudflare-account-id ${accountId}`,
                ` --cloudflare-tunnel-id ${tunnelId}`,
                ` --cloudflare-api-key $${apiTokenEnvVar}`,
              ].join(""),
            ),
          ];

          return lines.join("\n");
        }),
      delete: pulumi
        .output(ipv4)
        .apply(
          (host) =>
            `SSH_KEY_PATH=${sshKeyPath} bash ${localStop} ${JSON.stringify(
              host,
            )}`,
        ),
    },
    {
      parent: tunnel,
      dependsOn: tunnel,
    },
  );
};
