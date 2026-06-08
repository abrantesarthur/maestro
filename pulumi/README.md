# Pulumi Infrastructure

This directory contains a Dockerised Pulumi program that provisions the Cloudflare environment. The program supports multiple stacks (`dev`, `staging`, `prod`) configured via `maestro.yaml`.

## Workflow

Pulumi is orchestrated from TypeScript by [`lib/runPulumi.ts`](../lib/runPulumi.ts), which is invoked when you run `bun .` from the repo root. It reads `maestro.yaml`, builds the `maestro_pulumi` Docker image, and runs it once per stack, passing configuration into the container via `-e` flags and mounting the SSH key.

The Pulumi command (`up`, `refresh`, `cancel`, `output`, or `destroy`) is taken from `pulumi.command` in `maestro.yaml`. When `pulumi.enabled` is `false` but `ansible.enabled` is `true`, the `output` command is used to read existing stack outputs for Ansible.

The Pulumi program provisions:

1. DigitalOcean virtual servers that come with cloudflared and SSL/TLS certificates properly installed, so Cloudflare can provision tunnels and HTTPS connections properly.
2. Cloudflare resources, including DNS A records pointing your domain to webservers and tunnels allowing SSH access via `ssh0.example.com`, `ssh1.example.com`, etc.

To connect through the tunnel from your machine, [install cloudflared](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/) locally and add these entries to your `~/.ssh/config`:

```
Host ssh0.example.com
  ProxyCommand /opt/homebrew/bin/cloudflared access ssh --hostname %h
  IdentityFile <path to the ssh private key>
```

In the event that a server is destroyed, Pulumi correctly takes down the tunnels that were linked to it.

## Managed Database (Postgres)

When `pulumi.database.enabled` is `true`, the program provisions a database tier per stack via the `ManagedDatabase` component resource (`image/resources/managedDatabase.ts`), which mirrors the `VirtualServer` pattern:

- A `digitalocean.DatabaseCluster` (engine `pg`, pinned major version, sized from the merged `database` config, `nodeCount` 1 by default).
- A `digitalocean.DatabaseDb` (named from `POSTGRES_DB`) and a `digitalocean.DatabaseUser` (named from `POSTGRES_USER`; DigitalOcean generates its password). The application user is never the cluster admin `doadmin`.
- A `digitalocean.DatabaseFirewall` whose only rule trusts the backend droplet by the per-stack **tag** (the stack name), not the droplet ID — so it survives the disposable droplet being replaced. No `0.0.0.0/0` rule.

**Shared VPC.** The program creates one `digitalocean.Vpc` per stack and joins **both** the backend droplet (`vpcUuid`) and the database cluster (`privateNetworkUuid`) to it. The same VPC is required for the database's private endpoint to resolve from the droplet. The region-default VPC is account-global and shared, so it is not used. Because VPC membership is immutable on a droplet, enabling the database replaces the existing droplet once on first apply (the backend is cattle; Ansible re-converges).

**Lifecycle safeguards.** The cluster carries `retainOnDelete: true` **and** `protect: true`; the database, user, and VPC carry `retainOnDelete`. A `pulumi destroy` of the disposable backend therefore succeeds while keeping the cloud database (and its data); intentional teardown requires deliberately removing the resource from state and unprotecting it. The cluster's stable resource name (`pg-<stackName>`) deliberately does **not** encode size/version/region, so changing those never triggers a replace of the crown jewels.

**Stack outputs.** The program exports a `postgres` object alongside `hosts`:

```
postgres = {
  host:     <cluster.privateHost>,   # private VPC endpoint
  port:     <cluster.port>,          # DO-assigned, typically 25060
  user:     <POSTGRES_USER>,
  database: <POSTGRES_DB>,
  password: pulumi.secret(<appUser.password>),
  sslmode:  "require",
}
```

The `postgres` export is present only when the stack enabled the database. The password is a Pulumi **secret**, so it is masked (`[secret]`) in stack output unless `--show-secrets` is passed. The entrypoint prints stack outputs with `pulumi stack output --json --show-secrets` between the `__PULUMI_OUTPUTS_BEGIN__` / `__PULUMI_OUTPUTS_END__` markers; Maestro redacts that marker block from the teed console so the password never reaches the terminal or CI logs while still being captured for parsing (see [`lib/runPulumi.ts`](../lib/runPulumi.ts) and [`lib/helpers.ts`](../lib/helpers.ts)).

## Configuration

Configuration is read from `maestro.yaml` by `lib/runPulumi.ts` and passed into the container as `-e` flags:

