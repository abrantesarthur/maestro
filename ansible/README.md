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
| `BACKEND_MIGRATE_COMMAND` | `ansible.backend.migrate.command` | JSON-encoded argv array of the pre-deploy migration command (`""` when no `migrate` block is configured) |
| `BACKEND_HEALTH_PATH`     | `ansible.backend.healthCheck.path` | HTTP readiness path polled during blue/green cutover (defaults to `/health`) |

Note: The domain for nginx configuration is passed per-host via the `effectiveDomain` field in `SSH_HOSTS` JSON, which allows environment-specific domains (e.g., `dev.example.com` for dev, `staging.example.com` for staging, `example.com` for prod).

### Database Connection (Postgres)

When the database tier is enabled (`pulumi.database.enabled`), the backend container receives its Postgres connection details from two paths that the `backend_app` role merges:

- **Global (`BACKEND_ENV_POSTGRES_*`).** `POSTGRES_USER` and `POSTGRES_DB` are stable Bitwarden values, identical across the whole deploy, so they ride the existing global `BACKEND_ENV_*` path. `POSTGRES_SSLMODE=require` (and `PGSSLMODE=require` for libpq) are injected as constants by `lib/runAnsible.ts` (`BACKEND_ENV_POSTGRES_SSLMODE`, `BACKEND_ENV_PGSSLMODE`).
- **Per-host (`postgres_host` / `postgres_port` / `postgres_password` hostvars).** `POSTGRES_HOST` (the private VPC endpoint), `POSTGRES_PORT` (the cluster's DO-assigned port), and `POSTGRES_PASSWORD` are derived from DigitalOcean **per stack** and differ between environments. Maestro stamps them onto each stack's backend host(s) in the `SSH_HOSTS` JSON (keys `postgresHost` / `postgresPort` / `postgresPassword`), and `inventory/hosts.py` exposes them as the `postgres_host` / `postgres_port` / `postgres_password` hostvars (mirroring `effective_domain`). The `backend_app` role merges them into the container env as `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_PASSWORD` only when `postgres_host` is defined.

Threading host, port, and password **per host** (rather than as global `BACKEND_ENV_*` values) keeps multi-stack deploys correct: Maestro merges hosts across stacks and runs Ansible once, so a global host/port/password would silently point every stack's backend at one stack's database. It also means the port is always whatever DO actually assigned — never a value you maintain by hand.

**Secret hygiene.** The `backend_app` tasks that read or build the backend environment (the `env | grep BACKEND_ENV_` task, the `set_fact` tasks that assemble `backend_env`, the per-host combine of `postgres_host`/`postgres_port`/`postgres_password`, and the `docker_container` run task) all set `no_log: true`, so the database password never appears in Ansible output.

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

### Zero-Downtime Deploys & Migrations

The `backend_app` role deploys the backend **blue/green** behind nginx so a routine image/tag change never drops traffic. The two containers run on fixed host ports bound to `127.0.0.1` (`backend-blue` on `BACKEND_PORT`, `backend-green` on `BACKEND_PORT + 1`); nginx is the only public edge. The new image starts as the **idle** color (whichever isn't running; a clean host defaults to blue) while the live color keeps serving. Once it passes the health check, the role repoints the nginx upstream, reloads, and stops the old container.

**`BACKEND_MIGRATE_COMMAND`.** `lib/runAnsible.ts` emits `JSON.stringify(ansible.backend.migrate.command)` (or `""` when no `migrate` block is set), passed via the static `pass:` list in `ansible-navigator.yaml`. When non-empty, the role runs it as a one-shot `docker run --rm` from the backend image **before** the new container starts, reusing `backend_env` (including merged `POSTGRES_*`); a non-zero exit aborts the deploy. The task is `no_log`-guarded since `backend_env` carries secrets (the argv itself does not).

**`BACKEND_HEALTH_PATH`.** Sourced from `ansible.backend.healthCheck.path` (default `/health`), also via the static `pass:` list. The role polls `http://127.0.0.1:<idle port><BACKEND_HEALTH_PATH>` for a `200` (fixed retry budget) before flipping nginx; if it never becomes healthy the deploy aborts and the live container keeps serving.

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
- **roles/nginx**: Installs and configures nginx. Fronts the web tier and, on backend hosts, also serves as the stable reverse-proxy edge whose upstream the blue/green cutover repoints.
- **roles/backend_app**: Logs into GHCR, pulls the tagged backend image, optionally runs the configured migration as a one-shot container, then deploys the backend container blue/green (start idle color → health-check → flip nginx upstream → stop old color).

Playbooks:

- **security.yml**: Security hardening (UFW firewall + system groups). Runs on all servers automatically.
- **web.yml**: Provisions the web tier (nginx).
- **backend.yml**: Provisions backend hosts (Docker engine + backend_app).

### Inventory, Hosts, and Groups

The dynamic inventory (`inventory/hosts.py`) reads the SSH_HOSTS JSON and builds:

- `all` hosts with common vars (including the Cloudflare proxy SSH args).

- One group per tag listed on each host, so you can target plays to `backend`, `prod`, `web`, etc. Tags come from the stack name + server roles + any custom `tags` declared in `maestro.yaml` (see `pulumi.stacks.*.servers[].tags`).

- Per-host `postgres_host` / `postgres_password` hostvars when the host belongs to a database-enabled stack (stamped from the `postgresHost` / `postgresPassword` keys in `SSH_HOSTS`). These carry the per-stack private endpoint and DigitalOcean-generated password into the `backend_app` role.

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
