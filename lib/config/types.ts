/**
 * Configuration type definitions for Maestro
 */

import type { FromSchema } from "json-schema-to-ts";
import type { maestroConfigSchema } from "./schema";

// ============================================
// Enums
// ============================================

export enum StackName {
  Dev = "dev",
  Staging = "staging",
  Prod = "prod",
}

export enum ServerRole {
  Backend = "backend",
  Web = "web",
}

export enum PulumiCommand {
  Up = "up",
  Refresh = "refresh",
  Cancel = "cancel",
  Output = "output",
}

export enum WebMode {
  Static = "static",
  Docker = "docker",
}

export enum StaticSource {
  Local = "local",
  Image = "image",
}
export type MaestroConfig = FromSchema<typeof maestroConfigSchema>;
