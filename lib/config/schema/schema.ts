/**
 * io-ts codec definitions for Maestro config validation
 */
import * as t from "io-ts";

// ============================================
// Enum Codecs
// ============================================

export const StackNameCodec = t.keyof({
  dev: null,
  staging: null,
  prod: null,
});

export const ServerRoleCodec = t.keyof({
  backend: null,
  web: null,
});

export const PulumiCommandCodec = t.keyof({
  up: null,
  refresh: null,
  cancel: null,
  output: null,
});

export const StaticSourceCodec = t.keyof({
  local: null,
  image: null,
});

export const SecretsProviderCodec = t.keyof({
  bws: null,
});

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

const PulumiConfigCodec = t.exact(
  t.partial({
    enabled: t.boolean,
    command: PulumiCommandCodec,
    cloudflareAccountId: t.string,
    sshPort: t.number,
    stacks: t.record(StackNameCodec, StackConfigCodec),
  }),
);

// ============================================
// Web Static Config Codec
// ============================================

const WebStaticConfigCodec = t.exact(
  t.partial({
    source: StaticSourceCodec,
    dir: t.string,
    build: t.string,
    dist: t.string,
    image: t.string,
    tag: t.string,
    path: t.string,
  }),
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
  t.partial({
    enabled: t.boolean,
    groups: t.array(t.string),
    web: WebConfigCodec,
    backend: BackendConfigCodec,
  }),
);

// ============================================
// Secrets Config Codec
// ============================================

const SecretsConfigCodec = t.exact(
  t.partial({
    provider: SecretsProviderCodec,
    projectId: t.string,
    requiredVars: t.array(t.string),
  }),
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
