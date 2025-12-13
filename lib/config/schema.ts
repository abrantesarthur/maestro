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

// ============================================
// Enum Codecs (Derived from Values)
// ============================================

export const StackNameCodec = t.keyof({
  [StackNameValues.Dev]: null,
  [StackNameValues.Staging]: null,
  [StackNameValues.Prod]: null,
});

export const ServerRoleCodec = t.keyof({
  [ServerRoleValues.Backend]: null,
  [ServerRoleValues.Web]: null,
});

export const PulumiCommandCodec = t.keyof({
  [PulumiCommandValues.Up]: null,
  [PulumiCommandValues.Refresh]: null,
  [PulumiCommandValues.Cancel]: null,
  [PulumiCommandValues.Output]: null,
});

export const StaticSourceCodec = t.keyof({
  [StaticSourceValues.Local]: null,
  [StaticSourceValues.Image]: null,
});

export const SecretsProviderCodec = t.keyof({
  [SecretsProviderValues.Bws]: null,
});

export const WebModeCodec = t.keyof({
  [WebModeValues.Static]: null,
  [WebModeValues.Docker]: null,
});

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
      region: t.string,
    }),
  ]),
);

// ============================================
// Stack Config Codec
// ============================================

export const StackConfigCodec = t.exact(
  t.type({
    servers: t.array(ServerConfigCodec),
  }),
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
      sshPort: t.number,
    }),
    t.partial({
      stacks: PulumiStacksCodec,
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
    }),
    t.partial({
      port: t.number,
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
    }),
    t.partial({
      port: t.number,
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
