import { isRight } from "fp-ts/Either";
import {
  MaestroConfigCodec,
  type MaestroConfig,
  type ServerRole,
} from "./schema";
import { formatErrors } from "./formatErrors";
import { validateSemanticConfig } from "./validateSchemaConfig";
import { resolveConfigPaths } from "./resolveConfigPaths";

export const validateSchema = async (
  content: string,
  /**
   * Directory the config file lives in. When given, relative paths in the
   * config are resolved against it before semantic validation (which checks
   * paths exist on disk). When omitted, relative paths stay relative to cwd.
   */
  configDir?: string,
): Promise<MaestroConfig> => {
  const parsed = Bun.YAML.parse(content);
  const result = MaestroConfigCodec.decode(parsed);

  if (!isRight(result)) {
    throw new Error(`Invalid configuration:\n${formatErrors(result.left)}`);
  }

  const raw = configDir
    ? resolveConfigPaths(result.right, configDir)
    : result.right;

  // Collect all unique roles from all stacks
  const roles = Object.values(raw.pulumi?.stacks ?? {})
    .flatMap((s) => s.servers.flatMap((srv) => srv.roles))
    .reduce((prev, curr) => prev.add(curr), new Set<ServerRole>());

  // Semantic validations
  await validateSemanticConfig({ raw, roles });

  return raw;
};
