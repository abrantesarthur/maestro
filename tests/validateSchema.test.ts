import { describe, expect, test } from "bun:test";
import { validateSchema } from "../lib/config/validateSchema";

describe("validateSchema", () => {
  describe("valid configurations", () => {
    test("accepts minimal config with only domain", async () => {
      const yaml = `domain: example.com`;
      expect(await validateSchema(yaml)).toEqual({ domain: "example.com" });
    });

    test("accepts config with pulumi section", async () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: false
  command: up
  cloudflareAccountId: abc123
  sshPort: 22
  stacks:
    dev:
      servers: []
    staging:
      servers: []
    prod:
      servers: []
`;
      const result = await validateSchema(yaml);
      expect(result.domain).toBe("example.com");
      expect(result.pulumi?.enabled).toBe(false);
      expect(result.pulumi?.command).toBe("up");
      expect(result.pulumi?.sshPort).toBe(22);
    });

    test("accepts config with pulumi stacks", async () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: true
  command: up
  cloudflareAccountId: abc123
  sshPort: 22
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
      const result = await validateSchema(yaml);
      expect(result.pulumi?.stacks?.dev?.servers).toHaveLength(1);
      expect(result.pulumi?.stacks?.dev?.servers[0].roles).toContain("backend");
      expect(result.pulumi?.stacks?.prod?.servers[0].roles).toContain("web");
    });

    test("accepts config with ansible section", async () => {
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
  backend:
    image: myapp
    tag: v1.0.0
    port: 8080
    env:
      NODE_ENV: production
`;
      const result = await validateSchema(yaml);
      expect(result.ansible?.enabled).toBe(true);
      expect(result.ansible?.web?.static?.source).toBe("local");
      expect(result.ansible?.backend?.image).toBe("myapp");
    });

    test("accepts config with secrets section", async () => {
      const yaml = `
domain: example.com
secrets:
  provider: bws
  projectId: my-project
  requiredVars:
    - API_KEY
    - DB_PASSWORD
`;
      const result = await validateSchema(yaml);
      expect(result.secrets?.provider).toBe("bws");
      expect(result.secrets?.projectId).toBe("my-project");
      expect(result.secrets?.requiredVars).toContain("API_KEY");
    });

    test("accepts full config with all sections", async () => {
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
      const result = await validateSchema(yaml);
      expect(result.domain).toBe("example.com");
      expect(result.pulumi?.enabled).toBe(true);
      expect(result.ansible?.enabled).toBe(true);
      expect(result.secrets?.provider).toBe("bws");
    });

    test("accepts all valid pulumi commands", async () => {
      const commands = ["up", "refresh", "cancel", "output"] as const;
      for (const command of commands) {
        const yaml = `
domain: example.com
pulumi:
  enabled: false
  command: ${command}
  cloudflareAccountId: abc123
  sshPort: 22
  stacks:
    dev:
      servers: []
    staging:
      servers: []
    prod:
      servers: []
`;
        const result = await validateSchema(yaml);
        expect(result.pulumi?.command).toBe(command);
      }
    });

    test("accepts all valid stack names", async () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: true
  command: up
  cloudflareAccountId: abc123
  sshPort: 22
  stacks:
    dev:
      servers: []
    staging:
      servers: []
    prod:
      servers: []
`;
      const result = await validateSchema(yaml);
      expect(result.pulumi?.stacks?.dev).toBeDefined();
      expect(result.pulumi?.stacks?.staging).toBeDefined();
      expect(result.pulumi?.stacks?.prod).toBeDefined();
    });

    test("accepts all valid server roles", async () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: true
  command: up
  cloudflareAccountId: abc123
  sshPort: 22
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
ansible:
  enabled: true
  web:
    docker:
      image: nginx
      tag: latest
  backend:
    image: myapp
    tag: latest
`;
      const result = await validateSchema(yaml);
      expect(result.pulumi?.stacks?.dev?.servers[0].roles).toContain("backend");
      expect(result.pulumi?.stacks?.dev?.servers[0].roles).toContain("web");
    });

    test("accepts web static with image source", async () => {
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
      const result = await validateSchema(yaml);
      expect(result.ansible?.web?.static?.source).toBe("image");
      expect(result.ansible?.web?.static?.image).toBe("my-static-image");
    });
  });

  // ============================================
  // Invalid Configurations - Missing Required Fields
  // ============================================

  describe("missing required fields", () => {
    test("rejects empty config", async () => {
      const yaml = ``;
      await expect(validateSchema(yaml)).rejects.toThrow(
        "Invalid configuration",
      );
    });

    test("rejects config without domain", async () => {
      const yaml = `
pulumi:
  enabled: true
`;
      await expect(validateSchema(yaml)).rejects.toThrow(
        "Invalid configuration",
      );
    });

    test("rejects pulumi without enabled field", async () => {
      const yaml = `
domain: example.com
pulumi:
  command: up
`;
      await expect(validateSchema(yaml)).rejects.toThrow(
        "Invalid configuration",
      );
    });

    test("rejects ansible without enabled field", async () => {
      const yaml = `
domain: example.com
ansible:
  groups:
    - webservers
`;
      await expect(validateSchema(yaml)).rejects.toThrow(
        "Invalid configuration",
      );
    });

    test("rejects secrets without provider field", async () => {
      const yaml = `
domain: example.com
secrets:
  projectId: my-project
`;
      await expect(validateSchema(yaml)).rejects.toThrow(
        "Invalid configuration",
      );
    });

    test("rejects backend without image field", async () => {
      const yaml = `
domain: example.com
ansible:
  enabled: true
  backend:
    tag: latest
`;
      await expect(validateSchema(yaml)).rejects.toThrow(
        "Invalid configuration",
      );
    });

    test("rejects backend without tag field", async () => {
      const yaml = `
domain: example.com
ansible:
  enabled: true
  backend:
    image: myapp
`;
      await expect(validateSchema(yaml)).rejects.toThrow(
        "Invalid configuration",
      );
    });

    test("rejects web docker without image field", async () => {
      const yaml = `
domain: example.com
ansible:
  enabled: true
  web:
    docker:
      tag: latest
`;
      await expect(validateSchema(yaml)).rejects.toThrow(
        "Invalid configuration",
      );
    });

    test("rejects web static without source field", async () => {
      const yaml = `
domain: example.com
ansible:
  enabled: true
  web:
    static:
      dir: ./web
`;
      await expect(validateSchema(yaml)).rejects.toThrow(
        "Invalid configuration",
      );
    });

    test("rejects server without roles field", async () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: true
  command: up
  cloudflareAccountId: abc123
  sshPort: 22
  stacks:
    dev:
      servers:
        - size: small
`;
      await expect(validateSchema(yaml)).rejects.toThrow(
        "Invalid configuration",
      );
    });

    test("rejects stack without servers field", async () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: true
  command: up
  cloudflareAccountId: abc123
  sshPort: 22
  stacks:
    dev: {}
`;
      await expect(validateSchema(yaml)).rejects.toThrow(
        "Invalid configuration",
      );
    });
  });

  // ============================================
  // Invalid Configurations - Wrong Types
  // ============================================

  describe("wrong types", () => {
    test("rejects domain as number", async () => {
      const yaml = `domain: 12345`;
      await expect(validateSchema(yaml)).rejects.toThrow(
        "Invalid configuration",
      );
    });

    test("rejects domain as boolean", async () => {
      const yaml = `domain: true`;
      await expect(validateSchema(yaml)).rejects.toThrow(
        "Invalid configuration",
      );
    });

    test("rejects pulumi.enabled as string", async () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: "yes"
  command: up
  cloudflareAccountId: abc123
  sshPort: 22
  stacks: {}
`;
      await expect(validateSchema(yaml)).rejects.toThrow(
        "Invalid configuration",
      );
    });

    test("rejects pulumi.sshPort as string", async () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: true
  command: up
  cloudflareAccountId: abc123
  sshPort: "22"
  stacks: {}
`;
      await expect(validateSchema(yaml)).rejects.toThrow(
        "Invalid configuration",
      );
    });

    test("rejects servers as object instead of array", async () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: true
  command: up
  cloudflareAccountId: abc123
  sshPort: 22
  stacks:
    dev:
      servers:
        backend:
          size: small
`;
      await expect(validateSchema(yaml)).rejects.toThrow(
        "Invalid configuration",
      );
    });

    test("rejects roles as string instead of array", async () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: true
  command: up
  cloudflareAccountId: abc123
  sshPort: 22
  stacks:
    dev:
      servers:
        - roles: backend
`;
      await expect(validateSchema(yaml)).rejects.toThrow(
        "Invalid configuration",
      );
    });

    test("rejects backend.port as string", async () => {
      const yaml = `
domain: example.com
ansible:
  enabled: true
  backend:
    image: myapp
    tag: latest
    port: "8080"
`;
      await expect(validateSchema(yaml)).rejects.toThrow(
        "Invalid configuration",
      );
    });

    test("rejects requiredVars as string instead of array", async () => {
      const yaml = `
domain: example.com
secrets:
  provider: bws
  requiredVars: API_KEY
`;
      await expect(validateSchema(yaml)).rejects.toThrow(
        "Invalid configuration",
      );
    });
  });

  // ============================================
  // Invalid Configurations - Invalid Enum Values
  // ============================================

  describe("invalid enum values", () => {
    test("rejects invalid pulumi command", async () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: true
  command: deploy
  cloudflareAccountId: abc123
  sshPort: 22
  stacks: {}
`;
      await expect(validateSchema(yaml)).rejects.toThrow(
        "Invalid configuration",
      );
    });

    test("rejects invalid stack name", async () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: true
  command: up
  cloudflareAccountId: abc123
  sshPort: 22
  stacks:
    development:
      servers: []
`;
      await expect(validateSchema(yaml)).rejects.toThrow(
        "Invalid configuration",
      );
    });

    test("rejects invalid server role", async () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: true
  command: up
  cloudflareAccountId: abc123
  sshPort: 22
  stacks:
    dev:
      servers:
        - roles:
            - database
`;
      await expect(validateSchema(yaml)).rejects.toThrow(
        "Invalid configuration",
      );
    });

    test("rejects invalid secrets provider", async () => {
      const yaml = `
domain: example.com
secrets:
  provider: vault
`;
      await expect(validateSchema(yaml)).rejects.toThrow(
        "Invalid configuration",
      );
    });

    test("rejects invalid static source", async () => {
      const yaml = `
domain: example.com
ansible:
  enabled: true
  web:
    static:
      source: remote
`;
      await expect(validateSchema(yaml)).rejects.toThrow(
        "Invalid configuration",
      );
    });
  });

  // ============================================
  // Extra Fields - t.exact strips them silently
  // ============================================

  describe("extra fields (t.exact strips them)", () => {
    test("strips extra field at root level", async () => {
      const yaml = `
domain: example.com
unknownField: value
`;
      const result = await validateSchema(yaml);
      expect(result).toEqual({ domain: "example.com" });
      expect((result as Record<string, unknown>).unknownField).toBeUndefined();
    });

    test("strips extra field in pulumi section", async () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: false
  command: up
  cloudflareAccountId: abc123
  sshPort: 22
  stacks:
    dev:
      servers: []
    staging:
      servers: []
    prod:
      servers: []
  extraField: value
`;
      const result = await validateSchema(yaml);
      expect(result.pulumi?.enabled).toBe(false);
      expect(
        (result.pulumi as Record<string, unknown>).extraField,
      ).toBeUndefined();
    });

    test("strips extra field in ansible section", async () => {
      const yaml = `
domain: example.com
ansible:
  enabled: true
  customOption: true
`;
      const result = await validateSchema(yaml);
      expect(result.ansible?.enabled).toBe(true);
      expect(
        (result.ansible as Record<string, unknown>).customOption,
      ).toBeUndefined();
    });

    test("strips extra field in server config", async () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: true
  command: up
  cloudflareAccountId: abc123
  sshPort: 22
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
ansible:
  enabled: true
  backend:
    image: myapp
    tag: latest
`;
      const result = await validateSchema(yaml);
      const server = result.pulumi?.stacks?.dev?.servers[0];
      expect(server?.roles).toContain("backend");
      expect((server as Record<string, unknown>).customField).toBeUndefined();
    });

    test("strips extra field in backend config", async () => {
      const yaml = `
domain: example.com
ansible:
  enabled: true
  backend:
    image: myapp
    tag: latest
    memory: 512
`;
      const result = await validateSchema(yaml);
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
    test("error message contains field path for missing domain", async () => {
      const yaml = `pulumi:\n  enabled: true`;
      try {
        await validateSchema(yaml);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect((error as Error).message).toContain("domain");
      }
    });

    test("error message contains field path for nested error", async () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: "not-a-boolean"
  command: up
  cloudflareAccountId: abc123
  sshPort: 22
  stacks: {}
`;
      try {
        await validateSchema(yaml);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect((error as Error).message).toContain("pulumi");
        expect((error as Error).message).toContain("enabled");
      }
    });
  });

  // ============================================
  // Semantic Validation
  // ============================================

  describe("semantic validation", () => {
    test("rejects enabled pulumi without prod stack", async () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: true
  command: up
  cloudflareAccountId: abc123
  sshPort: 22
  stacks:
    dev:
      servers: []
`;
      await expect(validateSchema(yaml)).rejects.toThrow(
        "pulumi.stacks.prod is required when pulumi.enabled is true",
      );
    });

    test("rejects config with both ansible.web.static and ansible.web.docker", async () => {
      const yaml = `
domain: example.com
ansible:
  enabled: true
  web:
    static:
      source: local
      dir: ./dist
    docker:
      image: nginx
      tag: latest
`;
      await expect(validateSchema(yaml)).rejects.toThrow(
        "ansible.web.static and ansible.web.docker cannot both be specified",
      );
    });

    test("rejects config with web role but no ansible.web config", async () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: true
  command: up
  cloudflareAccountId: abc123
  sshPort: 22
  stacks:
    dev:
      servers:
        - roles:
            - web
    staging:
      servers: []
    prod:
      servers: []
ansible:
  enabled: true
`;
      await expect(validateSchema(yaml)).rejects.toThrow(
        "ansible.web.static or ansible.web.docker must be configured when servers have the 'web' role",
      );
    });

    test("rejects config with backend role but no ansible.backend config", async () => {
      const yaml = `
domain: example.com
pulumi:
  enabled: true
  command: up
  cloudflareAccountId: abc123
  sshPort: 22
  stacks:
    dev:
      servers:
        - roles:
            - backend
    staging:
      servers: []
    prod:
      servers: []
ansible:
  enabled: true
`;
      await expect(validateSchema(yaml)).rejects.toThrow(
        "ansible.backend.image and ansible.backend.tag are required when servers have the 'backend' role",
      );
    });
  });
});
