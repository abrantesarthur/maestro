# Distributable Maestro — Versioned CLI Consumable by Any Application

## Background — where maestro is today

Maestro provisions DigitalOcean infrastructure from a single `maestro.yaml`:
**Pulumi** runs in-process via the Automation API,
and **Ansible** (server/container configuration) runs in a containerized
execution environment. Today maestro is **repo-centric**: the only way to use
it is to clone this repository, place a `maestro.yaml` at the repo root, and
run `bun index.ts`. That works for one application, but it does not scale to
the long-term goal.

## The goal

> Any application owns its `maestro.yaml` and invokes maestro to consume it.
> Maestro is a versioned tool the app depends on — not a repo the app lives in.

A consuming backend application's repo should contain only:

- its own `maestro.yaml` (and the app code/Docker image it describes),
- optionally a thin CI workflow that runs maestro on merge.

Maestro versions independently; apps pin a version; upgrading maestro is a
version bump in the consuming repo.

## Chosen distribution model (decided — do not relitigate)

**Maestro ships as an npm package with a `bin` entry, run via `bunx` (or
installed as a devDependency).** Its one internal Docker image (the Ansible
EE) is **pre-built and published to a container registry (GHCR), tagged with
the maestro version**; maestro pulls it at runtime instead of building it,
with a local-build fallback for maestro development.

Explicitly rejected: packaging maestro itself as a Docker image. Maestro is a
Docker *orchestrator* — it builds/runs the Ansible EE and bind-mounts host
paths (SSH keys, website assets). Running it inside a container would require
Docker socket mounting plus host/container path translation on every volume
mount, which is permanently fragile. The host requirements stay what they are
today — `docker`, `pulumi`, `bws`, `cloudflared`, `ssh` — already validated at
startup (`lib/helpers.ts`).

Also rejected as the *primary* channel (fine as a later thin wrapper): a GitHub
Action. It is a follow-up once the CLI exists, not part of this work.

## What blocks this today (the actual work)

These are the repo-root assumptions an implementing agent must remove. Found by
inspection; verify line numbers before editing.

1. **Config path is hardcoded to the script directory.** `index.ts` resolves
   `maestro.yaml` at `${import.meta.dir}/maestro.yaml` (see also
   `lib/config/loadConfig.ts`). There is no `--config` flag.
   - Needed: `--config <path>` flag, defaulting to `./maestro.yaml` in the
     **current working directory** (the consuming app's repo), not the script
     dir.

2. **User-supplied paths resolve against the wrong base.**
   `ansible.web.static.dir` (resolved in `lib/website.ts`) resolves relative
   to cwd today. Once config can live anywhere, relative paths in
   `maestro.yaml` must resolve **relative to the config file's directory**, so
   a consuming app can write `dir: ./website` and have it work regardless of
   where maestro is invoked from.

3. **Internal assets must travel with the package.** Playbooks
   (`ansible/playbooks/`) and the EE definition
   (`ansible/execution_environment/`) are resolved via
   `import.meta.dir`-relative paths (`lib/runAnsible.ts`). That resolution
   strategy works when installed from npm — keep it — but the package must
   actually ship these directories (npm `files` field / `.npmignore`), and
   `package.json` needs a `bin` entry pointing at the CLI. (The Pulumi program
   is plain TypeScript imported by maestro, so it travels with the package
   source automatically — just make sure its directory is included in
   `files`.)

4. **The Ansible EE bakes app-specific content at build time.** Website assets
   are copied into `ansible/execution_environment/files/website` before
   `ansible-builder` packs them into the image (`lib/runAnsible.ts`). This
   makes the EE image app-specific and forces a rebuild per app/per deploy.
   - Needed: deliver website assets at **runtime** (volume mount into
     `ansible-navigator`, or rsync to the target) so the EE image is
     app-agnostic and can be pre-built/published.

5. **The EE image is built on demand, every run** (`lib/runAnsible.ts` runs
   `ansible-builder`). Once (4) is done, the image is app-agnostic.
   - Needed: publish it to GHCR tagged with the maestro package version
     (CI job in this repo); at runtime, pull the tag matching the running
     maestro version. Keep a `--build-local` (or similar) fallback for
     developing maestro itself.

## Constraints

- **No behavior change for the current deployment** while refactoring: this
  repo's own `maestro.yaml` workflow (`bun index.ts` from the repo root) must
  keep working throughout — the repo root is just another "consuming app"
  whose config happens to sit next to the tool.
- Secrets flow stays as-is: `BWS_ACCESS_TOKEN` env var → `bws` CLI →
  `process.env` injection. Nothing app-specific gets baked into the published
  EE image — it must be safe to publish publicly.
- State stays in Pulumi Cloud (`PULUMI_ACCESS_TOKEN`); no local-state work in
  this scope.
- Bun stays the runtime. Do **not** pursue `bun build --compile` single-binary
  distribution: `ansible-builder` and `docker build` need real files on disk,
  which embedded assets can't provide cleanly.

## Out of scope (follow-ups, not this spec)

- GitHub Action wrapper for CI consumption.
- Actually publishing to the public npm registry / choosing the final package
  scope and name (structure the package so publishing is a `npm publish` away).
- Multi-cloud or pluggable IaC backends.

## Definition of done

From a scratch directory **outside this repo** containing only a valid
`maestro.yaml` (and a website dir if configured), an invocation equivalent to
`bunx <maestro-package> --dry-run` (and a real run, where credentials allow)
works end to end: config is found in cwd, relative paths resolve against the
config file, the EE image is pulled (not built), and no file inside the
maestro installation is written to at runtime.
