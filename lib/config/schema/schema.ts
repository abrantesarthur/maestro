/**
 * JSON Schema definitions and AJV validation for Maestro config
 */
import { ServerRole, StackName, StaticSource } from "../types";

// ============================================
// JSON Schema Definitions
// ============================================

// FIXME: think these thoroughly through
const serverConfigSchema = {
  type: "object",
  properties: {
    roles: {
      type: "array",
      items: { type: "string", enum: Object.values(ServerRole) },
      minItems: 1,
    },
    groups: { type: "array", items: { type: "string" } },
    tags: { type: "array", items: { type: "string" } },
    image: { type: "string" },
    size: { type: "string" },
    region: { type: "string" },
  },
  required: ["roles"],
  additionalProperties: false,
} as const;

const stackConfigSchema = {
  type: "object",
  properties: {
    servers: {
      type: "array",
      items: serverConfigSchema,
      minItems: 1,
    },
  },
  required: ["servers"],
  additionalProperties: false,
} as const;

const pulumiConfigSchema = {
  type: "object",
  properties: {
    enabled: { type: "boolean" },
    command: { type: "string", enum: ["up", "refresh", "cancel", "output"] },
    cloudflareAccountId: { type: "string" },
    sshPort: { type: "integer" },
    stacks: {
      type: "object",
      propertyNames: { enum: Object.values(StackName) },
      additionalProperties: stackConfigSchema,
    },
  },
  additionalProperties: false,
  if: { properties: { enabled: { const: true } } },
  then: { required: ["cloudflareAccountId", "stacks"] },
} as const;

const webStaticConfigSchema = {
  type: "object",
  properties: {
    source: { type: "string", enum: Object.values(StaticSource) },
    dir: { type: "string" },
    build: { type: "string" },
    dist: { type: "string" },
    image: { type: "string" },
    tag: { type: "string" },
    path: { type: "string" },
  },
  additionalProperties: false,
  allOf: [
    {
      if: { properties: { source: { const: "local" } }, required: ["source"] },
      then: { required: ["dir"] },
    },
    {
      if: { properties: { source: { const: "image" } }, required: ["source"] },
      then: { required: ["image", "tag"] },
    },
  ],
} as const;

const webDockerConfigSchema = {
  type: "object",
  properties: {
    image: { type: "string" },
    tag: { type: "string" },
    port: { type: "integer" },
    env: { type: "object", additionalProperties: { type: "string" } },
  },
  required: ["image", "tag"],
  additionalProperties: false,
} as const;

const webConfigSchema = {
  type: "object",
  properties: {
    static: webStaticConfigSchema,
    docker: webDockerConfigSchema,
  },
  additionalProperties: false,
} as const;

const backendConfigSchema = {
  type: "object",
  properties: {
    image: { type: "string" },
    tag: { type: "string" },
    port: { type: "integer" },
    env: { type: "object", additionalProperties: { type: "string" } },
  },
  required: ["image", "tag"],
  additionalProperties: false,
} as const;

const ansibleConfigSchema = {
  type: "object",
  properties: {
    enabled: { type: "boolean" },
    groups: { type: "array", items: { type: "string" } },
    web: webConfigSchema,
    backend: backendConfigSchema,
  },
  additionalProperties: false,
} as const;

const secretsConfigSchema = {
  type: "object",
  properties: {
    provider: { type: "string", enum: ["bws"] },
    projectId: { type: "string" },
    requiredVars: { type: "array", items: { type: "string" } },
  },
  additionalProperties: false,
} as const;

export const maestroConfigSchema = {
  type: "object",
  properties: {
    domain: { type: "string" },
    pulumi: pulumiConfigSchema,
    ansible: ansibleConfigSchema,
    secrets: secretsConfigSchema,
  },
  required: ["domain"],
  additionalProperties: false,
} as const;
