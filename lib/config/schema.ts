/**
 * io-ts codec definitions for Maestro config validation
 */
import * as t from "io-ts";

// ============================================
// Enum Values (Single Source of Truth)
// ============================================

export const StackNameValues = {
  Dev: "dev",
  Staging: "staging",
  Prod: "prod",
} as const;

export const ServerRoleValues = {
  Backend: "backend",
  Web: "web",
} as const;

export const PulumiCommandValues = {
  Up: "up",
  Refresh: "refresh",
  Cancel: "cancel",
  Output: "output",
  Destroy: "destroy",
} as const;

export const StaticSourceValues = {
  Local: "local",
  Image: "image",
} as const;

export const SecretsProviderValues = {
  Bws: "bws",
} as const;

export const WebModeValues = {
  Static: "static",
  Docker: "docker",
} as const;

export const PostgresVersionValues = {
  V15: "15",
  V16: "16",
  V17: "17",
} as const;

// Managed-database size slugs. Must stay in sync with `databaseSizeMap` in
// pulumi/image/index.ts, which maps these strings to digitalocean.DatabaseSlug.
export const DatabaseSizeValues = {
  DB_1VCPU_1GB: "db-s-1vcpu-1gb",
  DB_1VCPU_2GB: "db-s-1vcpu-2gb",
  DB_2VCPU_4GB: "db-s-2vcpu-4gb",
  DB_4VCPU_8GB: "db-s-4vcpu-8gb",
  DB_6VCPU_16GB: "db-s-6vcpu-16gb",
  DB_8VCPU_32GB: "db-s-8vcpu-32gb",
  DB_16VCPU_64GB: "db-s-16vcpu-64gb",
} as const;

// DigitalOcean region slugs. Must stay in sync with `regionMap` in
// pulumi/image/index.ts, which maps these strings to digitalocean.Region.
export const RegionValues = {
  NYC1: "nyc1",
  NYC2: "nyc2",
  NYC3: "nyc3",
  SFO1: "sfo1",
  SFO2: "sfo2",
  SFO3: "sfo3",
  AMS2: "ams2",
  AMS3: "ams3",
  LON1: "lon1",
  FRA1: "fra1",
  TOR1: "tor1",
  BLR1: "blr1",
  SGP1: "sgp1",
} as const;

// ============================================
// Enum Codecs (Derived from Values)
// ============================================

// Build a `t.keyof` (membership) codec from the values of a `…Values` const.
// Generic over T so `t.TypeOf` stays the precise literal union (T[keyof T])
// rather than widening to `string`.
const keyofValues = <T extends Record<string, string>>(values: T) =>
  t.keyof(
    Object.fromEntries(Object.values(values).map((v) => [v, null])) as Record<
      T[keyof T],
      null
    >,
  );

export const StackNameCodec = keyofValues(StackNameValues);
export const ServerRoleCodec = keyofValues(ServerRoleValues);
export const PulumiCommandCodec = keyofValues(PulumiCommandValues);
export const StaticSourceCodec = keyofValues(StaticSourceValues);
export const SecretsProviderCodec = keyofValues(SecretsProviderValues);
export const WebModeCodec = keyofValues(WebModeValues);
export const PostgresVersionCodec = keyofValues(PostgresVersionValues);
export const DatabaseSizeCodec = keyofValues(DatabaseSizeValues);
export const RegionCodec = keyofValues(RegionValues);

// Positive integer (> 0). Rejects negatives, zero, and non-integers.
const PositiveIntCodec = t.refinement(
  t.number,
  (n) => Number.isInteger(n) && n > 0,
  "PositiveInt",
);

// ============================================
// Enum Types (Derived from Codecs)
// ============================================

export type StackName = t.TypeOf<typeof StackNameCodec>;
export const StackName = StackNameValues;

export type ServerRole = t.TypeOf<typeof ServerRoleCodec>;
export const ServerRole = ServerRoleValues;

export type PulumiCommand = t.TypeOf<typeof PulumiCommandCodec>;
export const PulumiCommand = PulumiCommandValues;

export type WebMode = t.TypeOf<typeof WebModeCodec>;
export const WebMode = WebModeValues;

export type StaticSource = t.TypeOf<typeof StaticSourceCodec>;
export const StaticSource = StaticSourceValues;

export type PostgresVersion = t.TypeOf<typeof PostgresVersionCodec>;
export const PostgresVersion = PostgresVersionValues;

export type DatabaseSize = t.TypeOf<typeof DatabaseSizeCodec>;
export const DatabaseSize = DatabaseSizeValues;

export type Region = t.TypeOf<typeof RegionCodec>;
export const Region = RegionValues;

// ============================================
// Server Config Codec
// ============================================

