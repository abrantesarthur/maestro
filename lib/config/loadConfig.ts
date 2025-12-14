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

  return raw;
}
