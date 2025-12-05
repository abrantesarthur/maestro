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
        - roles: [backend, web] # Server roles
          # size: s-1vcpu-1gb  # Optional: DigitalOcean droplet size
          # region: nyc1       # Optional: DigitalOcean region
    # staging:                 # Uncomment to add a staging stack
    #   servers:
    #     - roles: [backend, web]

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

### Multi-Stack Support

Maestro supports multiple isolated environments through Pulumi stacks. Each stack (`dev`, `staging`, `prod`) maintains its own infrastructure state.

```yaml
pulumi:
  stacks:
    staging:
      servers:
        - roles: [backend, web]
    prod:
      servers:
        - roles: [backend]
          size: s-2vcpu-4gb
        - roles: [web]
```

When you run `./run.sh`, Maestro provisions each defined stack sequentially, then aggregates all hosts for Ansible configuration. Each server is tagged with its stack name (e.g., `prod`, `staging`) in addition to its roles (e.g., `backend`, `web`), allowing Ansible playbooks to target servers by environment if needed. See [`ansible/README.md`](ansible/README.md) for details on host targeting.

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

# FIXME: explain somewhere that we currently only support DigitalOcean and add a Future Improvements section asking for more support later.

# FIXME: update Future Improvements section to say that we need to figure out a way to provision the ssh keys into the servers automatically

# FIXME: update future improvements to ask for a way to validate the YAML format. I used something in transcend to do this via io-ts I think.

# FIXME: think better the server tag strategy within pulumi and ansible. How can we make it so that if a server has a recognized tag (role) within the pulumi section, then we must have a corresponding role for that tag in the ansible section? Is there an easy way for users to implement they custom tagging and what should happein in ansible? Also, should we call these tags roles or playbooks within the Pulumi section? We currently call them roles but they actually map to playbooks in ansible.

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
