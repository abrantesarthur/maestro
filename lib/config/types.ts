/**
 * Configuration type definitions for Maestro
 */

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
// Raw Config Interfaces (from YAML)
// ============================================

export interface ServerConfig {
  roles: ServerRole[];
  groups?: string[];
  tags?: string[];
  image?: string;
  size?: string;
  region?: string;
}

export interface StackConfig {
  servers: ServerConfig[];
}

export interface PulumiConfig {
  enabled?: boolean;
  command?: PulumiCommand;
  cloudflareAccountId: string;
  sshPort?: number;
  stacks: Partial<Record<StackName, StackConfig>>;
}

export interface WebStaticConfig {
  source: StaticSource;
  dir?: string;
  build?: string;
  dist?: string;
  image?: string;
  tag?: string;
  path?: string;
}

export interface WebDockerConfig {
  image: string;
  tag?: string;
  port?: number;
  env?: Record<string, string>;
}

export interface WebConfig {
  static?: WebStaticConfig;
  docker?: WebDockerConfig;
}

export interface BackendConfig {
  image: string;
  tag: string;
  port?: number;
  env?: Record<string, string>;
}

export interface AnsibleConfig {
  enabled?: boolean;
  groups?: string[];
  web?: WebConfig;
  backend?: BackendConfig;
}

export interface SecretsConfig {
  provider?: "bws";
  projectId?: string;
  requiredVars?: string[];
}

export interface MaestroConfig {
  domain: string;
  pulumi?: PulumiConfig;
  ansible?: AnsibleConfig;
  secrets?: SecretsConfig;
}

// ============================================
// Loaded Configuration (with defaults applied)
// ============================================

export interface LoadedConfig {
  domain: string;
  pulumi: {
    enabled: boolean;
    command: PulumiCommand;
    cloudflareAccountId: string;
    sshPort: number;
    stacks: Record<StackName, StackConfig>;
  };
  ansible: {
    enabled: boolean;
    groups: string[];
    web: {
      static: {
        source?: StaticSource;
        dir: string;
        build: string;
        dist: string;
        image: string;
        tag: string;
        path: string;
      };
      docker: {
        image: string;
        tag: string;
        port: number;
        env: Record<string, string>;
      };
    };
    backend: {
      image: string;
      tag: string;
      port: number;
      env: Record<string, string>;
    };
  };
  secrets: {
    provider: "bws";
    projectId: string;
    requiredVars: string[];
  };
  roles: ServerRole[];
}
