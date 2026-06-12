import { resolveSecretEnv, type MaestroConfig } from "./schema";

export function displayConfig(config: MaestroConfig): void {
  console.log("  domain:", config.domain);
  console.log("  pulumi.enabled:", config?.pulumi?.enabled);
  console.log("  pulumi.command:", config?.pulumi?.command);
  console.log(
    "  pulumi.cloudflare_account_id:",
    config?.pulumi?.cloudflareAccountId,
  );
  console.log("  pulumi.ssh_port:", config?.pulumi?.sshPort);
  console.log("  pulumi.stacks:", JSON.stringify(config?.pulumi?.stacks));

  // Database tier (Pulumi-provisioned DigitalOcean Managed Postgres)
  const database = config?.pulumi?.database;
  console.log("  pulumi.database.enabled:", database?.enabled ?? false);
  if (database?.enabled) {
    console.log("    version:", database.version ?? "16 (default)");
    console.log("    size:", database.size ?? "db-s-1vcpu-1gb (default)");
    console.log("    nodeCount:", database.nodeCount ?? "1 (default)");
    console.log("    region:", "co-locates with the stack's droplets");

    // Per-stack database overrides (sizing/placement only)
    for (const [stackName, stack] of Object.entries(
      config?.pulumi?.stacks ?? {},
    )) {
      if (stack?.database) {
        console.log(
          `    stacks.${stackName}.database:`,
          JSON.stringify(stack.database),
        );
      }
    }

    // Connection details: USER/DB come from Bitwarden; HOST/PORT/PASSWORD are
    // derived from DigitalOcean and surfaced as Pulumi stack outputs.
    console.log(
      "    BWS-required:",
      JSON.stringify(["POSTGRES_USER", "POSTGRES_DB"]),
    );
    console.log(
      "    Pulumi-output:",
      JSON.stringify(["POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_PASSWORD"]),
    );
  }

  console.log("  ansible.enabled:", config?.ansible?.enabled);
  console.log(`  ansible.web:`);
  console.log("    mode:", config?.ansible?.web?.static ? "static" : "docker");

  if (config?.ansible?.web?.static) {
    console.log("    static.source:", config.ansible.web.static.source);
    if (config.ansible.web.static.source === "local") {
      console.log("    static.dir:", config.ansible.web.static.dir);
      console.log(
        "    static.build:",
        config?.ansible?.web?.static?.build || "<none>",
      );
      console.log("    static.dist:", config.ansible.web.static.dist);
    } else {
      console.log("    static.image:", config.ansible.web.static.image);
      console.log("    static.tag:", config.ansible.web.static.tag);
      console.log("    static.path:", config.ansible.web.static.path);
    }
  } else if (config?.ansible?.web?.docker) {
    console.log("    docker.image:", config?.ansible?.web?.docker?.image);
    console.log("    docker.tag:", config?.ansible?.web?.docker?.tag);
    console.log("    docker.port:", config?.ansible?.web?.docker?.port);
  }

  console.log(`  ansible.backend:`);
  console.log("    image:", config?.ansible?.backend?.image);
  console.log("    tag:", config?.ansible?.backend?.tag);
  console.log("    port:", config?.ansible?.backend?.port);
  console.log(
    "  ansible.groups:",
    JSON.stringify(config?.ansible?.groups ?? []),
  );
  console.log("  secrets.provider:", config?.secrets?.provider);
  console.log(
    "  secrets.project_id:",
    config?.secrets?.projectId || "<not set>",
  );
  console.log(
    "  secrets.required_vars:",
    JSON.stringify(config?.secrets?.requiredVars),
  );

  // Show backend environment variables
  console.log("  Backend environment variables:");
  const backendEnvKeys = Object.keys(config?.ansible?.backend?.env ?? {});
  if (backendEnvKeys.length > 0) {
    for (const key of backendEnvKeys) {
      console.log(`    ${key}=${config?.ansible?.backend?.env?.[key]}`);
    }
  } else {
    console.log("    (none)");
  }

  // Backend secret env vars: names only — values live in Bitwarden
  console.log("  Backend secret environment variables (values from Bitwarden):");
  const secretEnvPairs = resolveSecretEnv(config?.ansible?.backend?.secretEnv);
  if (secretEnvPairs.length > 0) {
    for (const { container, source } of secretEnvPairs) {
      console.log(`    ${container}=<from Bitwarden secret ${source}>`);
    }
  } else {
    console.log("    (none)");
  }

  // Show web docker environment variables if docker mode
  if (config?.ansible?.web?.docker) {
    console.log("  Web docker environment variables:");
    const webDockerEnvKeys = Object.keys(
      config?.ansible?.web?.docker?.env ?? {},
    );
    if (webDockerEnvKeys.length > 0) {
      for (const key of webDockerEnvKeys) {
        console.log(`    ${key}=${config?.ansible?.web?.docker?.env?.[key]}`);
      }
    } else {
      console.log("    (none)");
    }
  }
}