| Variable                | Source in maestro.yaml                  |
| ----------------------- | --------------------------------------- |
| `DOMAIN`                | `domain`                                |
| `CLOUDFLARE_ACCOUNT_ID` | `pulumi.cloudflare_account_id`          |
| `SSH_PORT`              | `pulumi.ssh_port`                       |
| `BACKEND_PORT`          | `ansible.backend.port`                  |
| `PULUMI_STACK`          | Derived from `pulumi.stacks.<env>` keys |
| `PULUMI_SERVERS_JSON`   | `pulumi.stacks.<env>.servers` (as JSON) |
| `PULUMI_DATABASE_JSON`  | `pulumi.database` merged with `pulumi.stacks.<env>.database` (override wins), as JSON; defaults to `{}` |
| `POSTGRES_USER`         | Bitwarden (used to create the dedicated DB user) |
| `POSTGRES_DB`           | Bitwarden (used to create the app database)      |

The database `-e` values are applied inside the container via `pulumi config set` (`<project>:database`, `:postgresUser`, `:postgresDb`). The program reads them to create the cluster, the dedicated user, and the app database. `POSTGRES_USER`/`DB` are required only when the merged `database.enabled` is `true`. The port is **not** an input: the backend connects on the cluster's DO-assigned port, surfaced as the `postgres.port` stack output and threaded to the backend per-stack like host and password.

## Required Secrets (from Bitwarden)

| Secret                 | Purpose                         | Required Scopes                                                                                                                                                                                                  |
| ---------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PULUMI_ACCESS_TOKEN`  | Pulumi Cloud authentication     | A standard Pulumi Cloud personal access token (no granular scopes); needs access to the organization/stacks being deployed.                                                                                       |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API access           | Zone → **Zone:Read**, **Zone Settings:Edit**, **DNS:Edit**; **User → SSL and Certificates:Edit** (Origin CA certs — this is a _user-level_ permission, not zone-level; without it Origin CA cert creation fails with `401 / code 1016`); Account → **Cloudflare Tunnel:Edit** (Zero Trust tunnels). Scoped to the account/zone being managed. |
| `DIGITALOCEAN_ACCESS_TOKEN`   | DigitalOcean API access         | `droplet:create`, `droplet:read`, `droplet:update`, `droplet:delete`; `ssh_key:read`; `tag:create`, `tag:read`, `tag:delete`. A full read+write token also works. When the database tier is enabled, also needs `database:create`, `database:read`, `database:update`, `database:delete` and VPC read/write.                                                |
| `VPS_SSH_KEY`          | SSH key for server provisioning | Not an API token — the SSH private key matching the public key registered in DigitalOcean; no scopes apply.                                                                                                       |

When `pulumi.database.enabled` is `true`, these additional Bitwarden values are required (stable identifiers you choose, read by the Pulumi program to create the user/database):

| Secret          | Purpose                                                              |
| --------------- | ------------------------------------------------------------------- |
| `POSTGRES_USER` | Name of the dedicated least-privilege app database user to create.  |
| `POSTGRES_DB`   | Name of the application database to create.                         |

`POSTGRES_HOST`, `POSTGRES_PORT`, and `POSTGRES_PASSWORD` are derived from DigitalOcean and surfaced as stack outputs — they are not Bitwarden secrets.

## Ports

- SSH traffic is exposed via Cloudflare tunnels targeting port 22 on each host; no direct public exposure of port 22 is required when using the tunnel.

## Components

- [`lib/runPulumi.ts`](../lib/runPulumi.ts) validates configuration, builds the Docker image, and starts a container.
- `image/` holds the Pulumi project.
- `image/entrypoint.sh` runs inside the container and executes Pulumi commands.
- `image/providers/` hosts services that discover infrastructure (e.g., Cloudflare zone ID).
- `image/resources/` defines record components for provisioning resources.

## Prerequisites

- Docker installed locally (the script builds and runs a container).
- The base `domain` must already be an active zone in the Cloudflare account that `CLOUDFLARE_API_TOKEN` belongs to. The program looks up the zone by name (see `image/providers/`) and fails with `Cloudflare zone for <domain> not found.` if it is missing. Ownership is established out-of-band via Cloudflare nameserver delegation — see the [root README](../README.md#prerequisites).
- The Cloudflare zone must be free of conflicting DNS records. The program creates the apex `A`, `www` `A`, and `api`/`ssh*` `CNAME` records itself and does not adopt pre-existing ones. If a record of a different type already occupies one of those names (e.g. a manual `www` `CNAME`), Cloudflare rejects the create with `A CNAME record with that host already exists` (error `81054`) and the run fails partway through — leaving any earlier resources (droplet, tunnel) live. Delete or `pulumi import` the conflicting record before re-running.
