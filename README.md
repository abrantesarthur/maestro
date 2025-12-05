# Maestro

Maestro is an infrastructure orchestration tool that combines Pulumi and Ansible to provision and configure cloud infrastructure.

## Quick Start

1. Copy the example configuration file:

   ```bash
   cp example.maestro.yaml maestro.yaml
   ```

2. Edit `maestro.yaml` with your configuration (domain, Cloudflare account ID, etc.)

3. Set your Bitwarden Secrets Manager access token:

   ```bash
   export BWS_ACCESS_TOKEN="your_bws_access_token"
   ```

4. Run the orchestration:
   ```bash
   ./run.sh
   ```

## Configuration

All configuration is managed through a single YAML file: `maestro.yaml`

See `example.maestro.yaml` for a fully documented template with all available options.

### Configuration Structure

```yaml
domain: example.com # Domain for DNS and nginx

pulumi:
  enabled: true # Enable/disable Pulumi provisioning
  command: up # Pulumi command: up, refresh, cancel, output
  cloudflare_account_id: "" # Your Cloudflare account ID
  ssh_port: 22 # SSH port for tunnels
  stacks: # Define one or more stacks (dev, staging, prod)
    prod:
      servers:
        - roles: [backend, web, perms] # Server roles determine what gets provisioned
          # size: s-1vcpu-1gb  # Optional: DigitalOcean droplet size
          # region: nyc1       # Optional: DigitalOcean region

ansible:
  enabled: true # Enable/disable all Ansible provisioning
  web: # Required if any server has "web" role
    static:
      source: local
      dir: "/path/to/site"
  backend: # Required if any server has "backend" role
    image: ghcr.io/org/app # Container image
    tag: latest # Image tag
    port: 3000 # Backend port
    env: # Environment variables for container
      DATABASE_URL: postgres://...
  perms: # Required if any server has "perms" role
    groups: [devops] # System groups to manage

secrets:
  provider: bws # Secrets provider (bws = Bitwarden)
  project_id: "" # Optional BWS project ID
  required_vars: [] # Additional secrets to validate
```

### Server Roles

Provisioning is **role-based**: Ansible playbooks run only on servers that have the corresponding role. Available roles:

| Role      | Ansible Playbook | Purpose                               |
| --------- | ---------------- | ------------------------------------- |
| `backend` | `backend.yml`    | Docker + backend container deployment |
| `web`     | `web.yml`        | nginx (static files or reverse proxy) |
| `perms`   | `perms.yml`      | UFW firewall rules + system groups    |

If no server has a particular role, that playbook is skipped entirely.

### Multi-Stack Support

Maestro supports multiple isolated environments through Pulumi stacks. Each stack (`dev`, `staging`, `prod`) maintains its own infrastructure state.

```yaml
pulumi:
  stacks:
    staging:
      servers:
        - roles: [backend, web, perms]
    prod:
      servers:
        - roles: [backend, perms]
          size: s-2vcpu-4gb
        - roles: [web, perms]
```

When you run `./run.sh`, Maestro provisions each defined stack sequentially, then aggregates all hosts for Ansible configuration. Each server is tagged with its stack name (e.g., `prod`, `staging`) in addition to its roles (e.g., `backend`, `web`, `perms`), allowing Ansible playbooks to target servers by environment if needed. See [`ansible/README.md`](ansible/README.md) for details on host targeting.

### Required Environment Variable

| Variable           | Purpose                                                                |
| ------------------ | ---------------------------------------------------------------------- |
| `BWS_ACCESS_TOKEN` | Bitwarden Secrets Manager token required for retrieving other secrets. |

### CLI Options

| Flag        | Purpose                                 |
| ----------- | --------------------------------------- |
| `--dry-run` | Preview configuration without executing |

### Secrets

Secrets are stored in Bitwarden Secrets Manager and fetched at runtime. The following secrets are required:

FIXME: think better the whole perms playbook. We should be able to customize permissioning per server, not have every server with the same permissioning configuraiton.

FIXME: Is there an easy way for users to implement they custom tagging and what should happein in ansible? Also, should we call these tags roles or playbooks within the Pulumi section? We currently call them roles but they actually map to playbooks in ansible.

FIXME: update the provisioning of dev and staging stacks to, for instance, serve the resources in different domains (e.g., dev.example.com, stag.example.com, etc.). Make any other changes needed...

| Secret                 | Purpose                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VPS_SSH_KEY`          | SSH private key for accessing DigitalOcean servers. The corresponding public key must be manually added to your DigitalOcean account beforehand. |
| `GHCR_TOKEN`           | GitHub Container Registry token                                                                                                                  |
| `GHCR_USERNAME`        | GitHub Container Registry username                                                                                                               |
| `PULUMI_ACCESS_TOKEN`  | Pulumi Cloud access token                                                                                                                        |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token                                                                                                                             |
| `DIGITALOCEAN_TOKEN`   | DigitalOcean API token                                                                                                                           |

You can specify additional required secrets in your `maestro.yaml` under `secrets.required_vars`.

## Components

- `pulumi/` — Pulumi programs for provisioning Cloudflare DNS, DigitalOcean VPS, and SSH tunneling into the servers.
- `ansible/` — Ansible execution environment, inventories, and playbooks that configure the servers.

## Workflow

`run.sh` orchestrates the entire provisioning process:

1. Loads configuration from `maestro.yaml`
2. Fetches secrets from Bitwarden Secrets Manager
3. Runs Pulumi for each defined stack (dev, staging, prod) to provision cloud infrastructure (DNS, servers, tunnels)
4. Aggregates hosts from all stacks
5. Waits for servers to accept connection via SSH tunnels
6. Runs Ansible to tunnel into and configure the servers (nginx, Docker, backend app)

## Future Improvements

- **Multi-cloud provider support**: Currently, Maestro only supports DigitalOcean as a cloud provider. Future versions may add support for AWS, GCP, Azure, and other providers.

- **Automated SSH key provisioning**: SSH keys must be manually added to your DigitalOcean account before running Maestro. A future improvement would automate the creation and registration of SSH keys during the provisioning process.

- **Configuration schema validation**: Add typed schema validation for `maestro.yaml` to catch configuration errors early and provide better error messages.
