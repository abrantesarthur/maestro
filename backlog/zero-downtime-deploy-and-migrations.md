# Zero-Downtime Backend Deploys + Database Migration Support

## Background — how a backend deploy works today

Maestro provisions DigitalOcean infrastructure from a single `maestro.yaml` that
feeds **Pulumi** (infrastructure-as-code) and **Ansible** (server/container
configuration). The backend runs as a single Docker container on a droplet,
deployed by the `backend_app` Ansible role
(`ansible/playbooks/roles/backend_app/`).

The current deploy is a straight container replace. In
`backend_app/tasks/main.yml` the relevant steps are:

1. Build the container env from `BACKEND_ENV_*` vars and merge in the per-stack
   `POSTGRES_HOST`/`POSTGRES_PORT`/`POSTGRES_PASSWORD` hostvars.
2. Log into GHCR and **pull** the new image (`backend_image:backend_image_tag`).
3. **Run backend container** via `community.docker.docker_container` with
   `recreate: true`, publishing a single fixed host port
   (`backend_bind_address:backend_host_port:backend_container_port`, default
   `127.0.0.1:<BACKEND_PORT>:<BACKEND_PORT>`).

Config flows from `maestro.yaml` (`ansible.backend.{image,tag,port,env}`) →
`lib/config/schema.ts` (`BackendConfigCodec`) → `lib/runAnsible.ts`
(`buildAnsibleEnv`, which emits `BACKEND_IMAGE`, `BACKEND_IMAGE_TAG`,
`BACKEND_PORT`, and the `BACKEND_ENV_*` set) → `ansible-navigator --penv` →
the role defaults in `backend_app/defaults/main.yml`.

A reverse proxy already exists in the codebase but only in front of the **web**
tier: the `nginx` role (`ansible/playbooks/roles/nginx/`) terminates TLS
(Cloudflare origin cert) and `proxy_pass`es to a single fixed `host:port`
(`templates/site-proxy.conf.j2`). The backend has no proxy in front of it today.

## The two gaps this spec closes

### 1. Deploys cause downtime

Because the run step uses `recreate: true` and binds a **single** fixed host
port, the deploy is **stop-old-then-start-new**: `community.docker.docker_container`
removes the running container before creating the replacement. On a single
server there is therefore an interval — container teardown + new container
startup + app readiness time — during which **no container is serving traffic**.
The single fixed host port also makes overlap impossible: two containers cannot
both bind `127.0.0.1:<port>` at once.

### 2. There is no way to run database migrations

A backend image update that requires a schema change has no supported mechanism.
There is no field in `maestro.yaml` to express "run migrations as part of this
deploy," and the role never runs anything but the long-lived app container.
Migrations today would be a manual, out-of-band step — exactly the kind of
escape hatch the rest of Maestro avoids.

These two are coupled: a correct deploy that involves a schema change must run
the migration **and** swap the container without dropping traffic, in the right
order.

## Goals & requirements (acceptance criteria)

The work is complete when:

1. **A backend image update causes no serving gap on a single server.** During a
   routine image/tag change, there is no interval with zero containers able to
   serve requests. The new container is started and confirmed healthy *before*
   the old one stops receiving traffic; the cutover itself drops no in-flight
   requests.
2. **A failed deploy is safe.** If the new image fails to start or fails its
   health check, the old container keeps serving and the deploy aborts with a
   clear error — no half-deployed state, still no downtime.
