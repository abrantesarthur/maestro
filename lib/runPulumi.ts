import { type StackName, type MaestroConfig } from "./config/index.ts";
import { log, runCommandWithTee } from "./helpers.ts";
import { parsePulumiHosts, mergeHosts, type PulumiHosts } from "./ssh.ts";

const SCRIPT_DIR = import.meta.dir.replace(/\/lib$/, "");
const PULUMI_RUN = `${SCRIPT_DIR}/pulumi/run.sh`;

async function capturePulumiHosts(
  stackName: StackName,
  pulumiCommand: string,
  serversJson: string,
  config: MaestroConfig,
  _sshKeyPath: string,
  showLogs: boolean = true,
): Promise<PulumiHosts> {
  const { pulumi } = config;
  const env: Record<string, string> = {
    DOMAIN: config.domain,
    CLOUDFLARE_ACCOUNT_ID: pulumi?.cloudflareAccountId ?? "",
    SSH_PORT: String(pulumi?.sshPort ?? ""),
    BACKEND_PORT: String(config?.ansible?.backend?.port ?? ""),
    PULUMI_PROJECT_NAME: pulumi?.projectName ?? "",
    PULUMI_STACK: stackName,
    PULUMI_SERVERS_JSON: serversJson,
  };

  const args = [PULUMI_RUN, "--command", pulumiCommand, "--skip-bws"];

  if (showLogs) {
    // Run with output streamed to console (tee-like behavior)
    const { stdout, exitCode } = await runCommandWithTee(args, env);

    if (exitCode !== 0) {
      throw new Error(`Pulumi command failed with exit code ${exitCode}`);
    }

    // destroy command has no hosts to parse
    if (pulumiCommand === "destroy") {
      return { hosts: [] };
    }

    return parsePulumiHosts(stdout);
  } else {
    // Run silently, capture output
    const proc = Bun.spawn(args, {
      env: { ...process.env, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new Error(`Pulumi command failed with exit code ${exitCode}`);
    }

    // destroy command has no hosts to parse
    if (pulumiCommand === "destroy") {
      return { hosts: [] };
    }

    return parsePulumiHosts(stdout);
  }
}

export async function runPulumi(
  config: MaestroConfig,
  sshKeyTempFile: string,
): Promise<PulumiHosts> {
  let allHosts: PulumiHosts = { hosts: [] };
  const stackNames = Object.keys(config.pulumi?.stacks ?? {}) as StackName[];

  if (config.pulumi?.enabled) {
    log(`Provisioning ${stackNames.length} stack(s)...`);

    for (const stackName of stackNames) {
      log(`Provisioning stack: ${stackName}`);
      const stack = config.pulumi?.stacks?.[stackName];
      const serversJson = JSON.stringify(stack?.servers ?? []);

      const stackHosts = await capturePulumiHosts(
        stackName,
        config.pulumi?.command!,
        serversJson,
        config,
        sshKeyTempFile,
      );

      allHosts = mergeHosts(allHosts, stackHosts);
    }
  } else if (config.ansible?.enabled) {
    log("Fetching existing Pulumi outputs for Ansible...");

    for (const stackName of stackNames) {
      const stack = config.pulumi?.stacks?.[stackName];
      const serversJson = JSON.stringify(stack?.servers ?? []);

      const stackHosts = await capturePulumiHosts(
        stackName,
        "output",
        serversJson,
        config,
        sshKeyTempFile,
        false, // don't show logs for output-only
      );

      allHosts = mergeHosts(allHosts, stackHosts);
    }
  } else {
    log("Skipping pulumi provisioning");
  }

  return allHosts;
}
