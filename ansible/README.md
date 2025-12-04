# Ansible Provisioning

This directory contains the Ansible automation that provisions resources in a server.

## Workflow

Run `./run.sh --ssh-hosts <list>` with the required flags. The script validates required inputs and ensures `ansible-builder`/`ansible-navigator` exist before doing any work. Then, it builds the execution environment image, and uses `ansible-navigator` to run the container.

After secrets are in place, `run.sh` builds the execution environment image via `ansible-builder` and then provisions the ansible playbooks.
It assumes the backend application image has already been built and pushed to GHCR under the tag you provide.

## Required Flags

| Flag          | Purpose                                                                                                                                                                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--ssh-hosts` | A JSON list of hosts and their tags (e.g., {"hosts":[{"hostname":"ssh0.example.com","tags":["backend","prod"]}]}). Tags on each host become Ansible inventory groups, that playbooks can target. For instance, we can decide to provision nginx only on hosts tagged with `web`. |

## Optional Flags

| Flag             | Purpose                                                        |
| ---------------- | -------------------------------------------------------------- |
| `--skip-bws`     | Whether to skip pulling secrets from Bitwarden Secrets Manager |
| `--skip-web`     | Whether to skip provisioning web.                              |
| `--skip-backend` | Whether to skip provisioning backend.                          |
| `--skip-perms`   | Whether to skip provisioning perms.                            |

### Required Environment:

| Variable            | Purpose                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `BWS_ACCESS_TOKEN`  | Bitwarden Secrets Manager's token required for retrieving other secrets.                           |
| `BACKEND_IMAGE`     | Full ghcr.io image reference (e.g., `ghcr.io/your-org/your-app`). Required when deploying backend. |
| `BACKEND_IMAGE_TAG` | Image tag to deploy (e.g., `latest`, `v1.0.0`, `sha-abc123`). Required when deploying backend.     |

## Optional Environment

| Variable            | Purpose                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `BWS_PROJECT_ID`    | The id of the Bitwarden Secrets Manager's project from which to draw secrets. If omitted, we fetch secrets from every project. |
| `BWS_REQUIRED_VARS` | Comma-separated list of BWS secret names to validate before provisioning (e.g., `MY_API_KEY,DATABASE_PASSWORD`).               |

## Container Registry

Currently only GitHub Container Registry (ghcr.io) images are supported. The playbook authenticates using `GHCR_USERNAME` and `GHCR_TOKEN` secrets from Bitwarden.

To use a different registry, you would need to modify the `backend_app` role to support alternative authentication methods.

## Backend Container Environment

Environment variables for your backend container are configured using the `BACKEND_ENV_` prefix convention.

### How It Works

1. Any environment variable starting with `BACKEND_ENV_` is automatically detected
2. The `BACKEND_ENV_` prefix is stripped from the variable name
3. The resulting key-value pair is passed to the Docker container

This allows you to configure any environment variable your application needs without modifying the Ansible role.

### Examples

| Environment Variable                      | Container Receives            |
| ----------------------------------------- | ----------------------------- |
| `BACKEND_ENV_PORT=3000`                   | `PORT=3000`                   |
| `BACKEND_ENV_DATABASE_URL=postgres://...` | `DATABASE_URL=postgres://...` |
| `BACKEND_ENV_API_KEY=secret`              | `API_KEY=secret`              |

### Configuration

Add your backend environment variables to `ansible/.env`:

```bash
# Required for most apps
BACKEND_ENV_PORT=3000

# Your app-specific variables
BACKEND_ENV_DATABASE_URL=postgres://user:pass@host:5432/db
BACKEND_ENV_REDIS_URL=redis://localhost:6379
```

See `ansible/example.env` for a complete template.

## Ports

- 443: listens for TLS connections

## Components

### Roles and Playbooks

Roles:

- **roles/ufw**: installs and configures UFW to deny inbound traffic by default while allowing SSH (22) and backend (3000) from localhost (via cloudflared) and HTTPS (443) only from Cloudflare IP ranges.
- **roles/groups**: manages system groups from `roles/groups/vars/main.yml`.
- **roles/docker**: installs and enables the Docker engine and Python bindings.
- **roles/nginx**: installs and configures nginx for the web tier.
- **roles/backend_app**: logs into GHCR, pulls the tagged backend image, and runs the backend container in port 3000 by default.

Playbooks:

- **perms.yml**: applies group/permission management.
- **web.yml**: provisions the web tier (nginx).
- **backend.yml**: provisions backend hosts (Docker engine + backend_app).

### Inventory, Hosts, and Groups

The dynamic inventory (`inventory/hosts.py`) reads the SSH_HOSTS JSON provided to `run.sh` and builds:

- `all` hosts with common vars (including the Cloudflare proxy SSH args).
- One group per tag listed on each host, so you can target plays to all `backend`, `prod`, `web`, etc. hosts by tag.

## Prerequisites

- Docker installed locally (the script builds and runs a container).
- The `ansible-builder` and `ansible-navigator` programs must be installed.

## Idempotence

All playbooks are idempotent. Running them repeatedly will either make changes (if drift is detected) or do nothing (if the server already matches the declared state).

## Future improvements

- right now there is no distinction between servers. We should support different provisionings for different kinds of servers (e.g. web servers, backend servers. etc). This way, we can provision nginx only on servers with the website.
