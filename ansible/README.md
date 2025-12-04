# Ansible Provisioning

This directory contains the Ansible automation that configures provisioned servers.

## Workflow

This script is typically called by the parent `run.sh` which handles configuration loading from `maestro.yaml`. For standalone usage:

```bash
# Configuration is passed via environment variables
export DOMAIN="example.com"
export BACKEND_PORT="3000"
export BACKEND_IMAGE="ghcr.io/your-org/your-app"
export BACKEND_IMAGE_TAG="latest"
export BACKEND_ENV_PORT="3000"
export BWS_ACCESS_TOKEN="your_bws_token"

./run.sh \
  --ssh-hosts '{"hosts":[{"hostname":"ssh0.example.com","tags":["backend","prod","web"]}]}' \
  --website-dir "/path/to/website"
```

The script validates required inputs, ensures `ansible-builder`/`ansible-navigator` exist, builds the execution environment image, and runs the playbooks.

## Configuration

Configuration is passed via environment variables from the parent `run.sh`, which reads from `maestro.yaml`:

# FIXME: add "Description" column explaining what each env var is used for.

| Variable            | Source in maestro.yaml  |
| ------------------- | ----------------------- |
| `DOMAIN`            | `domain`                |
| `BACKEND_PORT`      | `ansible.backend.port`  |
| `BACKEND_IMAGE`     | `ansible.backend.image` |
| `BACKEND_IMAGE_TAG` | `ansible.backend.tag`   |
| `BACKEND_ENV_*`     | `ansible.backend.env.*` |

### Backend Container Environment

Environment variables needed by your backend containerized application can be configured in `maestro.yaml` under `ansible.backend.env`:

```yaml
ansible:
  backend:
    env:
      PORT: 3000
      DATABASE_URL: postgres://user:pass@host:5432/db
      API_KEY: your_api_key
```

Each key-value pair becomes an environment variable in the container (e.g., `PORT=3000`).

## CLI Flags

| Flag                   | Purpose                                                         |
| ---------------------- | --------------------------------------------------------------- |
| `--ssh-hosts <json>`   | JSON list of hosts and tags (required)                          |
| `--website-dir <path>` | Path to website source directory (required unless `--skip-web`) |
| `--skip-bws`           | Skip fetching secrets from Bitwarden                            |
| `--skip-web`           | Skip provisioning web server                                    |
| `--skip-backend`       | Skip provisioning backend                                       |
| `--skip-perms`         | Skip provisioning permissions                                   |

## Required Secrets (from Bitwarden)

| Secret          | Purpose                            |
| --------------- | ---------------------------------- |
| `GHCR_TOKEN`    | GitHub Container Registry token    |
| `GHCR_USERNAME` | GitHub Container Registry username |
| `VPS_SSH_KEY`   | SSH key for server access          |

## Container Registry

Currently only GitHub Container Registry (ghcr.io) images are supported. The playbook authenticates using `GHCR_USERNAME` and `GHCR_TOKEN` secrets from Bitwarden.

## Components

### Roles and Playbooks

Roles:

- **roles/ufw**: Installs and configures UFW to deny inbound traffic by default while allowing SSH (22) and backend from localhost (via cloudflared) and HTTPS (443) only from Cloudflare IP ranges.
- **roles/groups**: Manages system groups from `roles/groups/vars/main.yml`.
- **roles/docker**: Installs and enables the Docker engine and Python bindings.
- **roles/nginx**: Installs and configures nginx for the web tier.
- **roles/backend_app**: Logs into GHCR, pulls the tagged backend image, and runs the backend container.

Playbooks:

- **perms.yml**: Applies group/permission management.
- **web.yml**: Provisions the web tier (nginx).
- **backend.yml**: Provisions backend hosts (Docker engine + backend_app).

### Inventory, Hosts, and Groups

The dynamic inventory (`inventory/hosts.py`) reads the SSH_HOSTS JSON and builds:

- `all` hosts with common vars (including the Cloudflare proxy SSH args).

# FIXME: allo to specify tags in the maestro.yaml configuration

- One group per tag listed on each host, so you can target plays to `backend`, `prod`, `web`, etc.

## Prerequisites

- Docker installed locally (the script builds and runs a container).
- The `ansible-builder` and `ansible-navigator` programs (auto-installed if missing).

## Idempotence

All playbooks are idempotent. Running them repeatedly will either make changes (if drift is detected) or do nothing (if the server already matches the declared state).
