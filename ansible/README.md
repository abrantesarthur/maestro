# Ansible Provisioning

This directory contains the Ansible automation that configures provisioned servers.

## Workflow

Ansible is orchestrated from TypeScript by [`lib/runAnsible.ts`](../lib/runAnsible.ts), which is invoked when you run `bun .` from the repo root (after Pulumi has produced the host list). It reads `maestro.yaml`, validates required inputs, ensures `ansible-builder`/`ansible-navigator` exist, prepares the static website assets, builds the execution environment image, and runs the playbooks (`web.yml`, `backend.yml`, `security.yml`) inside it.

Host targeting is driven by the `SSH_HOSTS` JSON (aggregated from all Pulumi stacks), which includes an `effectiveDomain` per host for nginx configuration. Web and backend playbooks are skipped automatically when no server declares the corresponding role.

## Configuration

Configuration is read from `maestro.yaml` by `lib/runAnsible.ts` and passed into the execution environment as environment variables:

| Variable            | Source in maestro.yaml  | Purpose                                               |
| ------------------- | ----------------------- | ----------------------------------------------------- |
| `BACKEND_PORT`      | `ansible.backend.port`  | Port mapping for Docker container                     |
| `BACKEND_IMAGE`     | `ansible.backend.image` | Backend image to pull from GHCR and run in a server.  |
| `BACKEND_IMAGE_TAG` | `ansible.backend.tag`   | Tag/version of the backend image                      |
| `BACKEND_ENV_*`     | `ansible.backend.env.*` | Environment variables passed to the backend container |

Note: The domain for nginx configuration is passed per-host via the `effectiveDomain` field in `SSH_HOSTS` JSON, which allows environment-specific domains (e.g., `dev.example.com` for dev, `stag.example.com` for staging, `example.com` for prod).

### Backend Container Environment

Environment variables needed by your backend containerized application can be configured in `maestro.yaml` under `ansible.backend.env`:

```yaml
ansible:
  backend:
    env:
      DATABASE_URL: postgres://user:pass@host:5432/db
      API_KEY: your_api_key
```

Each key-value pair becomes an environment variable in the container. Note that `PORT` is automatically injected from `ansible.backend.port` and should not be set here.

### Application Secrets

Secrets listed in `secrets.required_vars` in `maestro.yaml` are automatically passed to the Ansible execution environment container. This allows playbooks to access application-specific secrets fetched from Bitwarden:

```yaml
secrets:
  provider: bws
  required_vars:
    - MY_API_KEY
    - DATABASE_PASSWORD
```

These secrets can be accessed in playbooks using:

```yaml
- name: Use secret in a task
  debug:
    msg: "{{ lookup('env', 'MY_API_KEY') }}"
```

This mechanism is useful for secrets that need to be injected into backend containers or used during provisioning but are specific to your application rather than core infrastructure.

## Required Secrets (from Bitwarden)

| Secret          | Purpose                            | Required Scopes                                                                                                                                          |
| --------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GHCR_TOKEN`    | GitHub Container Registry token    | GitHub personal access token (classic) with **`read:packages`** to pull images from ghcr.io. No other scopes are required for read-only pulls.            |
| `GHCR_USERNAME` | GitHub Container Registry username | Not an API token — the GitHub username that owns `GHCR_TOKEN`; no scopes apply.                                                                          |
| `VPS_SSH_KEY`   | SSH key for server access          | Not an API token — the SSH private key matching the public key registered in DigitalOcean; no scopes apply.                                              |

## Container Registry

Currently only GitHub Container Registry (ghcr.io) images are supported. The playbook authenticates using `GHCR_USERNAME` and `GHCR_TOKEN` secrets from Bitwarden.

## Components

### Roles and Playbooks

Roles:

- **roles/ufw**: Installs and configures UFW with role-based firewall rules:
  - Always: Deny inbound by default, allow SSH (22) from anywhere
  - Web role: Allow HTTPS (443) from Cloudflare IP ranges only
  - Backend role: Allow backend port from localhost only (cloudflared handles external access)
- **roles/groups**: Manages system groups. Uses per-host override if specified, otherwise falls back to global `MANAGED_GROUPS` env var.
- **roles/docker**: Installs and enables the Docker engine and Python bindings.
- **roles/nginx**: Installs and configures nginx for the web tier.
- **roles/backend_app**: Logs into GHCR, pulls the tagged backend image, and runs the backend container.

Playbooks:

- **security.yml**: Security hardening (UFW firewall + system groups). Runs on all servers automatically.
- **web.yml**: Provisions the web tier (nginx).
- **backend.yml**: Provisions backend hosts (Docker engine + backend_app).

### Inventory, Hosts, and Groups

The dynamic inventory (`inventory/hosts.py`) reads the SSH_HOSTS JSON and builds:

- `all` hosts with common vars (including the Cloudflare proxy SSH args).

- One group per tag listed on each host, so you can target plays to `backend`, `prod`, `web`, etc. Tags come from the stack name + server roles + any custom `tags` declared in `maestro.yaml` (see `pulumi.stacks.*.servers[].tags`).

### Multi-Stack Host Targeting

When multiple Pulumi stacks are defined (e.g., `staging` and `prod`), all hosts from all stacks are aggregated and passed to Ansible. Each server is tagged with its stack name and includes an `effectiveDomain` for environment-specific nginx configuration:

```json
{
  "hosts": [
    {
      "hostname": "ssh0.example.com",
      "tags": ["prod", "backend", "web"],
      "effectiveDomain": "example.com"
    },
    {
      "hostname": "ssh0.staging.example.com",
      "tags": ["staging", "backend", "web"],
      "effectiveDomain": "staging.example.com"
    },
    {
      "hostname": "ssh0.dev.example.com",
      "tags": ["dev", "backend", "web"],
      "effectiveDomain": "dev.example.com"
    }
  ]
}
```

The `effectiveDomain` determines the domain used in nginx server_name directives:

- **prod**: `example.com`, `www.example.com`
- **staging**: `staging.example.com`, `www.staging.example.com`
- **dev**: `dev.example.com`, `www.dev.example.com`

The built-in playbooks target servers by role (`backend`, `web`), applying identical configuration to all servers with that role regardless of which stack they belong to. This means a prod server and a staging server tagged with backend receive the same Docker and application setup, but each gets nginx configured for its environment-specific domain.

## Prerequisites

- Docker installed locally (Maestro builds and runs a container).
- The `ansible-builder` and `ansible-navigator` programs (auto-installed if missing).

## Idempotence

All playbooks are idempotent. Running them repeatedly will either make changes (if drift is detected) or do nothing (if the server already matches the declared state).
