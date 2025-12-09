import Ajv from "ajv";
import type { MaestroConfig } from "../types";
import { maestroConfigSchema } from "./schema";
import { formatErrors } from "./formatErrors";

export const validateSchema = (content: string): MaestroConfig => {
  const validator = new Ajv({ allErrors: true, verbose: true }).compile(
    maestroConfigSchema,
  );
  const parsed = Bun.YAML.parse(content);

  if (!validator(parsed)) {
    throw new Error(
      `Invalid configuration:\n${formatErrors(validator.errors)}`,
    );
  }

  return parsed as MaestroConfig;
};