const ServerConfigCodec = t.exact(
  t.intersection([
    t.type({
      roles: t.array(ServerRoleCodec),
    }),
    t.partial({
      groups: t.array(t.string),
      tags: t.array(t.string),
      image: t.string,
      size: t.string,
      region: RegionCodec,
    }),
  ]),
);

// ============================================
// Database Config Codec
// ============================================

// Global database defaults (under pulumi.database). `enabled` is the single
// switch; the remaining fields are optional sizing overrides with documented
// defaults applied by the Pulumi program (version "16", nodeCount 1, size
// "db-s-1vcpu-1gb"). Region is intentionally NOT configurable: a DigitalOcean
// VPC is region-scoped and the private endpoint only resolves inside it, so the
// database always co-locates with the stack's droplets' region.
const DatabaseConfigCodec = t.exact(
  t.intersection([
    t.type({
      enabled: t.boolean,
    }),
    t.partial({
      version: PostgresVersionCodec,
      size: DatabaseSizeCodec,
      nodeCount: PositiveIntCodec,
    }),
  ]),
);

// Per-stack database sizing override (under pulumi.stacks.*.database). It may
// only override sizing (size / nodeCount); `enabled` and `version` are decided
// globally, and region is never configurable (the database co-locates with the
// stack's droplets — see DatabaseConfigCodec).
const StackDatabaseConfigCodec = t.exact(
  t.partial({
    size: DatabaseSizeCodec,
    nodeCount: PositiveIntCodec,
  }),
);

// ============================================
// Stack Config Codec
// ============================================

export const StackConfigCodec = t.exact(
  t.intersection([
    t.type({
      servers: t.array(ServerConfigCodec),
    }),
    t.partial({
      database: StackDatabaseConfigCodec,
    }),
  ]),
);

// ============================================
// Pulumi Config Codec
// ============================================

const PulumiStacksCodec = t.refinement(
  t.partial({
    dev: StackConfigCodec,
    staging: StackConfigCodec,
    prod: StackConfigCodec,
  }),
  (stacks) => Object.keys(stacks).every((k) => StackNameCodec.is(k)),
  "PulumiStacks",
);

const PulumiConfigCodec = t.exact(
  t.intersection([
    t.type({
      enabled: t.boolean,
      command: PulumiCommandCodec,
      cloudflareAccountId: t.string,
      projectName: t.string,
      sshPort: t.number,
    }),
    t.partial({
      stacks: PulumiStacksCodec,
      database: DatabaseConfigCodec,
    }),
  ]),
);

// ============================================
// Web Static Config Codec
// ============================================

const WebStaticConfigCodec = t.exact(
  t.intersection([
    t.type({
      source: StaticSourceCodec,
    }),
    t.partial({
      dir: t.string,
      build: t.string,
      dist: t.string,
      image: t.string,
      tag: t.string,
      path: t.string,
    }),
  ]),
);

// ============================================
// Web Docker Config Codec
// ============================================

const WebDockerConfigCodec = t.exact(
  t.intersection([
    t.type({
      image: t.string,
      tag: t.string,
      port: t.number,
    }),
    t.partial({
      env: t.record(t.string, t.string),
    }),
  ]),
);

// ============================================
// Web Config Codec
// ============================================

const WebConfigCodec = t.exact(
  t.partial({
    static: WebStaticConfigCodec,
    docker: WebDockerConfigCodec,
  }),
);

// ============================================
// Backend Config Codec
// ============================================

// FIXME: do we prefix backend env vars with BACKEND_ENV_ ?
const BackendConfigCodec = t.exact(
  t.intersection([
    t.type({
      image: t.string,
      tag: t.string,
      port: t.number,
    }),
    t.partial({
      env: t.record(t.string, t.string),
    }),
  ]),
);

// ============================================
// Ansible Config Codec
// ============================================
const AnsibleConfigCodec = t.exact(
  t.intersection([
    t.type({
      enabled: t.boolean,
    }),
    t.partial({
      groups: t.array(t.string),
      web: WebConfigCodec,
      backend: BackendConfigCodec,
    }),
  ]),
);

// ============================================
// Secrets Config Codec
// ============================================

const SecretsConfigCodec = t.exact(
  t.intersection([
    t.type({
      provider: SecretsProviderCodec,
    }),
    t.partial({
      projectId: t.string,
      requiredVars: t.array(t.string),
    }),
  ]),
);

// ============================================
// Main Maestro Config Codec
// ============================================

export const MaestroConfigCodec = t.exact(
  t.intersection([
    t.type({
      domain: t.string,
    }),
    t.partial({
      pulumi: PulumiConfigCodec,
      ansible: AnsibleConfigCodec,
      secrets: SecretsConfigCodec,
    }),
  ]),
);

// ============================================
// Config Types (Derived from Codecs)
// ============================================

export type StackConfig = t.TypeOf<typeof StackConfigCodec>;
export type MaestroConfig = t.TypeOf<typeof MaestroConfigCodec>;
