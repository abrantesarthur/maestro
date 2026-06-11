import {
  LocalWorkspace,
  type ConfigMap,
  type OutputMap,
  type Stack,
} from "@pulumi/pulumi/automation";
import { type StackName, type MaestroConfig } from "./config/index.ts";
import { log, requireVar } from "./helpers.ts";
import { requireBwsSecret } from "./secrets.ts";
import {
  resolveStackHosts,
  mergeHosts,
  type PulumiHosts,
} from "./hosts.ts";
import { pulumiProgram, type DatabaseConfig } from "../pulumi/index.ts";

/** Pulumi commands that don't need cloud provider credentials or the SSH key */
export function needsProviderCreds(pulumiCommand: string): boolean {
  return pulumiCommand !== "output";
}

/**
 * Build the stack config map applied before provisioning commands.
 *
 * Every key is namespaced under the project so existing stack config in Pulumi
 * Cloud is reused as-is. Only values the program can't receive in-process live
 * here: config interpolated into resources (sshKeyPath, into local.Command
 * scripts) and BWS-sourced secrets (`postgresUser`/`postgresDb`, included only
 * when the database tier is enabled). The servers/database settings are passed
 * to `pulumiProgram` directly as typed arguments.
 */
export function buildStackConfig(
  env: Record<string, string>,
  sshKeyPath: string,
  databaseEnabled: boolean,
): ConfigMap {
  const projectName = env["PULUMI_PROJECT_NAME"] ?? "";

  const config: ConfigMap = {
    [`${projectName}:domain`]: { value: env["DOMAIN"] ?? "" },
    [`${projectName}:cloudflareAccountId`]: {
      value: env["CLOUDFLARE_ACCOUNT_ID"] ?? "",
    },
    [`${projectName}:sshKeyPath`]: { value: sshKeyPath },
    [`${projectName}:backendPort`]: { value: env["BACKEND_PORT"] ?? "" },
    [`${projectName}:sshPort`]: { value: env["SSH_PORT"] ?? "" },
  };

  if (databaseEnabled) {
    config[`${projectName}:postgresUser`] = {
      value: process.env["POSTGRES_USER"] ?? "",
    };
    config[`${projectName}:postgresDb`] = {
      value: process.env["POSTGRES_DB"] ?? "",
    };
  }

  return config;
}

/**
 * Validate the configuration and secrets required to run Pulumi.
 *
 * @throws Error if any required value is missing
 */
function validatePulumiRequirements(
  pulumiCommand: string,
  env: Record<string, string>,
  databaseEnabled: boolean,
): void {
  log("Ensuring required configuration from environment...");
  requireVar(env["DOMAIN"], "DOMAIN is required (set in maestro.yaml).");
  requireVar(
    env["CLOUDFLARE_ACCOUNT_ID"],
    "CLOUDFLARE_ACCOUNT_ID is required (set in maestro.yaml).",
  );
  requireVar(
    env["PULUMI_PROJECT_NAME"],
    "PULUMI_PROJECT_NAME is required (set in maestro.yaml).",
  );
  requireVar(env["SSH_PORT"], "SSH_PORT is required (set in maestro.yaml).");
  requireVar(
    env["BACKEND_PORT"],
    "BACKEND_PORT is required (set in maestro.yaml).",
  );
  requireVar(
    env["PULUMI_STACK"],
    "PULUMI_STACK is required (derived from maestro.yaml stacks).",
  );

  log("Ensuring required secrets...");
  requireBwsSecret("PULUMI_ACCESS_TOKEN");
  if (needsProviderCreds(pulumiCommand)) {
    requireBwsSecret("CLOUDFLARE_API_TOKEN");
    requireBwsSecret("DIGITALOCEAN_ACCESS_TOKEN");
  }
  requireBwsSecret("VPS_SSH_KEY");

  // When the database tier is enabled AND we're actually provisioning, the
  // POSTGRES_USER/DB pair (Bitwarden values we choose) must be present in
  // process.env so the Pulumi program can create the dedicated app user +
  // database. POSTGRES_HOST/PORT/PASSWORD are DigitalOcean-derived outputs, not
  // required here.
  if (needsProviderCreds(pulumiCommand) && databaseEnabled) {
    requireBwsSecret("POSTGRES_USER");
    requireBwsSecret("POSTGRES_DB");
  }
}

/**
 * Unwrap an Automation API output map into the plain outputs object.
 *
 * SECURITY: the result carries secret values verbatim (e.g. the
 * DigitalOcean-generated POSTGRES_PASSWORD) — it must never be logged. The
 * streamed `pulumi up` console output masks secrets as `[secret]` on its own.
 */
function unwrapOutputs(outputs: OutputMap): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(outputs).map(([key, output]) => [key, output.value]),
  );
}

/** Read stack outputs (silently) and convert them into hosts for Ansible. */
async function readHosts(stack: Stack): Promise<PulumiHosts> {
  return resolveStackHosts(unwrapOutputs(await stack.outputs()));
}

