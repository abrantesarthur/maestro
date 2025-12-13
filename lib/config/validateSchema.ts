import { isRight } from "fp-ts/Either";
import {
  MaestroConfigCodec,
  type MaestroConfig,
  type ServerRole,
} from "./schema";
import { formatErrors } from "./formatErrors";
import { validateSemanticConfig } from "./validateSchemaConfig";

export const validateSchema = async (
  content: string,
): Promise<MaestroConfig> => {
  const parsed = Bun.YAML.parse(content);
  const result = MaestroConfigCodec.decode(parsed);

  if (!isRight(result)) {
    throw new Error(`Invalid configuration:\n${formatErrors(result.left)}`);
  }

  const raw = result.right;

  // Collect all unique roles from all stacks
  const roles = Object.values(raw.pulumi?.stacks ?? {})
    .flatMap((s) => s.servers.flatMap((srv) => srv.roles))
    .reduce((prev, curr) => prev.add(curr), new Set<ServerRole>());

  // Semantic validations
  await validateSemanticConfig({ raw, roles });

  return raw;
};
