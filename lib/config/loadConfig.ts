// ============================================
// Config Loading
// ============================================
import { type MaestroConfig } from "./schema";
import { validateSchema } from "./validateSchema";

export async function loadConfig(configPath: string): Promise<MaestroConfig> {
  const file = Bun.file(configPath);

  if (!(await file.exists())) {
    throw new Error(
      `Config file not found at ${configPath}\n` +
        `Create a maestro.yaml file. See example.maestro.yaml for a template.`,
    );
  }

  // validate the Maestro configuration according to the yaml schema
  const content = await file.text();
  const raw = await validateSchema(content);

  // Build the loaded config with defaults
  return {
    domain: raw.domain,
    pulumi: raw.pulumi,
    ...(raw.ansible
      ? {
          ansible: {
            enabled: raw.ansible.enabled,
            groups: raw.ansible.groups ?? [],
            web: {
              ...(raw.ansible.web?.static
                ? {
                    static: {
                      source: raw.ansible.web.static.source,
                      dir: raw.ansible.web.static.dir ?? "",
                      build: raw.ansible.web.static.build ?? "",
                      dist: raw.ansible.web.static.dist ?? "dist",
                      image: raw.ansible.web.static.image ?? "",
                      tag: raw.ansible.web.static.tag ?? "latest",
                      path: raw.ansible.web.static.path ?? "/app/dist",
                    },
                  }
                : {}),
              ...(raw.ansible.web?.docker
                ? {
                    docker: {
                      image: raw.ansible.web.docker.image,
                      tag: raw.ansible.web.docker.tag ?? "latest",
                      port: raw.ansible.web.docker.port ?? 4000,
                      env: raw.ansible.web.docker.env ?? {},
                    },
                  }
                : {}),
            },
            ...(raw.ansible.backend
              ? {
                  backend: {
                    image: raw.ansible.backend.image,
                    tag: raw.ansible.backend.tag,
                    port: raw.ansible.backend.port ?? 3000,
                    env: raw.ansible.backend.env,
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(raw.secrets
      ? {
          secrets: {
            provider: raw.secrets?.provider,
            projectId: raw.secrets?.projectId ?? "",
            requiredVars: raw.secrets?.requiredVars ?? [],
          },
        }
      : {}),
  };
}
