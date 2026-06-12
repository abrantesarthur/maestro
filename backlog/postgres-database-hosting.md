# Postgres Database Durability — Independent Backups & Tested Restores

## Background — what we are ultimately protecting

Maestro provisions DigitalOcean infrastructure from a single `maestro.yaml` that
feeds **Pulumi** (infrastructure-as-code) and **Ansible** (server/container
configuration). The backend runs in a disposable droplet; production data lives
in a database that must never be lost.

### The core principle (unchanged)

> The backend is cattle; the database is the crown jewels.

Our top priority, above everything else, is **durability of production data**.
Losing the database — or data within it — is treated as an unacceptable,
potentially existential outcome. The backend tier is disposable: its droplet can
crash, be rebuilt, or be replaced with no lasting consequence, and its failure
domain must stay *separate* from the database's. We stay within the DigitalOcean
ecosystem, and every piece must be expressible in the `maestro.yaml` →
Pulumi/Ansible model, never bolted on as a manual out-of-band step.

## What already exists (the foundation — do NOT re-implement)

A core, per-environment Managed Postgres tier is already provisioned and wired
end to end. The implementing agent must treat all of this as **done and stable**,
and must not redesign or duplicate it. Touch it only if a remaining task
genuinely requires it (e.g., reading an existing stack output).

Shipped and in `main..postgres`:

- **DigitalOcean Managed Postgres, one cluster per Pulumi stack** (per-env
  isolation), defined by a `ManagedDatabase` component resource
  (`pulumi/image/resources/managedDatabase.ts`). Single-node, pinned engine
  version, configurable size.
- **Private networking.** An explicit per-stack `digitalocean.Vpc` joined by both
  the droplet and the cluster; the backend connects over the **private VPC
  endpoint** (`cluster.privateHost`), never the public host.
- **Trusted-sources firewall** allowing only droplets carrying the per-stack tag
  (`digitalocean.DatabaseFirewall`); no `0.0.0.0/0` rule.
- **Lifecycle safeguards on the crown jewels:** `retainOnDelete: true` +
  `protect: true` on the cluster, `retainOnDelete` on the DB/user/VPC, so a
  `pulumi destroy` of the disposable backend cannot drop the data. The resource
  name encodes only the stack name, so resizing never triggers a replace.
- **Least-privilege application user** (a dedicated non-`doadmin`
  `DatabaseUser` + `DatabaseDb`; DO generates the password as a `pulumi.secret`).
- **Connection plumbing into the backend container.** `POSTGRES_HOST`,
  `POSTGRES_PORT`, and `POSTGRES_PASSWORD` are derived from Pulumi outputs and
  threaded **per-host** (`postgres` stack output → `ssh.ts` → `SSH_HOSTS` →
  `hosts.py` hostvars → `backend_app` role). `POSTGRES_USER` and `POSTGRES_DB`
  travel globally via the `BACKEND_ENV_*` path and are required Bitwarden
  secrets. Secrets are redacted from console output and `no_log`-guarded in
  Ansible.
- **TLS enforced** via `POSTGRES_SSLMODE=require` / `PGSSLMODE=require`.
- **Durability via DO's built-in mechanism:** daily backups + point-in-time
  recovery (PITR) on the managed cluster.
- **Config surface:** `pulumi.database` global defaults + optional per-stack
  `pulumi.stacks.<s>.database` sizing override, validated in `lib/config/`,
  documented in `example.maestro.yaml`, `README.md`, `pulumi/README.md`,
  `ansible/README.md`, and covered by `tests/database.test.ts` /
  `tests/validateSchema.test.ts`.

## The gap this spec closes

The original durability strategy was explicit that the crown jewels deserve **two
independent backup systems**, not one:

1. DO's built-in daily backups + PITR — **done** (above).
2. **Our own logical backup stream into a *different* service (DO Spaces)** —
   **not built.** This is the defense-in-depth half, and it is what this spec is
   primarily about.

A single backup system means a single point of failure for recovery: an
account-level problem, a provider-side backup defect, or a Spaces-less PITR
window that has rolled off all leave us with no escape hatch. A backup that has
never been restored is only a hypothesis. Closing the gap means delivering an
independent, self-owned, provider-portable copy of the data **and** proving we
can restore from it.

Two smaller follow-ups, already flagged in code/docs as deferred, are also in
scope here because they complete the original security and lifecycle goals:

3. **Per-database GRANT tightening** for the app user (the second half of
   least-privilege — see the SCOPE CAVEAT comment in `managedDatabase.ts`).
4. **A teardown / orphan-cleanup runbook** for the `retainOnDelete` +
   `protect` resources (intentional, deliberate database deletion is currently
   undocumented).

## Goals & requirements (acceptance criteria)

The remaining work is complete when:

1. **An independent logical backup exists in a separate service.** Each
   DB-enabled stack produces periodic logical backups (`pg_dump`-style) of its
   application database, stored in **DigitalOcean Spaces** (object storage — a
   *different* service and failure domain from the managed database). The backups
   are portable and provider-independent (restorable to any Postgres, not just
   DO).
2. **Failure-domain separation is preserved.** The backup artifacts do not share
   the database's fate: a loss of the cluster, or a `pulumi destroy` of the
   backend, must not take the Spaces copies with it. The Spaces bucket carries
   the same lifecycle protection posture as the crown jewels
   (`retainOnDelete`-style safeguards) so it is never orphaned or accidentally
   dropped.
3. **Backups are stack-aware.** Like everything else in the model, each
   environment (`dev`/`staging`/`prod`) gets its own isolated backup destination
   and schedule, consistent with the per-stack isolation already in place.
