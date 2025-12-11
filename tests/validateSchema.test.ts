import { describe, expect, test } from "bun:test";
import { validateSchema } from "../lib/config/validateSchema";

describe("validateSchema", () => {
  // ============================================
  // Valid Configurations
  // ============================================

  describe("valid configurations", () => {
    test("accepts minimal config with only domain", () => {
      const yaml = `domain: example.com`;
      expect(validateSchema(yaml)).toEqual({ domain: "example.com" });
    });

    test("accepts config with pulumi section", () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: true
  command: up
  sshPort: 22
`;
      const result = validateSchema(yaml);
      expect(result.domain).toBe("example.com");
      expect(result.pulumi?.enabled).toBe(true);
      expect(result.pulumi?.command).toBe("up");
      expect(result.pulumi?.sshPort).toBe(22);
    });

    test("accepts config with pulumi stacks", () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: true
  stacks:
    dev:
      servers:
        - roles:
            - backend
          size: small
          region: us-east
    staging:
      servers: []
    prod:
      servers:
        - roles:
            - backend
            - web
          groups:
            - production
          tags:
            - critical
`;
      const result = validateSchema(yaml);
      expect(result.pulumi?.stacks?.dev?.servers).toHaveLength(1);
      expect(result.pulumi?.stacks?.dev?.servers[0].roles).toContain("backend");
      expect(result.pulumi?.stacks?.prod?.servers[0].roles).toContain("web");
    });

    test("accepts config with ansible section", () => {
      const yaml = `
domain: example.com
ansible:
  enabled: true
  groups:
    - webservers
  web:
    static:
      source: local
      dir: ./web
      build: npm run build
      dist: ./dist
    docker:
      image: nginx
      tag: latest
      port: 80
  backend:
    image: myapp
    tag: v1.0.0
    port: 8080
    env:
      NODE_ENV: production
`;
      const result = validateSchema(yaml);
      expect(result.ansible?.enabled).toBe(true);
      expect(result.ansible?.web?.static?.source).toBe("local");
      expect(result.ansible?.web?.docker?.image).toBe("nginx");
      expect(result.ansible?.backend?.image).toBe("myapp");
    });

    test("accepts config with secrets section", () => {
      const yaml = `
domain: example.com
secrets:
  provider: bws
  projectId: my-project
  requiredVars:
    - API_KEY
    - DB_PASSWORD
`;
      const result = validateSchema(yaml);
      expect(result.secrets?.provider).toBe("bws");
      expect(result.secrets?.projectId).toBe("my-project");
      expect(result.secrets?.requiredVars).toContain("API_KEY");
    });

    test("accepts full config with all sections", () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: true
  command: up
  cloudflareAccountId: abc123
  sshPort: 2222
  stacks:
    dev:
      servers: []
    staging:
      servers:
        - roles:
            - backend
    prod:
      servers: []
ansible:
  enabled: true
  backend:
    image: myapp
    tag: latest
secrets:
  provider: bws
`;
      const result = validateSchema(yaml);
      expect(result.domain).toBe("example.com");
      expect(result.pulumi?.enabled).toBe(true);
      expect(result.ansible?.enabled).toBe(true);
      expect(result.secrets?.provider).toBe("bws");
    });

    test("accepts all valid pulumi commands", () => {
      const commands = ["up", "refresh", "cancel", "output"];
      for (const command of commands) {
        const yaml = `
domain: example.com
pulumi:
  enabled: true
  command: ${command}
`;
        const result = validateSchema(yaml);
        expect(result.pulumi?.command).toBe(command);
      }
    });

    test("accepts all valid stack names", () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: true
  stacks:
    dev:
      servers: []
    staging:
      servers: []
    prod:
      servers: []
`;
      const result = validateSchema(yaml);
      expect(result.pulumi?.stacks?.dev).toBeDefined();
      expect(result.pulumi?.stacks?.staging).toBeDefined();
      expect(result.pulumi?.stacks?.prod).toBeDefined();
    });

    test("accepts all valid server roles", () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: true
  stacks:
    dev:
      servers:
        - roles:
            - backend
            - web
    staging:
      servers: []
    prod:
      servers: []
`;
      const result = validateSchema(yaml);
      expect(result.pulumi?.stacks?.dev?.servers[0].roles).toContain("backend");
      expect(result.pulumi?.stacks?.dev?.servers[0].roles).toContain("web");
    });

    test("accepts web static with image source", () => {
      const yaml = `
domain: example.com
ansible:
  enabled: true
  web:
    static:
      source: image
      image: my-static-image
      tag: v1
      path: /app/dist
`;
      const result = validateSchema(yaml);
      expect(result.ansible?.web?.static?.source).toBe("image");
      expect(result.ansible?.web?.static?.image).toBe("my-static-image");
    });
  });

  // ============================================
  // Invalid Configurations - Missing Required Fields
  // ============================================

  describe("missing required fields", () => {
    test("rejects empty config", () => {
      const yaml = ``;
      expect(() => validateSchema(yaml)).toThrow("Invalid configuration");
    });

    test("rejects config without domain", () => {
      const yaml = `
pulumi:
  enabled: true
`;
      expect(() => validateSchema(yaml)).toThrow("Invalid configuration");
    });

    test("rejects pulumi without enabled field", () => {
      const yaml = `
domain: example.com
pulumi:
  command: up
`;
      expect(() => validateSchema(yaml)).toThrow("Invalid configuration");
    });

    test("rejects ansible without enabled field", () => {
      const yaml = `
domain: example.com
ansible:
  groups:
    - webservers
`;
      expect(() => validateSchema(yaml)).toThrow("Invalid configuration");
    });

    test("rejects secrets without provider field", () => {
      const yaml = `
domain: example.com
secrets:
  projectId: my-project
`;
      expect(() => validateSchema(yaml)).toThrow("Invalid configuration");
    });

    test("rejects backend without image field", () => {
      const yaml = `
domain: example.com
ansible:
  enabled: true
  backend:
    tag: latest
`;
      expect(() => validateSchema(yaml)).toThrow("Invalid configuration");
    });

    test("rejects backend without tag field", () => {
      const yaml = `
domain: example.com
ansible:
  enabled: true
  backend:
    image: myapp
`;
      expect(() => validateSchema(yaml)).toThrow("Invalid configuration");
    });

    test("rejects web docker without image field", () => {
      const yaml = `
domain: example.com
ansible:
  enabled: true
  web:
    docker:
      tag: latest
`;
      expect(() => validateSchema(yaml)).toThrow("Invalid configuration");
    });

    test("rejects web static without source field", () => {
      const yaml = `
domain: example.com
ansible:
  enabled: true
  web:
    static:
      dir: ./web
`;
      expect(() => validateSchema(yaml)).toThrow("Invalid configuration");
    });

    test("rejects server without roles field", () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: true
  stacks:
    dev:
      servers:
        - size: small
`;
      expect(() => validateSchema(yaml)).toThrow("Invalid configuration");
    });

    test("rejects stack without servers field", () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: true
  stacks:
    dev: {}
`;
      expect(() => validateSchema(yaml)).toThrow("Invalid configuration");
    });
  });

  // ============================================
  // Invalid Configurations - Wrong Types
  // ============================================

  describe("wrong types", () => {
    test("rejects domain as number", () => {
      const yaml = `domain: 12345`;
      expect(() => validateSchema(yaml)).toThrow("Invalid configuration");
    });

    test("rejects domain as boolean", () => {
      const yaml = `domain: true`;
      expect(() => validateSchema(yaml)).toThrow("Invalid configuration");
    });

    test("rejects pulumi.enabled as string", () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: "yes"
`;
      expect(() => validateSchema(yaml)).toThrow("Invalid configuration");
    });

    test("rejects pulumi.sshPort as string", () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: true
  sshPort: "22"
`;
      expect(() => validateSchema(yaml)).toThrow("Invalid configuration");
    });

    test("rejects servers as object instead of array", () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: true
  stacks:
    dev:
      servers:
        backend:
          size: small
`;
      expect(() => validateSchema(yaml)).toThrow("Invalid configuration");
    });

    test("rejects roles as string instead of array", () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: true
  stacks:
    dev:
      servers:
        - roles: backend
`;
      expect(() => validateSchema(yaml)).toThrow("Invalid configuration");
    });

    test("rejects backend.port as string", () => {
      const yaml = `
domain: example.com
ansible:
  enabled: true
  backend:
    image: myapp
    tag: latest
    port: "8080"
`;
      expect(() => validateSchema(yaml)).toThrow("Invalid configuration");
    });

    test("rejects requiredVars as string instead of array", () => {
      const yaml = `
domain: example.com
secrets:
  provider: bws
  requiredVars: API_KEY
`;
      expect(() => validateSchema(yaml)).toThrow("Invalid configuration");
    });
  });

  // ============================================
  // Invalid Configurations - Invalid Enum Values
  // ============================================

  describe("invalid enum values", () => {
    test("rejects invalid pulumi command", () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: true
  command: deploy
`;
      expect(() => validateSchema(yaml)).toThrow("Invalid configuration");
    });

    test("rejects invalid stack name", () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: true
  stacks:
    development:
      servers: []
`;
      expect(() => validateSchema(yaml)).toThrow("Invalid configuration");
    });

    test("rejects invalid server role", () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: true
  stacks:
    dev:
      servers:
        - roles:
            - database
`;
      expect(() => validateSchema(yaml)).toThrow("Invalid configuration");
    });

    test("rejects invalid secrets provider", () => {
      const yaml = `
domain: example.com
secrets:
  provider: vault
`;
      expect(() => validateSchema(yaml)).toThrow("Invalid configuration");
    });

    test("rejects invalid static source", () => {
      const yaml = `
domain: example.com
ansible:
  enabled: true
  web:
    static:
      source: remote
`;
      expect(() => validateSchema(yaml)).toThrow("Invalid configuration");
    });
  });

  // ============================================
  // Extra Fields - t.exact strips them silently
  // ============================================

  describe("extra fields (t.exact strips them)", () => {
    test("strips extra field at root level", () => {
      const yaml = `
domain: example.com
unknownField: value
`;
      const result = validateSchema(yaml);
      expect(result).toEqual({ domain: "example.com" });
      expect((result as Record<string, unknown>).unknownField).toBeUndefined();
    });

    test("strips extra field in pulumi section", () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: true
  extraField: value
`;
      const result = validateSchema(yaml);
      expect(result.pulumi?.enabled).toBe(true);
      expect(
        (result.pulumi as Record<string, unknown>).extraField,
      ).toBeUndefined();
    });

    test("strips extra field in ansible section", () => {
      const yaml = `
domain: example.com
ansible:
  enabled: true
  customOption: true
`;
      const result = validateSchema(yaml);
      expect(result.ansible?.enabled).toBe(true);
      expect(
        (result.ansible as Record<string, unknown>).customOption,
      ).toBeUndefined();
    });

    test("strips extra field in server config", () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: true
  stacks:
    dev:
      servers:
        - roles:
            - backend
          customField: value
    staging:
      servers: []
    prod:
      servers: []
`;
      const result = validateSchema(yaml);
      const server = result.pulumi?.stacks?.dev?.servers[0];
      expect(server?.roles).toContain("backend");
      expect((server as Record<string, unknown>).customField).toBeUndefined();
    });

    test("strips extra field in backend config", () => {
      const yaml = `
domain: example.com
ansible:
  enabled: true
  backend:
    image: myapp
    tag: latest
    memory: 512
`;
      const result = validateSchema(yaml);
      expect(result.ansible?.backend?.image).toBe("myapp");
      expect(
        (result.ansible?.backend as Record<string, unknown>).memory,
      ).toBeUndefined();
    });
  });

  // ============================================
  // Error Message Content
  // ============================================

  describe("error messages", () => {
    test("error message contains field path for missing domain", () => {
      const yaml = `pulumi:\n  enabled: true`;
      try {
        validateSchema(yaml);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect((error as Error).message).toContain("domain");
      }
    });

    test("error message contains field path for nested error", () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: "not-a-boolean"
`;
      try {
        validateSchema(yaml);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect((error as Error).message).toContain("pulumi");
        expect((error as Error).message).toContain("enabled");
      }
    });
  });
});
