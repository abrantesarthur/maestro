# Postgres Database Hosting

Status: **Proposed** — problem framing and chosen strategy only. No implementation plan here.

## Context

Maestro provisions a single DigitalOcean droplet running the backend container
(`ghcr.io/instrutoria/backend`). The backend boots by loading runtime
configuration and then connecting to a PostgreSQL database. During the first
end-to-end deploy the backend crash-looped because it could not find its
database connection details: the Bitwarden project holds `POSTGRES_PASSWORD`,
but `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, and `POSTGRES_DB` do not
exist anywhere — and, more fundamentally, **no database has been provisioned at
all**. The current deployment stands up only a backend tier; there is no
database tier.

So this is not a missing-env-var bug. It is an unmade architectural decision:
**where does production data live, and how do we guarantee we never lose it?**

### What we care about (in priority order)

1. **Durability of production data above everything else.** Losing the database
   — or losing data within it — is treated as an unacceptable, potentially
   existential outcome.
2. **The backend tier is disposable.** The droplet running the backend
   container can crash, be rebuilt, or be replaced with no lasting consequence.
   Its failure domain must be kept *separate* from the database's.
3. **Staying on DigitalOcean is acceptable**, provided the durability story is
   solid. We are not seeking multi-cloud; we want a dependable strategy within
   the DO ecosystem.
4. **It must integrate cleanly with the existing deployment workflow** — a
   single YAML configuration file (`maestro.yaml`) that feeds Pulumi
   (infrastructure) and Ansible (server/container configuration). Whatever we
   choose should be expressible in that model, not bolted on as a manual,
   out-of-band step.

### The core principle

> The backend is cattle; the database is the crown jewels.

The backend and the database must **not** share a failure domain. If a single
event (a droplet disappearing) can take out both the application and its data,
the design has already failed our top requirement.

## Considered options (summary)

These were evaluated in discussion; only the chosen one is expanded below. They
are recorded so the reasoning is not lost.

1. **DigitalOcean Managed Postgres** — DO operates the cluster; we get a
   connection string. Built-in daily backups, point-in-time recovery (PITR),
   optional standby node with automatic failover, encryption at rest.
2. **Self-hosted Postgres container on the *same* droplet** — cheapest ($0
   extra), but **rejected**: it couples the database to the backend's failure
   domain, directly violating requirement #2. If the droplet disappears, so
   does the data.
3. **Self-hosted Postgres on a *separate* droplet + Block Storage volume +
   self-managed backups** — decouples failure domains and is cheaper, but moves
   all the durability-critical work (patching, failover, WAL archiving, backup
   verification) onto us. The realistic failure mode is a backup job that
   silently breaks and is discovered only when a restore is needed.

## Chosen strategy

**DigitalOcean Managed Postgres (single node to begin) + an independent,
self-owned logical backup stream to DigitalOcean Spaces + periodic tested
restores.**

Rationale:

- **Operational failures dominate data-loss risk**, not exotic hardware events.
  Managed Postgres removes the entire category of "we forgot to maintain it"
  (patching, disk management, failover wiring) that causes most real-world
  incidents.
- **PITR is the decisive feature.** Built-in PITR lets us recover to any point
  in time, which protects against application/operator mistakes (a bad
  migration, an accidental `DELETE`), not just infrastructure loss. A
  nightly-snapshot-only approach cannot do this.
- **Defense in depth via a second, independent backup.** Even with the managed
  backups, we will run our own `pg_dump`-style logical backups into DO Spaces
  (object storage, a *different* service from the database). This guards against
  account- or provider-level problems with the managed backup system, and gives
  us portable, provider-independent copies — our escape hatch for migration or
  catastrophe.
- **Right-sized to today.** A single-node managed instance is sufficient for the
  current single-droplet, single-backend deployment. A standby node (HA) can be
  added later when *uptime* — not just *durability* — becomes a requirement. We
  are optimizing for "never lose data," which single-node + backups + PITR
  already satisfies; multi-node HA additionally optimizes for "never have
  downtime," which is not yet a stated need.
- **Cost is the right place to spend.** The managed tier costs more than DIY, but
  the savings of self-hosting are small relative to the tail risk of a data-loss
  event. We save money on the *disposable* backend tier instead, never on the
  crown jewels.

In short: the database lives in its **own managed failure domain**, with **two
independent backup systems** (DO's built-in backups/PITR and our own dumps in
Spaces) — cleanly honoring the "backend can crash, database must not lose data"
split.

## How the backend reaches the database

DigitalOcean Managed Postgres exposes two endpoints:

- A **public** hostname (TLS required), reachable from anywhere.
- A **VPC-private** hostname, reachable only from resources inside the same DO
  VPC.

The backend droplet and the managed database will sit in the **same VPC**, and
the backend will connect over the **private endpoint**. This keeps all
database traffic off the public internet — better security posture and lower
latency — while still requiring TLS. The public endpoint remains available for
administrative access (migrations, manual inspection) if needed, ideally
restricted by a trusted-sources / firewall allowlist.

Connection details will be supplied through the **existing secret/config
plumbing**, so nothing new is invented:

- `POSTGRES_PASSWORD` already lives in the Bitwarden Secrets Manager project.
- `POSTGRES_HOST` (the private endpoint), `POSTGRES_PORT`, `POSTGRES_USER`, and
  `POSTGRES_DB` will be added alongside it — either as Bitwarden secrets the
  backend fetches at runtime, or as entries under `ansible.backend.env` in
  `maestro.yaml`. The backend then receives them via the same
  `BACKEND_ENV_*` → `--penv` → container-env path that the rest of its
  configuration already uses.

## Integration with the current workflow

The solution must live inside the `maestro.yaml` → Pulumi/Ansible model:

- **Provisioning** of the managed database (and its VPC placement, trusted
  sources, and the Spaces bucket for backups) belongs in **Pulumi**, so the
  database is part of our infrastructure-as-code rather than a hand-clicked
  resource. Its connection outputs should flow through Pulumi's stack outputs
  the same way host data already does.
- **Configuration** of the backend to consume the connection details — and any
  scheduled backup job that runs near the data — belongs in **Ansible** and the
  `ansible.backend.env` / Bitwarden secret surface.
- The database, like the rest of the stack, should be **stack-aware**
  (`dev` / `staging` / `prod`) so each environment gets its own isolated
  database, consistent with how Pulumi stacks already isolate environments.

## Other considerations worth keeping in mind

- **Tested restores are part of the strategy, not an afterthought.** A backup
  that has never been restored is a hypothesis. Restore drills should be
  periodic.
- **Retention policy is a decision, not a default.** How far back must we be
  able to restore (PITR window + how long Spaces dumps are kept)? This should be
  chosen deliberately, with lifecycle rules on the Spaces bucket.
- **Backups must be geographically/service-separated from the primary.** The DO
  built-in backups and our Spaces dumps should not share the database's fate;
  Spaces being a distinct service helps here.
- **Lifecycle coupling.** Because the database is the durable component, its
  Pulumi resource must be protected against accidental teardown. A `destroy`
  that drops the backend is fine; a `destroy` that drops the database is the
  exact scenario we are guarding against. The database resource needs
  deletion/retention safeguards distinct from the disposable backend resources.
- **TLS and least-privilege access.** Connections should require TLS; the
  application's database user should have only the privileges it needs; admin
  access to the public endpoint should be restricted by an allowlist.
- **Secrets hygiene.** New connection values should live in Bitwarden (or the
  config's secret surface), never in committed files — consistent with how the
  project already treats `maestro.yaml` secrets.

---

*Next step (not covered here): an implementation plan that maps the above onto
concrete Pulumi resources, Ansible roles, `maestro.yaml` schema additions, and
the backup job. Intentionally omitted from this document.*
