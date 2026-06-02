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

## Required Secrets (from Bitwarden)

| Secret                 | Purpose                         | Required Scopes                                                                                                                                                                                                  |
| ---------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PULUMI_ACCESS_TOKEN`  | Pulumi Cloud authentication     | A standard Pulumi Cloud personal access token (no granular scopes); needs access to the organization/stacks being deployed.                                                                                       |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API access           | Zone → **Zone:Read**, **Zone Settings:Edit**, **DNS:Edit**, **SSL and Certificates:Edit** (Origin CA certs); Account → **Cloudflare Tunnel:Edit** (Zero Trust tunnels). Scoped to the account/zone being managed. |
| `DIGITALOCEAN_TOKEN`   | DigitalOcean API access         | `droplet:create`, `droplet:read`, `droplet:update`, `droplet:delete`; `ssh_key:read`; `tag:create`, `tag:read`, `tag:delete`. A full read+write token also works.                                                |
| `VPS_SSH_KEY`          | SSH key for server provisioning | Not an API token — the SSH private key matching the public key registered in DigitalOcean; no scopes apply.                                                                                                       |

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