3. **Migrations are expressible in `maestro.yaml`.** An operator can declare, per
   the established config idiom, that a deploy runs a database migration step,
   and what that step is. Absence of the declaration means "no migration"
   (backward compatible with today's config).
4. **Migrations run before the new container starts, against the live DB.** The
   migration step runs to completion using the same database connection inputs
   the container uses (the per-stack `POSTGRES_*` values), and a non-zero exit
   **aborts the deploy before the new app container is touched** (satisfying
   requirement #2 for the migration case too).
5. **The migration runs near the data.** It executes on the backend host inside
   the VPC, where the per-stack `postgres_host`/`postgres_port`/`postgres_password`
   hostvars exist and the trusted-sources firewall is satisfied — not from the
   operator's laptop or the execution-environment container.
6. **Secrets hygiene holds.** The migration step receives the DB password and any
   other `BACKEND_ENV_*` secrets through the existing path and is
   `no_log`/redaction-guarded wherever it passes through Ansible output, matching
   the conventions already in `backend_app/tasks/main.yml`.
7. **Everything is config-driven and documented.** New `maestro.yaml` knobs have
   io-ts codecs and semantic validation in `lib/config/`, are documented in
   `example.maestro.yaml` / `README.md` / `ansible/README.md` (names only, never
   secret values), and are covered by tests in the style of
   `tests/validateSchema.test.ts` / `tests/runAnsible.test.ts`.

## Chosen strategy

**A reverse proxy in front of the backend + blue/green container swap, with a
one-shot migration container run from the backend image before the swap.**

### Zero-downtime: proxy + blue/green

Put nginx (reusing/extending the existing `nginx` role) in front of the backend
as the stable endpoint, pointing at an `upstream` whose member can be repointed,
rather than `proxy_pass`-ing to a hardcoded `host:port`. The deploy then becomes
start-new-then-flip-then-stop-old:

1. Pull the new image.
2. Start the new ("green") container on the **idle** host port, under a distinct
   container name — the old ("blue") container keeps serving on its port the
   whole time. (No `recreate: true` on a shared single port.)
3. Health-check green until ready (or fail the deploy and leave blue running).
4. Rewrite the nginx upstream to green's port and `nginx -s reload` — a graceful
   reload that drains in-flight requests on old workers and routes new requests
   to green. This is the atomic, gap-free cutover.
5. Stop and remove the old blue container.

This requires tracking which "color"/port is currently live (e.g. a small state
file on the host, or by inspecting running containers) and selecting the idle
one for the new container.

### Migrations: one-shot container from the backend image

The migration tool ships **inside the backend image** and is invoked with an
alternate command (e.g. `["npm","run","migrate"]`, `alembic upgrade head`,
`prisma migrate deploy`). This is the default because migrations must be
versioned with the code that needs them. Allow an optional override to a
**separate image/tag** for cases where migrations are a distinct artifact
(e.g. a Flyway/Liquibase container).

**`command` is the argv run *inside* the container, not a host `docker run`
line.** I.e. `command: ["/app/migrate"]` (a binary baked into the backend image)
or `["npm","run","migrate"]` — the value is handed to `community.docker.docker_container`
as the container's command, and the module does the `docker run --rm`, env
injection, and exit-code propagation. Do **not** model `command` as a host shell
string like `"docker run --rm <image> /app/migrate"`: that forces an
`ansible.builtin.shell` invocation where secrets (the DB password) must be
threaded onto the command line — visible in `ps`, awkward to `no_log` — and
duplicates the `image`/`tag` that are already separate config fields.

The migration runs as a **run-to-completion container** (`detach: false`,
`cleanup: true` — i.e. `docker run --rm`, performed by the module) with the same
`backend_env` (including the merged `POSTGRES_*`), inserted in the deploy
ordering **between pull and green start**:

1. Pull new image.
2. **Run migration one-shot.** Non-zero exit → abort, old container untouched.
3. Start green container on idle port.
4. Health-check green.
5. Flip nginx upstream + reload.
6. Stop/remove blue.

App-self-migrates-on-boot (init-container style) is **rejected**: it races two
app versions against the schema and turns a failed migration into a crash loop
instead of a clean pre-flight abort.

## Integration with the workflow (where each piece lives)

- **`maestro.yaml` + `lib/config/`** — add an optional `ansible.backend.migrate`
  block (presence = enabled). At minimum a `command` (an **argv array**, to avoid
  shell-quoting ambiguity) and optional `image`/`tag` overrides defaulting to
  `backend.image`/`backend.tag`. Add a `MigrateConfigCodec` and extend
  `BackendConfigCodec` in `lib/config/schema.ts`. The new fields likely surface
  to Ansible as `BACKEND_MIGRATE_COMMAND` (JSON-encoded argv),
  `BACKEND_MIGRATE_IMAGE`, `BACKEND_MIGRATE_TAG` in `buildAnsibleEnv`
  (`lib/runAnsible.ts`), forwarded via the same `--penv` mechanism that already
  forwards `BACKEND_ENV_*`. The proxy/blue/green behavior may need its own knobs
  (e.g. a health-check path, the second/idle port) — follow the
  global-default-plus-per-stack-override idiom where a knob is environment-specific.
- **Ansible — `backend_app` role** — add the migration task (one-shot container,
  gated on `backend_migrate_command | length > 0`, `no_log`-guarded) before the
  run step, and rework the run step from `recreate: true` on a single port into
  the blue/green start → health-check → cutover → stop-old sequence. Port
  selection / live-color tracking lives here.
- **Ansible — `nginx` role** — extend it (or add a backend site template) to
  front the backend with an `upstream` block that the deploy can repoint, plus a
  graceful-reload handler. Reuse the existing TLS/proxy-header patterns from
  `templates/site-proxy.conf.j2`. Ensure `ufw` / firewall posture still only
  exposes what is intended (the backend container stays bound to `127.0.0.1`;
  nginx is the public edge).
- **Docs & tests** — document the new `migrate` config and the deploy model in
  `README.md` and `ansible/README.md`; add the migrate fields to
  `example.maestro.yaml` (names only). Add schema acceptance/rejection tests
  (`tests/validateSchema.test.ts`) and env-construction tests
  (`tests/runAnsible.test.ts`) covering the new vars and their defaulting.

## The hard constraint the implementer (and operators) must understand

During steps 1–5 the **old app keeps serving against the already-migrated
schema**, and during the cutover both versions briefly serve at once. Therefore
migrations must be **backward-compatible (expand/contract)**:

- **Expand** (deploy N): additive changes only — add nullable column, new table,
  new index. New code uses them; old code ignores them. Both versions work.
- **Contract** (deploy N+1, after all traffic is on new code): drop the old
  column, add NOT NULL, etc.

A destructive migration (renaming/dropping a column the still-running old
container reads) will error the old app during steps 2–5. This is a property of
the **migration authoring**, not something the tooling can enforce — it must be
called out prominently in the docs so it isn't learned at incident time.

## Open decisions for the implementing agent

These are left for the implementation plan, to be surfaced back where the
trade-off is material:

- **Live-color/port tracking mechanism** — host state file vs. inspecting
  running containers vs. a fixed two-port (blue/green) convention. Note the
  failure mode if state and reality drift.
- **Health-check definition** — how readiness is expressed and configured (an
  HTTP path on the backend? a command?), the timeout/retry budget, and whether
  the path is a new `maestro.yaml` knob.
- **Migration config shape** — exactly which fields beyond `command`/`image`/`tag`
  are warranted (e.g. a separate migration env, a timeout), kept minimal.
- **Whether nginx-in-front-of-backend is always on or opt-in** — and how it
  interacts with the existing `nginx` role and any web-tier usage on the same
  host.
- **Single-server scope vs. multi-host** — the requirements above are stated for
  the single-server case; note what (if anything) changes when a stack has
  multiple backend hosts.

## Explicitly out of scope

- Rolling deploys across multiple hosts / orchestrator-style scheduling
  (Kubernetes, Nomad, Swarm). The target remains the existing single-droplet,
  Docker-on-a-host model.
- Automatic migration rollback / down-migrations. Forward-only, expand/contract
  is the assumed discipline; rollback strategy is a separate concern.
- Redesigning the shipped Postgres tier or its connection plumbing (see
  `backlog/postgres-database-hosting.md`); this spec consumes the existing
  `POSTGRES_*` per-host wiring as-is.
