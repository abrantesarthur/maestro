/**
 * Configuration type definitions for Maestro
 */

import * as t from "io-ts";
import { MaestroConfigCodec, StackConfigCodec } from "./schema";

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

// ============================================
// Types derived from io-ts codecs
// ============================================

export type StackConfig = t.TypeOf<typeof StackConfigCodec>;
export type MaestroConfig = t.TypeOf<typeof MaestroConfigCodec>;