/**
 * Provision (or read outputs for) a single Pulumi stack and return its hosts.
 *
 * The command is derived from config: when Pulumi is enabled we run the
 * configured command (`up`, `destroy`, …) and stream logs; when it's disabled
 * but Ansible still needs host data, we fall back to a silent `output`.
 */
async function runPulumiStack(
  stackName: StackName,
  config: MaestroConfig,
  sshKeyPath: string,
): Promise<PulumiHosts> {
  const { pulumi } = config;
  const pulumiCommand =
    pulumi?.enabled && pulumi.command ? pulumi.command : "output";
  const showLogs = pulumi?.enabled ?? false;
  const serversConfig = pulumi?.stacks?.[stackName]?.servers ?? [];

  // Merge the global database defaults with this stack's sizing/placement
  // override (override wins). The schema's version/size literals coincide with
  // the Pulumi program's enum values by construction (see lib/config/schema.ts).
  const databaseConfig = (
    pulumi?.database
      ? { ...pulumi.database, ...(pulumi.stacks?.[stackName]?.database ?? {}) }
      : { enabled: false }
  ) as DatabaseConfig;

  const env: Record<string, string> = {
    DOMAIN: config.domain,
    CLOUDFLARE_ACCOUNT_ID: pulumi?.cloudflareAccountId ?? "",
    SSH_PORT: String(pulumi?.sshPort ?? ""),
    BACKEND_PORT: String(config?.ansible?.backend?.port ?? ""),
    PULUMI_PROJECT_NAME: pulumi?.projectName ?? "",
    PULUMI_STACK: stackName,
  };

  validatePulumiRequirements(pulumiCommand, env, databaseConfig.enabled);

  const projectName = env["PULUMI_PROJECT_NAME"] ?? "";

  // The Automation API drives the host `pulumi` CLI in-process: the program
  // runs inside this Bun process via a gRPC language host, state lives in
  // Pulumi Cloud (PULUMI_ACCESS_TOKEN is picked up from process.env, where the
  // BWS layer put it, along with the provider credentials).
  log(`Selecting Pulumi stack ${projectName}/${stackName}...`);
  const stack = await LocalWorkspace.createOrSelectStack(
    {
      stackName,
      projectName,
      program: () => pulumiProgram(serversConfig, databaseConfig),
    },
    {
      projectSettings: {
        name: projectName,
        runtime: "nodejs",
        description: "Infrastructure provisioning with Pulumi",
      },
    },
  );

  // Stream live engine output for provisioning commands; the `output` path
  // stays silent. Secrets in the stream are masked by Pulumi as `[secret]`.
  // Colors are forced only when a real terminal is attached (CI gets plain
  // text) — this replaces the old docker-run TTY-detection workaround.
  const onOutput = showLogs
    ? (msg: string) => process.stdout.write(msg)
    : undefined;
  const color = showLogs && process.stdout.isTTY ? "always" : undefined;

  // Provisioning commands get the maestro.yaml-derived config applied first,
  // exactly like the old entrypoint's `pulumi config set` block.
  if (pulumiCommand !== "output") {
    await stack.setAllConfig(
      buildStackConfig(env, sshKeyPath, databaseConfig.enabled),
    );
  }

  switch (pulumiCommand) {
    case "up":
      await stack.up({ onOutput, color });
      return readHosts(stack);
    case "refresh":
      await stack.refresh({ onOutput, color });
      return { hosts: [] };
    case "cancel":
      await stack.cancel();
      return { hosts: [] };
    case "destroy":
      // refresh first so resources deleted out-of-band don't fail the destroy
      await stack.refresh({ onOutput, color });
      await stack.destroy({ onOutput, color });
      return { hosts: [] };
    case "output":
      return readHosts(stack);
    default:
      throw new Error(
        `Unsupported pulumi command: ${pulumiCommand} (expected "up", "refresh", "cancel", "output", or "destroy")`,
      );
  }
}

export async function runPulumi(
  config: MaestroConfig,
  sshKeyTempFile: string,
): Promise<PulumiHosts> {
  const stackNames = Object.keys(config.pulumi?.stacks ?? {}) as StackName[];

  if (!config.pulumi?.enabled && !config.ansible?.enabled) {
    log("Skipping pulumi provisioning");
    return { hosts: [] };
  }

  if (config.pulumi?.enabled) {
    log(`Provisioning ${stackNames.length} stack(s)...`);
  } else {
    log("Fetching existing Pulumi outputs for Ansible...");
  }

  let allHosts: PulumiHosts = { hosts: [] };
  for (const stackName of stackNames) {
    if (config.pulumi?.enabled) {
      log(`Provisioning stack: ${stackName}`);
    }
    const stackHosts = await runPulumiStack(stackName, config, sshKeyTempFile);
    allHosts = mergeHosts(allHosts, stackHosts);
  }

  return allHosts;
}
