// ============================================
// Config Loading
// ============================================
import { dirname, resolve } from "node:path";
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

  // Validate the configuration against the yaml schema; relative paths in the
  // config resolve against the config file's directory, not the cwd.
  const content = await file.text();
  return validateSchema(content, dirname(resolve(configPath)));
}
