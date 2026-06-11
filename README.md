# Maestro

Maestro is an infrastructure orchestration tool that combines Pulumi and Ansible to provision and configure cloud infrastructure.

## Prerequisites

Maestro runs on [Bun](https://bun.sh) and requires these commands on the host (validated at startup):

- `pulumi` — the Pulumi CLI. Maestro drives it in-process via the [Automation API](https://www.pulumi.com/docs/iac/automation-api/); state lives in Pulumi Cloud (authenticated with `PULUMI_ACCESS_TOKEN`, no interactive `pulumi login`).
- `bws` — Bitwarden Secrets Manager CLI, the source of all secrets.
- `cloudflared` — used to reach the servers through Cloudflare SSH tunnels.
- `docker` — used by the Ansible execution environment (the Pulumi path no longer uses Docker).

Before running Maestro, the base `domain` in `maestro.yaml` **must already exist as an active zone in the Cloudflare account** that your `CLOUDFLARE_API_TOKEN` belongs to. Maestro does not create the zone or verify ownership itself — it looks up the zone by name at runtime and fails with `Cloudflare zone for <domain> not found.` if it is missing.

Ownership is proven through Cloudflare's standard nameserver delegation: add the domain to your Cloudflare account and point your registrar's nameservers at the ones Cloudflare assigns. The zone becomes `active` only once that delegation is in place, and the scoped `CLOUDFLARE_API_TOKEN` is what authorizes Maestro to manage it.

The Cloudflare zone must also be **free of conflicting DNS records** before the first run. Maestro creates its own records (apex `A`, `www` `A`, and `api`/`ssh*` `CNAME`s) and does not adopt pre-existing ones. If a record of a different type already occupies one of those names — for example a manually-created `www` `CNAME` when Maestro wants to create a `www` `A` record — Cloudflare rejects the create with `A CNAME record with that host already exists` (error `81054`) and the run fails partway through. Remove (or import into Pulumi) any conflicting records on the apex, `www`, `api`, and `ssh*` names before provisioning.

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
   bun .
   ```

## Configuration

All configuration is managed through a single YAML file: `maestro.yaml`

See `example.maestro.yaml` for a fully documented template with all available options.

### Configuration Structure

```yaml
domain: example.com # Domain for DNS and nginx

pulumi:
  enabled: true # Enable/disable Pulumi provisioning
  command: up # Pulumi command: up, refresh, cancel, output, destroy (destroy skips Ansible)
  projectName: your-project-name # Pulumi project name
  cloudflareAccountId: "" # Your Cloudflare account ID
  sshPort: 22 # SSH port for tunnels
  database: # Optional: Managed Postgres tier (global defaults)
    enabled: false # Provision a DigitalOcean Managed Postgres cluster per stack
    version: "16" # Postgres major version: "15", "16", or "17"
    size: db-s-1vcpu-1gb # DigitalOcean DB node size
    nodeCount: 1 # Single node (region always co-locates with the stack's droplets)
  stacks: # Define one or more stacks (dev, staging, prod)
    prod:
      servers:
        - roles: [backend, web] # Server roles determine what gets provisioned
          # groups: [devops]   # Optional: override global ansible.groups
          # size: s-1vcpu-1gb  # Optional: DigitalOcean droplet size
          # region: nyc1       # Optional: DigitalOcean region
      # database:            # Optional: per-stack sizing override (override wins)
      #   size: db-s-2vcpu-4gb

ansible:
  enabled: true # Enable/disable all Ansible provisioning
  groups: [devops] # System groups (can be overridden per-server)
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
    migrate: # Optional: run a DB migration before each deploy (omit = no migration)
      command: ["npm", "run", "migrate"] # argv run inside the backend image
    healthCheck: # Optional: blue/green readiness probe
      path: /health # HTTP path polled for 200 before cutover (default: /health)

secrets:
  provider: bws # Secrets provider (bws = Bitwarden)
  projectId: "" # Optional BWS project ID
  requiredVars: [] # Secrets to validate and pass to Ansible
```

### Server Roles

Provisioning is **role-based**: Ansible playbooks run only on servers that have the corresponding role. Available roles:

| Role      | Ansible Playbook | Purpose                               |
| --------- | ---------------- | ------------------------------------- |
| `backend` | `backend.yml`    | Docker + backend container deployment |
| `web`     | `web.yml`        | nginx (static files or reverse proxy) |

**Security hardening** (`security.yml`) is applied automatically to all servers. This includes:

- UFW firewall rules (deny incoming by default, allow SSH, role-specific rules)
- System group management (configurable via `ansible.groups`)

If no server has a particular role, that playbook is skipped entirely.

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
          groups: [devops, backend-team] # Per-server group override
          size: s-2vcpu-4gb
        - roles: [web]
```

When you run `bun .`, Maestro provisions each defined stack sequentially, then aggregates all hosts for Ansible configuration. Each server is tagged with its stack name (e.g., `prod`, `staging`) in addition to its roles (e.g., `backend`, `web`), allowing Ansible playbooks to target servers by environment if needed. See [`ansible/README.md`](ansible/README.md) for details on host targeting.

### Domain Configuration

Maestro automatically creates environment-specific subdomains based on the stack name. The `domain` setting in `maestro.yaml` is the base domain, and each non-production stack gets its own subdomain prefix:

| Stack     | Subdomain Prefix | Effective Domain      |
| --------- | ---------------- | --------------------- |
| `dev`     | `dev.`           | `dev.example.com`     |
| `staging` | `staging.`       | `staging.example.com` |
| `prod`    | (none)           | `example.com`         |

This applies to all resources provisioned for each stack:

| Resource     | Dev Example            | Staging Example            | Prod Example       |
| ------------ | ---------------------- | -------------------------- | ------------------ |
| SSH Tunnel   | `ssh0.dev.example.com` | `ssh0.staging.example.com` | `ssh0.example.com` |
| API Endpoint | `api.dev.example.com`  | `api.staging.example.com`  | `api.example.com`  |
| Web Domain   | `dev.example.com`      | `staging.example.com`      | `example.com`      |
| WWW Domain   | `www.dev.example.com`  | `www.staging.example.com`  | `www.example.com`  |

DNS records (both A records for web servers and CNAME records for tunnels) are created under the base domain's Cloudflare zone. SSL certificates are issued for each environment's effective domain.

### Database (Managed Postgres)

When `pulumi.database.enabled` is `true`, Maestro provisions a **DigitalOcean Managed Postgres** cluster as a dedicated database tier. The guiding principle is _the backend is cattle; the database is the crown jewels_ — the database lives in its own managed failure domain, separate from the disposable backend droplet.

**Per-environment isolation.** The database is stack-aware like the rest of the stack: each enabled stack (`dev` / `staging` / `prod`) provisions its **own** cluster, app database, and app user. A `dev` deploy never touches the `prod` database.

**Private VPC endpoint + TLS.** Each stack gets a dedicated DigitalOcean VPC that **both** the backend droplet and the database cluster join. The backend connects over the database's **private** VPC endpoint (`cluster.privateHost`), so database traffic never traverses the public internet. TLS is still required: the connection uses `sslmode=require` (and `PGSSLMODE=require` for libpq clients).

**Least-privilege user + dedicated database.** Pulumi creates a dedicated `DatabaseUser` (named from `POSTGRES_USER`) and `DatabaseDb` (named from `POSTGRES_DB`). The application never uses the cluster admin (`doadmin`). DigitalOcean-managed Postgres users are non-superuser by default; tightening per-database `GRANT`s further is a documented follow-up.

**DatabaseFirewall (trusted sources).** A `DatabaseFirewall` restricts access to the backend droplet by the per-stack **tag** (the stack name, applied to every droplet in the stack) rather than the droplet ID, so it survives the disposable droplet being rebuilt with a new ID. There is no `0.0.0.0/0` rule; the public endpoint is locked down.

**Lifecycle safeguards (`retainOnDelete` + `protect`).** The cluster carries both `retainOnDelete: true` and `protect: true`; the app database, app user, and the VPC carry `retainOnDelete`. This means a `pulumi destroy` of the disposable backend **succeeds while leaving the cloud database (and its data) intact**, and accidental targeted deletes are blocked. Intentional teardown is therefore deliberate: it requires unprotecting and removing the resource from Pulumi state (a manual-cleanup runbook step), which is by design for the crown jewels.

> **One-time droplet replacement.** VPC membership is immutable on a DigitalOcean droplet, so enabling the database (and the per-stack VPC) replaces the existing backend droplet once on first apply. The backend is cattle, so this is acceptable — Ansible re-converges the replacement.

**Durability.** DigitalOcean's built-in **daily backups** plus **point-in-time recovery (PITR)** cover durability today. PITR (the decisive feature) recovers to any point within the provider's retention window, protecting against operator/application mistakes (a bad migration, an accidental `DELETE`), not just infrastructure loss. Choose your retention window deliberately.

**Connection wiring (one source of truth).** Connection details flow through the existing plumbing, with a hybrid origin:

- `POSTGRES_USER` and `POSTGRES_DB` **originate in Bitwarden** (stable values you choose). Pulumi reads them to create the dedicated user + database, and the backend reads the same values — no drift.
- `POSTGRES_HOST` (the private endpoint), `POSTGRES_PORT` (the cluster's assigned port), and `POSTGRES_PASSWORD` are **derived from DigitalOcean** and exported as Pulumi **stack outputs** (the password as a Pulumi secret). Maestro reads them from the typed Pulumi stack outputs (via the Automation API) and threads them **per stack** onto that stack's backend host(s), so multi-stack deploys never cross-wire one stack's backend to another stack's database — and the port is always whatever DO actually assigned, never a value you keep in sync by hand.

The backend container ends up with `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD`, and `POSTGRES_SSLMODE=require`.

> **Note:** `POSTGRES_USER`/`POSTGRES_DB` originate in Bitwarden but are also injected into the container environment (as `BACKEND_ENV_POSTGRES_USER`/`BACKEND_ENV_POSTGRES_DB`, see `buildAnsibleEnv`), so the backend can read them from either source — keep the two in sync. `POSTGRES_HOST`/`POSTGRES_PORT`/`POSTGRES_PASSWORD` are DigitalOcean-derived and live only in the environment.

### Zero-Downtime Backend Deploys & Migrations

Backend deploys are **zero-downtime** by default. nginx stays up as a stable
reverse proxy in front of the backend and Maestro swaps containers blue/green,
so traffic is always being served.

**Blue/green cutover.** The backend runs as one of two containers: `backend-blue`
(on `ansible.backend.port`) and `backend-green` (on `ansible.backend.port + 1`),
both bound to `127.0.0.1`. On each deploy Maestro starts the new image on the
idle port while the live one keeps serving, waits for it to pass the health
check, then points nginx at the new port and reloads (`nginx -s reload` drains
in-flight requests). Only then does it stop the old container. If the new
container never gets healthy, the old one keeps serving and the deploy fails —
no half-deployed state.

**Health check (`ansible.backend.healthCheck.path`).** Optional. The HTTP path
polled for a `200` on the new container before cutover. Defaults to `/health`.
The retry/timeout budget is fixed.

**Migrations (`ansible.backend.migrate.command`).** Optional. An argv array
(e.g. `["npm", "run", "migrate"]`, not a shell line) run once inside the backend
image **before the new container starts**, against the live database, with the
same environment as the app (including the per-stack `POSTGRES_*` values). A
non-zero exit aborts the deploy before the app container is touched, so a bad
migration never leaves a half-deployed stack. Omit the block to skip migrations.
The DB password and other secrets stay on the `no_log`-guarded path and are
never printed.

### Required Environment Variable

| Variable           | Purpose                                                                | Required Scopes                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `BWS_ACCESS_TOKEN` | Bitwarden Secrets Manager token required for retrieving other secrets. | A Bitwarden Secrets Manager machine-account access token with **read** access to the project(s) holding the secrets listed below. |

### CLI Options

| Flag        | Purpose                                 |
| ----------- | --------------------------------------- |
| `--dry-run` | Preview configuration without executing |

### Secrets

Secrets are stored in Bitwarden Secrets Manager and fetched at runtime. The following secrets are required:

| Secret                 | Purpose                                                                                                                                          | Required Scopes                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VPS_SSH_KEY`          | SSH private key for accessing DigitalOcean servers. The corresponding public key must be manually added to your DigitalOcean account beforehand. | Not an API token — the SSH private key matching the public key registered in DigitalOcean; no scopes apply.                                                                                                       |
| `GHCR_TOKEN`           | GitHub Container Registry token                                                                                                                  | GitHub personal access token (classic) with **`read:packages`** to pull images from ghcr.io. No other scopes are required for read-only pulls.                                                                    |
| `GHCR_USERNAME`        | GitHub Container Registry username                                                                                                               | Not an API token — the GitHub username that owns `GHCR_TOKEN`; no scopes apply.                                                                                                                                   |
| `PULUMI_ACCESS_TOKEN`  | Pulumi Cloud access token                                                                                                                        | A standard Pulumi Cloud personal access token (no granular scopes); needs access to the organization/stacks being deployed.                                                                                       |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token                                                                                                                             | Zone → **Zone:Read**, **Zone Settings:Edit**, **DNS:Edit**; **User → SSL and Certificates:Edit** (Origin CA certs — this is a _user-level_ permission, not zone-level; without it Origin CA cert creation fails with `401 / code 1016`); Account → **Cloudflare Tunnel:Edit** (Zero Trust tunnels). Scoped to the account/zone being managed. |
| `DIGITALOCEAN_ACCESS_TOKEN`   | DigitalOcean API token                                                                                                                           | `droplet:create`, `droplet:read`, `droplet:update`, `droplet:delete`; `ssh_key:read`; `tag:create`, `tag:read`, `tag:delete`. A full read+write token also works. When the database tier is enabled, also needs `database:create`, `database:read`, `database:update`, `database:delete` and VPC read/write. |

When `pulumi.database.enabled` is `true`, the following additional secrets are required (the values are stable identifiers you choose):

| Secret          | Purpose                                                                 | Required Scopes                                                                                                   |
| --------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_USER` | Dedicated least-privilege app database user name (created by Pulumi).   | Not an API token — a stable identifier you choose. Read by both Pulumi (to create the user) and the backend.     |
| `POSTGRES_DB`   | Application database name (created by Pulumi).                           | Not an API token — a stable identifier you choose. Read by both Pulumi (to create the database) and the backend. |

`POSTGRES_HOST` (the private endpoint), `POSTGRES_PORT` (the DO-assigned cluster port), and `POSTGRES_PASSWORD` are **derived from DigitalOcean**, surfaced as Pulumi stack outputs, and injected into the backend by Maestro. They are **not** Bitwarden secrets and must never be committed.

> **Note:** `POSTGRES_USER`/`POSTGRES_DB` are also injected into the backend's environment (see the note in [Database (Managed Postgres)](#database-managed-postgres)), so they live in two places at runtime — keep them in sync.

You can specify additional required secrets in your `maestro.yaml` under `secrets.required_vars`. These secrets are validated at startup and automatically passed to the Ansible execution environment, where they can be accessed in playbooks via `lookup('env', 'VAR_NAME')`.

## Components

- `pulumi/` — the Pulumi program (run in-process via the Automation API) provisioning Cloudflare DNS, DigitalOcean VPS, and SSH tunneling into the servers.
- `ansible/` — Ansible execution environment, inventories, and playbooks that configure the servers.

## Workflow

`index.ts` (run via `bun .`) orchestrates the entire provisioning process:

1. Loads configuration from `maestro.yaml`
2. Fetches secrets from Bitwarden Secrets Manager
3. Runs Pulumi for each defined stack (dev, staging, prod) to provision cloud infrastructure (DNS, servers, tunnels)
4. Aggregates hosts from all stacks
5. Waits for servers to accept connection via SSH tunnels
6. Runs Ansible to tunnel into and configure the servers (nginx, Docker, backend app)

## Future Improvements

- **Independent logical backup stream to DigitalOcean Spaces** (deferred): in addition to DigitalOcean's built-in daily backups + PITR, run a self-owned `pg_dump`-style logical backup into a DO Spaces bucket (a _different_ service from the database), on a schedule, with bucket lifecycle/retention rules and periodic tested restore drills. This is defense-in-depth against account- or provider-level problems with the managed backups and gives portable, provider-independent copies. The Spaces bucket, the backup cron, and the restore drills are intentionally **out of scope** of the current core database tier; built-in daily backups + PITR cover durability for now.

- **Per-database GRANT tightening**: the app user is non-superuser and never `doadmin`, but scoping its privileges to only what it needs within its own database (beyond DigitalOcean's defaults) is a follow-up.

- **style**: use the Ansible SDK/packages instead of shelling out to the CLI (Pulumi already runs in-process via the Automation API; the shell scripts have been replaced by TypeScript).

- **Multi-cloud provider support**: Currently, Maestro only supports DigitalOcean as a cloud provider. Future versions may add support for AWS, GCP, Azure, and other providers.

- **Automated SSH key provisioning**: SSH keys must be manually added to your DigitalOcean account before running Maestro. A future improvement would automate the creation and registration of SSH keys during the provisioning process.

- **Configuration schema validation**: Add typed schema validation for `maestro.yaml` to catch configuration errors early and provide better error messages.

- **Multiple server supporrt**: Right now we can only specify one server per environment.

- **Security considerations**:
  -- Never write the ssh key to the host filesystem
  -- Run the whole maestro in docker containers
  -- Hide servers' IP address from pulumi output.
