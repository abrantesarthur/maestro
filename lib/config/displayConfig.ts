import type { LoadedConfig } from "./types";

export function displayConfig(config: LoadedConfig): void {
  console.log("  domain:", config.domain);
  console.log("  pulumi.enabled:", config.pulumi.enabled);
  console.log("  pulumi.command:", config.pulumi.command);
  console.log(
    "  pulumi.cloudflare_account_id:",
    config.pulumi.cloudflareAccountId,
  );
  console.log("  pulumi.ssh_port:", config.pulumi.sshPort);
  console.log("  pulumi.stacks:", JSON.stringify(config.pulumi.stacks));
  console.log("  detected roles:", JSON.stringify(config.roles));
  console.log("  ansible.enabled:", config.ansible.enabled);
  console.log(`  ansible.web:`);
  console.log("    mode:", config.ansible.web.static ? "static" : "docker");

  if (config.ansible.web.static) {
    console.log("    static.source:", config.ansible.web.static.source);
    if (config.ansible.web.static.source === "local") {
      console.log("    static.dir:", config.ansible.web.static.dir);
      console.log(
        "    static.build:",
        config.ansible.web.static.build || "<none>",
      );
      console.log("    static.dist:", config.ansible.web.static.dist);
    } else {
      console.log("    static.image:", config.ansible.web.static.image);
      console.log("    static.tag:", config.ansible.web.static.tag);
      console.log("    static.path:", config.ansible.web.static.path);
    }
  } else if (config.ansible.web.docker) {
    console.log("    docker.image:", config.ansible.web.docker.image);
    console.log("    docker.tag:", config.ansible.web.docker.tag);
    console.log("    docker.port:", config.ansible.web.docker.port);
  }

  console.log(`  ansible.backend:`);
  console.log("    image:", config.ansible.backend.image);
  console.log("    tag:", config.ansible.backend.tag);
  console.log("    port:", config.ansible.backend.port);
  console.log("  ansible.groups:", JSON.stringify(config.ansible.groups));
  console.log("  secrets.provider:", config.secrets.provider);
  console.log("  secrets.project_id:", config.secrets.projectId || "<not set>");
  console.log(
    "  secrets.required_vars:",
    JSON.stringify(config.secrets.requiredVars),
  );

  // Show backend environment variables
  console.log("  Backend environment variables:");
  const backendEnvKeys = Object.keys(config.ansible.backend.env);
  if (backendEnvKeys.length > 0) {
    for (const key of backendEnvKeys) {
      console.log(`    ${key}=${config.ansible.backend.env[key]}`);
    }
  } else {
    console.log("    (none)");
  }

  // Show web docker environment variables if docker mode
  if (config.ansible.web.docker) {
    console.log("  Web docker environment variables:");
    const webDockerEnvKeys = Object.keys(config.ansible.web.docker.env);
    if (webDockerEnvKeys.length > 0) {
      for (const key of webDockerEnvKeys) {
        console.log(`    ${key}=${config.ansible.web.docker.env[key]}`);
      }
    } else {
      console.log("    (none)");
    }
  }
}
