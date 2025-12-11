import { isRight } from "fp-ts/Either";
import type { MaestroConfig } from "../types";
import { MaestroConfigCodec } from "./schema";
import { formatErrors } from "./formatErrors";

export const validateSchema = (content: string): MaestroConfig => {
  const parsed = Bun.YAML.parse(content);
  const result = MaestroConfigCodec.decode(parsed);

  if (!isRight(result)) {
    throw new Error(`Invalid configuration:\n${formatErrors(result.left)}`);
  }

  return result.right;
};
