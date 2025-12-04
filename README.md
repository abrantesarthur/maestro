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

ansible:
  enabled: true # Enable/disable Ansible provisioning
  website_dir: "/path/to/site" # Path to website source
  web:
    enabled: true # Enable/disable web (nginx) provisioning
  backend:
    enabled: true # Enable/disable backend provisioning
    image: ghcr.io/org/app # Container image
    tag: latest # Image tag
    port: 3000 # Backend port
    env: # Environment variables for container
      PORT: 3000
      DATABASE_URL: postgres://...
  perms:
    enabled: true # Enable/disable permissions provisioning

secrets:
  provider: bws # Secrets provider (bws = Bitwarden)
  project_id: "" # Optional BWS project ID
  required_vars: [] # Additional secrets to validate
```

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

# FIXME: explain VPS_SSH_KEY better

# FIXME: explain somewhere that we currently only support DigitalOcean and add a Future Improvements section asking for more support later

| Secret                 | Purpose                            |
| ---------------------- | ---------------------------------- |
| `VPS_SSH_KEY`          | SSH private key for server access  |
| `GHCR_TOKEN`           | GitHub Container Registry token    |
| `GHCR_USERNAME`        | GitHub Container Registry username |
| `PULUMI_ACCESS_TOKEN`  | Pulumi Cloud access token          |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token               |
| `DIGITALOCEAN_TOKEN`   | DigitalOcean API token             |

You can specify additional required secrets in your `maestro.yaml` under `secrets.required_vars`.

## Components

- `pulumi/` — Pulumi programs for provisioning Cloudflare DNS, DigitalOcean VPS, and SSH tunneling into the servers.
- `ansible/` — Ansible execution environment, inventories, and playbooks that configure the servers.

## Workflow

`run.sh` orchestrates the entire provisioning process:

1. Loads configuration from `maestro.yaml`
2. Fetches secrets from Bitwarden Secrets Manager
3. Runs Pulumi to provision cloud infrastructure (DNS, servers, tunnels)
4. Waits for servers to accept connection via SSH tunnels.
5. Runs Ansible to tunnel into and configure the servers (nginx, Docker, backend app)