4. **The schedule runs near the data, automatically.** The backup job runs on a
   trusted host inside the VPC (it must reach the private endpoint and satisfy
   the trusted-sources firewall), on a recurring schedule, with no manual step.
   A failed or skipped backup must be observable — a silently broken backup job
   discovered only at restore time is the exact failure mode we are guarding
   against.
5. **Retention is a deliberate decision, not a default.** The PITR window and the
   Spaces dump retention period are chosen on purpose and enforced with
   **lifecycle rules** on the bucket. The chosen values and the rationale are
   documented.
6. **Restores are tested, and the procedure is documented.** A runbook exists for
   restoring from a Spaces dump into a fresh database, and the restore has been
   *exercised at least once* (not just written down). Periodic restore drills are
   part of the ongoing strategy, not an afterthought.
7. **Least-privilege is completed.** The app user's privileges are tightened to
   only its own database (e.g., `REVOKE CONNECT` on other databases in the
   cluster, grant only what the app needs), or the limitation is explicitly
   documented as not expressible via the provider with a concrete workaround.
8. **Teardown is documented.** A runbook covers the deliberate, intentional
   deletion of a protected database (unprotect → state handling → destroy) and
   the cleanup of `retainOnDelete` orphans (VPCs/clusters) left in the DO account
   by repeated create/destroy cycles.
9. **Everything is IaC and config-driven.** The bucket and its lifecycle rules
   are Pulumi resources; the schedule and job are Ansible-configured; any new
   knobs live in `maestro.yaml` under the established schema idiom and are
   validated and documented. No hand-clicked resources.
10. **Secrets hygiene holds.** Any new credentials (e.g., Spaces access keys for
    the backup job, or the database password the job uses) flow through the
    existing secret surface (Bitwarden / Pulumi secrets / per-host hostvars),
    are never written to committed files, and are `no_log`/redaction-guarded
    wherever they pass through Pulumi or Ansible output. Tests assert no
    committed Postgres or Spaces credential literals.

## Chosen strategy

**A self-owned logical backup stream (`pg_dump`) into a per-stack DigitalOcean
Spaces bucket, with deliberate lifecycle/retention rules and a tested restore
runbook** — layered on top of the existing managed cluster, its built-in
backups, and PITR.

Rationale (carried from the original framing):

- **Operational failures dominate data-loss risk.** A second, independent backup
  guards against the realistic failure modes the built-in backups cannot: an
  account- or provider-level problem with the managed backup system, and the need
  for a portable copy to migrate or recover outside DO entirely.
- **Spaces is a *different* service.** Putting the dumps in object storage rather
  than the same managed-database control plane is the whole point — separate
  failure domain, separate blast radius.
- **Right-sized to today.** Logical `pg_dump` dumps are sufficient and portable
  for the current single-backend, per-stack deployment. More elaborate
  approaches (WAL archiving to Spaces, cross-region replication, HA standby
  nodes) optimize for uptime or RPO targets that are **not yet stated needs** and
  remain explicitly out of scope.
- **Cost is the right place to spend.** Object storage is cheap relative to the
  tail risk of a data-loss event; we spend on durability of the crown jewels, not
  on the disposable backend.

## Integration with the workflow (where each piece lives)

The agent must keep each concern in the layer that already owns it:

- **Pulumi** — the Spaces bucket (per stack), its lifecycle/retention rules, and
  any access credentials the backup job needs. The bucket must inherit the same
  "never accidentally destroyed" posture as the database resources. Surface
  whatever the backup job needs (bucket name/region/endpoint, and any generated
  keys as Pulumi secrets) through the existing stack-output → `ssh.ts` →
  `SSH_HOSTS` → `hosts.py` per-host plumbing, mirroring how `postgres_host` /
  `postgres_password` are already threaded. Do not invent a parallel mechanism.
- **Ansible** — the scheduled backup job itself (the thing that runs `pg_dump`
  and uploads to Spaces), configured on a trusted in-VPC host, reusing the
  `backend_app` connection inputs (host/port/user/db/password) and the
  `no_log`/redaction conventions already established.
- **`maestro.yaml`** — any new configuration (enable switch, schedule, retention)
  follows the established **global-default-plus-per-stack-override** idiom under
  `pulumi.database` (or a sibling), with i/o-ts codecs, semantic validation, and
  `displayConfig` output matching the existing patterns, plus
  `example.maestro.yaml` documentation (names only, never secret values).
- **Docs & tests** — extend `README.md` (move the deferred backup item out of
  "Future Improvements" into the documented design), `pulumi/README.md`,
  `ansible/README.md`, and add tests in the style of `tests/database.test.ts`
  (schema acceptance/rejection, secret-redaction, no committed literals).

## Open decisions for the implementing agent

These are deliberately left for the agent to resolve in its implementation plan,
and to surface back for confirmation where the trade-off is material:

- **Backup cadence and retention values** (the actual numbers and lifecycle
  rules) — propose defaults and justify them.
- **Where the backup job runs** — on the existing backend droplet (simplest;
  already trusted and in-VPC) versus a dedicated mechanism. Note any failure-mode
  trade-offs.
- **Spaces credential model** — Pulumi-generated Spaces keys threaded per-host
  versus Bitwarden-supplied, consistent with the existing HOST/PASSWORD-as-output
  vs USER/DB-as-secret split.
- **Backup observability** — how a failed/skipped backup becomes visible (the
  minimum that satisfies requirement #4 without over-building monitoring).
- **Encryption of dumps at rest** beyond Spaces' own encryption, if warranted.

## Explicitly out of scope

- Re-implementing, redesigning, or migrating the shipped core DB tier listed
  under "What already exists."
- Multi-node HA / standby nodes with automatic failover (optimizes for *uptime*,
  not the stated *durability* goal).
- WAL-level continuous archiving to Spaces / custom PITR beyond DO's built-in
  PITR.
- Cross-region or multi-cloud replication.
