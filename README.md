# Maestro

Maestro deploys a web application to production from a single YAML file. Point it at a `maestro.yaml` describing your domain, servers, and app containers, and it provisions the cloud infrastructure (DNS, droplets, tunnels, managed Postgres) and configures the servers (nginx, Docker, your backend) — end to end, in one command.

Under the hood it combines [Pulumi](https://www.pulumi.com) for cloud resources and [Ansible](https://www.ansible.com) for server configuration, so you don't have to wire the two together yourself.

One `maestro.yaml` gets you:

- **DNS and TLS** — Cloudflare DNS records, zone TLS settings, and Origin CA certificates for your domain.
- **Servers** — DigitalOcean droplets per environment (`dev` / `staging` / `prod`), each environment fully isolated on its own subdomain.
- **Private SSH access** — servers are reached through Cloudflare Zero Trust tunnels (`ssh0.example.com`), never by raw IP.
- **Web tier** — nginx serving your static site or reverse-proxying a web container.
- **Backend tier** — your app's Docker image deployed blue/green with health checks and optional pre-deploy database migrations, so deploys are zero-downtime.
- **Database tier (optional)** — a DigitalOcean Managed Postgres cluster per environment, reachable only over a private VPC, with a least-privilege app user.

Maestro is a versioned npm package with a CLI. Your application's repository owns its `maestro.yaml` (next to the app code the file describes) and runs maestro against it — `bunx @arthuroabrantes/maestro`, or pinned as a `devDependency`. Upgrading maestro is a version bump in your repo; nothing about your app lives in maestro's repository.

---

## Using Maestro

### 1. Install the host requirements

Maestro runs on [Bun](https://bun.sh) and orchestrates a few host tools (all validated at startup):

| Tool          | Used for                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker`      | Running the containerized Ansible execution environment and extracting image-sourced website assets.                                               |
| `pulumi`      | The Pulumi CLI. Maestro drives it in-process via the Automation API; you never run it yourself. State lives in Pulumi Cloud (no `pulumi login` needed — `PULUMI_ACCESS_TOKEN` authenticates). |
| `bws`         | Bitwarden Secrets Manager CLI — the source of all secrets.                                                                                         |
| `cloudflared` | Reaching the servers through Cloudflare SSH tunnels.                                                                                               |
| `pip`/Python  | Maestro auto-installs `ansible-navigator` (and `ansible-builder`) via `pip install --user` if they're missing from `PATH`.                          |

### 2. Set up your accounts (one time)

**Cloudflare.** The base `domain` in `maestro.yaml` must already exist as an **active zone** in your Cloudflare account: add the domain to Cloudflare and point your registrar's nameservers at the ones Cloudflare assigns. Maestro looks the zone up by name at runtime and fails with `Cloudflare zone for <domain> not found.` if it's missing — it never creates the zone or verifies ownership itself.

The zone must also be **free of conflicting DNS records**. Maestro creates its own records (apex `A`, `www` `A`, and `api`/`ssh*` `CNAME`s) and does not adopt pre-existing ones; if a record of a different type already occupies one of those names, Cloudflare rejects the create with `A CNAME record with that host already exists` (error `81054`) and the run fails partway through. Remove (or import into Pulumi) any conflicting records on the apex, `www`, `api`, and `ssh*` names first.

**DigitalOcean.** Add the SSH **public** key you'll use to your DigitalOcean account. Maestro provisions droplets with it but does not register the key for you.

**Bitwarden Secrets Manager.** Create the secrets below in a BWS project readable by your machine-account token. Maestro fetches them at startup and injects them into its own environment — they are never written to your repo.

| Secret                      | Purpose                                                                                                                                            | Required scopes                                                                                                                                                                                                                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VPS_SSH_KEY`               | SSH **private** key matching the public key registered in DigitalOcean.                                                                            | Not an API token; no scopes apply.                                                                                                                                                                                                                                                                                |
| `GHCR_TOKEN`                | GitHub Container Registry token the servers use to pull your app images.                                                                           | GitHub personal access token (classic) with **`read:packages`**. Nothing else is needed for read-only pulls.                                                                                                                                                                                                      |
| `GHCR_USERNAME`             | GitHub username that owns `GHCR_TOKEN`.                                                                                                            | Not an API token; no scopes apply.                                                                                                                                                                                                                                                                                |
| `PULUMI_ACCESS_TOKEN`       | Pulumi Cloud access token (where infrastructure state lives).                                                                                      | Standard personal access token; needs access to the organization/stacks being deployed.                                                                                                                                                                                                                           |
| `CLOUDFLARE_API_TOKEN`      | Cloudflare API token.                                                                                                                              | Zone → **Zone:Read**, **Zone Settings:Edit**, **DNS:Edit**; User → **SSL and Certificates:Edit** (Origin CA certs — a _user-level_ permission; without it cert creation fails with `401 / code 1016`); Account → **Cloudflare Tunnel:Edit**. Scoped to the account/zone being managed.                              |
| `DIGITALOCEAN_ACCESS_TOKEN` | DigitalOcean API token.                                                                                                                            | `droplet:create/read/update/delete`; `ssh_key:read`; `tag:create/read/delete`. A full read+write token also works. With the database tier enabled, additionally `database:create/read/update/delete` and VPC read/write.                                                                                            |

With the database tier enabled (`pulumi.database.enabled: true`), two more secrets are required — stable identifiers you choose, read by both Pulumi (to create the user/database) and your backend:

| Secret          | Purpose                                                              |
| --------------- | -------------------------------------------------------------------- |
| `POSTGRES_USER` | Dedicated least-privilege app database user name (created by Pulumi). |
| `POSTGRES_DB`   | Application database name (created by Pulumi).                        |

> `POSTGRES_HOST`, `POSTGRES_PORT`, and `POSTGRES_PASSWORD` are **not** Bitwarden secrets — they are derived from DigitalOcean, surfaced as Pulumi stack outputs, and injected into your backend automatically. Never commit them.

### 3. Write your `maestro.yaml`

In your application's repository, create a `maestro.yaml`. A minimal full-stack example:

```yaml
domain: example.com

pulumi:
  enabled: true
  command: up
  projectName: example
  cloudflareAccountId: "<your-cloudflare-account-id>"
  sshPort: 22
  stacks:
    prod:
      servers:
        - roles: [backend, web]

ansible:
  enabled: true
  web:
    static:
      source: local
      dir: ./website # relative paths resolve against this file's directory
      dist: dist
  backend:
    image: ghcr.io/your-org/your-app
    tag: latest
    port: 3000

secrets:
  provider: bws
```

See [`example.maestro.yaml`](example.maestro.yaml) for a fully documented template with every option, and the [Configuration reference](#configuration-reference) below.

### 4. Run it

```bash
export BWS_ACCESS_TOKEN="your_bws_machine_account_token"

bunx @arthuroabrantes/maestro --dry-run   # validate the config and preview settings
bunx @arthuroabrantes/maestro             # provision everything
```

`BWS_ACCESS_TOKEN` is the only environment variable you set by hand — a Bitwarden machine-account token with **read** access to the project holding the secrets above. Everything else flows from Bitwarden.

Alternatively, pin maestro as a `devDependency` and run it via `bun run maestro`. A thin CI workflow that runs maestro on merge works the same way — the CLI is non-interactive.

### CLI reference

```
maestro [--config <path>] [--dry-run]
```

| Flag              | Purpose                                                                              |
| ----------------- | -------------------------------------------------------------------------------------- |
| `--config <path>` | Path to `maestro.yaml`. Default: `./maestro.yaml` in the current working directory.    |
| `--dry-run`       | Validate the config and display the resolved settings without provisioning anything.   |
| `--help`          | Show usage.                                                                             |

Relative paths inside the config (e.g. `ansible.web.static.dir: ./website`) always resolve against the **config file's directory**, not the directory maestro is invoked from — so the same config works locally, in CI, and via `--config` from anywhere.

---

## Configuration reference

All configuration lives in one YAML file. The full structure:

```yaml
domain: example.com # Base domain for DNS and nginx

pulumi:
  enabled: true # Enable/disable cloud provisioning
  command: up # up | refresh | cancel | output | destroy (destroy skips Ansible)
  projectName: your-project-name # Pulumi project name
  cloudflareAccountId: "" # Your Cloudflare account ID
  sshPort: 22 # SSH port for tunnels
  database: # Optional: Managed Postgres tier (global defaults)
    enabled: false # Provision a DigitalOcean Managed Postgres cluster per stack
    version: "16" # Postgres major version: "15", "16", or "17"
    size: db-s-1vcpu-1gb # DigitalOcean DB node size
    nodeCount: 1 # Node count (region always co-locates with the stack's droplets)
  stacks: # One or more environments: dev, staging, prod
    prod:
      servers:
        - roles: [backend, web] # Roles determine what gets provisioned/configured
          # groups: [devops]    # Optional: override global ansible.groups
          # size: s-1vcpu-1gb   # Optional: DigitalOcean droplet size
          # region: nyc1        # Optional: DigitalOcean region
      # database:               # Optional: per-stack sizing override (override wins)
      #   size: db-s-2vcpu-4gb

ansible:
  enabled: true # Enable/disable all server configuration
  groups: [devops] # System groups (can be overridden per-server)
  web: # Required if any server has the "web" role
    static: # ...serve static files with nginx, or:
      source: local # local | image
      dir: ./website # Website source (relative to this config file)
      build: bun run build # Optional build command
      dist: dist # Subdirectory with built assets
    # docker:               # ...or reverse-proxy a web container
    #   image: ghcr.io/org/web
    #   tag: latest
    #   port: 3000
  backend: # Required if any server has the "backend" role
    image: ghcr.io/org/app # Container image
    tag: latest # Image tag
    port: 3000 # Backend port
    env: # Environment variables for the container
      SOME_VAR: value
    migrate: # Optional: DB migration before each deploy (omit = none)
      command: ["npm", "run", "migrate"] # argv run inside the backend image
    healthCheck: # Optional: blue/green readiness probe
      path: /health # Polled for 200 before cutover (default: /health)

secrets:
  provider: bws # Secrets provider (bws = Bitwarden Secrets Manager)
  projectId: "" # Optional BWS project ID to scope the fetch
  requiredVars: [] # Extra secrets to validate and forward to Ansible
```

### Server roles

Provisioning is **role-based**: each Ansible playbook runs only on servers holding the corresponding role, and is skipped entirely when no server has it.

| Role      | Playbook      | Purpose                               |
| --------- | ------------- | ------------------------------------- |
| `backend` | `backend.yml` | Docker + backend container deployment |
| `web`     | `web.yml`     | nginx (static files or reverse proxy) |

**Security hardening** (`security.yml`) always runs on all servers: UFW firewall rules (deny incoming by default, allow SSH, role-specific openings) and system group management (`ansible.groups`).

### Environments (stacks)

Each stack under `pulumi.stacks` is an isolated environment with its own Pulumi state, servers, and (optionally) database. Maestro provisions every defined stack sequentially, then aggregates all hosts for the Ansible phase. Servers are tagged with both their stack name and their roles, so playbooks can target by environment. See [`ansible/README.md`](ansible/README.md) for host-targeting details.

Non-production stacks live on prefixed subdomains of the base `domain`, applied to every resource:

| Resource     | `dev`                  | `staging`                  | `prod`             |
| ------------ | ---------------------- | -------------------------- | ------------------ |
| Web domain   | `dev.example.com`      | `staging.example.com`      | `example.com`      |
| WWW domain   | `www.dev.example.com`  | `www.staging.example.com`  | `www.example.com`  |
| API endpoint | `api.dev.example.com`  | `api.staging.example.com`  | `api.example.com`  |
| SSH tunnel   | `ssh0.dev.example.com` | `ssh0.staging.example.com` | `ssh0.example.com` |

DNS records are created under the base domain's Cloudflare zone; TLS certificates are issued per effective domain.

### Database (Managed Postgres)

When `pulumi.database.enabled` is `true`, Maestro provisions a **DigitalOcean Managed Postgres** cluster as a dedicated database tier. The guiding principle: _the backend is cattle; the database is the crown jewels_ — the database lives in its own managed failure domain, separate from the disposable backend droplet.

- **Per-environment isolation.** Each enabled stack provisions its **own** cluster, app database, and app user. A `dev` deploy never touches the `prod` database.
- **Private VPC endpoint + TLS.** Each stack gets a dedicated VPC joined by both the backend droplet and the cluster. The backend connects over the database's **private** endpoint — traffic never traverses the public internet — and still uses `sslmode=require` (plus `PGSSLMODE=require` for libpq clients).
- **Least privilege.** Pulumi creates a dedicated database user (from `POSTGRES_USER`) and database (from `POSTGRES_DB`). The application never uses the cluster admin (`doadmin`).
- **Firewall by tag.** A `DatabaseFirewall` trusts the backend droplets by their per-stack **tag**, not droplet ID, so it survives droplet rebuilds. There is no `0.0.0.0/0` rule.
- **Lifecycle safeguards.** The cluster carries `retainOnDelete: true` **and** `protect: true`; the app database, user, and VPC carry `retainOnDelete`. A `pulumi destroy` of the disposable backend succeeds while leaving the cloud database and its data intact; intentional teardown requires deliberately unprotecting and removing the resource from state.
- **Durability.** DigitalOcean's built-in daily backups plus point-in-time recovery (PITR) cover durability — PITR protects against operator/application mistakes (a bad migration, an accidental `DELETE`), not just infrastructure loss.

> **One-time droplet replacement.** VPC membership is immutable on a DigitalOcean droplet, so enabling the database replaces the existing backend droplet once on first apply. The backend is cattle; Ansible re-converges the replacement.

**Connection wiring.** `POSTGRES_USER`/`POSTGRES_DB` originate in Bitwarden (stable values you choose); `POSTGRES_HOST`, `POSTGRES_PORT`, and `POSTGRES_PASSWORD` are derived from DigitalOcean and read from typed Pulumi stack outputs (the password as a Pulumi secret). Maestro threads the per-stack values onto that stack's backend host(s), so multi-stack deploys never cross-wire one stack's backend to another stack's database. The backend container ends up with `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD`, and `POSTGRES_SSLMODE=require` in its environment.

### Zero-downtime backend deploys & migrations

Backend deploys are **zero-downtime** by default: nginx stays up as a stable reverse proxy and Maestro swaps containers blue/green underneath it.

The backend runs as one of two containers — `backend-blue` (on `ansible.backend.port`) and `backend-green` (on `port + 1`) — both bound to `127.0.0.1`. Each deploy starts the new image on the idle port while the live one keeps serving, waits for it to pass the health check, points nginx at the new port, and reloads (`nginx -s reload` drains in-flight requests). Only then is the old container stopped. If the new container never gets healthy, the old one keeps serving and the deploy fails — there is no half-deployed state.

- **`ansible.backend.healthCheck.path`** (optional): the HTTP path polled for a `200` on the new container before cutover. Defaults to `/health`. The retry/timeout budget is fixed.
- **`ansible.backend.migrate.command`** (optional): an argv array (e.g. `["npm", "run", "migrate"]`, not a shell line) run once inside the backend image **before the new container starts**, against the live database, with the same environment as the app (including the per-stack `POSTGRES_*` values). A non-zero exit aborts the deploy before the app container is touched. Omit the block to skip migrations. The DB password and other secrets stay on a `no_log`-guarded path and are never printed.

### Forwarding extra secrets

List additional Bitwarden secret names under `secrets.requiredVars`. They are validated at startup and forwarded into the Ansible execution environment, where playbooks read them via `lookup('env', 'VAR_NAME')`. Backend-container variables go under `ansible.backend.env` instead.

---

## How it works

### The pipeline

`index.ts` (the `maestro` bin) orchestrates one linear pipeline:

1. **Parse CLI flags** and resolve the config path against the current working directory.
2. **Validate `maestro.yaml`** against a typed schema (io-ts codecs plus semantic checks: role/web consistency, region mixing, database preconditions, path existence). `--dry-run` stops here and prints the resolved settings.
3. **Fetch secrets** from Bitwarden Secrets Manager (`bws secret list`) and inject them into the process environment; required secrets are asserted up front so failures happen before any cloud call.
4. **Write the SSH key** to a `0600` temp file (stable path — it's interpolated into Pulumi resources, so a per-run random path would diff them on every deploy).
5. **Run Pulumi per stack** — in-process via the [Automation API](https://www.pulumi.com/docs/iac/automation-api/), no Pulumi Docker image and no shelling out to `pulumi up`. The TypeScript program under `pulumi/` provisions Cloudflare DNS records, zone TLS settings, Origin CA certificates, Zero Trust SSH tunnels, the DigitalOcean droplets, and (optionally) the VPC + Managed Postgres tier. State lives in Pulumi Cloud.
6. **Aggregate hosts** from all stacks' typed outputs — hostnames, roles, stack tags, and per-stack database endpoints.
7. **Wait for tunnel readiness** — polls SSH-over-cloudflared until every host accepts connections.
8. **Run Ansible** against the hosts: `web.yml`, `backend.yml`, then `security.yml` last (it may tighten firewall rules that would block the earlier plays).

### The Ansible execution environment

Playbooks don't run on your host's Ansible — they run inside a containerized **execution environment** (EE) driven by `ansible-navigator`. Maestro builds the image locally with `ansible-builder` from the definition that ships with the package (`ansible/execution_environment/`). The built image is tagged with a content hash of the definition, so subsequent runs reuse it and skip the build entirely until the definition changes (e.g. on a maestro upgrade).

The image is **app-agnostic** — everything app-specific reaches the container at runtime, never at image build time:

- **Website assets** are staged into a temp directory (built from `ansible.web.static.dir`, or extracted from a container image) and volume-mounted read-only at `/opt/website`.
- **The SSH key** temp file is volume-mounted read-only.
- **Configuration and secrets** are forwarded as environment variables (`--penv`), including the host list (`SSH_HOSTS`), which a dynamic inventory script (`ansible/inventory/hosts.py`) turns into Ansible hosts grouped by role and stack.

This is what lets one EE image serve every consuming application.

Maestro's installation directory is treated as read-only at runtime: website staging, the EE build context, navigator logs, and secret files all live in the system temp directory (with a `maestro_` prefix, `0600` secret files, and cleanup on exit plus a stale sweep at startup).

### Package layout

| Path           | What it is                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| `index.ts`     | CLI entry point (`bin`), the pipeline above.                                                          |
| `lib/`         | Orchestration: config loading/validation, secrets, Pulumi driver, Ansible driver, tunnel readiness.   |
| `pulumi/`      | The Pulumi program (imported in-process): DNS, certificates, tunnels, droplets, VPC, managed Postgres. |
| `ansible/`     | Execution environment definition, dynamic inventory, and playbooks/roles for nginx, Docker, UFW, blue/green deploys. |

### Releasing

Releasing a maestro version is a `version` bump in `package.json` plus `npm publish` — the EE image definition, playbooks, and the Pulumi program all travel inside the package, so there is no second artifact to keep in sync.

## Developing maestro

This repository is itself just another consuming app whose `maestro.yaml` happens to sit next to the tool:

```bash
bun index.ts --dry-run   # or: bun run maestro:dry-run
bun index.ts             # full run against the repo's own maestro.yaml
bun test                 # unit tests
```

## Roadmap

- **Independent logical backup stream to DigitalOcean Spaces**: in addition to DO's daily backups + PITR, a self-owned `pg_dump`-style backup into a Spaces bucket on a schedule, with lifecycle/retention rules and tested restore drills — defense-in-depth against account- or provider-level problems, and portable copies.
- **Per-database GRANT tightening**: the app user is non-superuser and never `doadmin`, but scoping its privileges to only what it needs within its own database (beyond DigitalOcean's defaults) is a follow-up.
- **Multi-cloud provider support**: DigitalOcean is currently the only provider; AWS/GCP/Azure may follow.
- **Automated SSH key provisioning**: today the public key must be added to DigitalOcean manually before the first run.
- **Multiple web/backend servers per environment** with load balancing; today each role maps to a single server per stack.
- **Ansible via SDK**: drive Ansible through a library interface instead of shelling out to `ansible-navigator` (Pulumi already runs in-process).
- **Security hardening follow-ups**: avoid materializing the SSH key on the host filesystem, and hide server IP addresses from Pulumi output.
