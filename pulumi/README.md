# Pulumi Infrastructure

This directory contains a Dockerised Pulumi program that provisions the Cloudflare environment. The program supports multiple stacks (`dev`, `staging`, `prod`) configured via `maestro.yaml`.

## Workflow

This script is typically called by the parent `run.sh` which handles configuration loading from `maestro.yaml`. For standalone usage:

```bash
# Configuration is passed via environment variables
export DOMAIN="example.com"
export CLOUDFLARE_ACCOUNT_ID="your_account_id"
export SSH_PORT="22"
export BACKEND_PORT="3000"
export PULUMI_STACK="prod"
export PULUMI_SERVERS_JSON='[{"roles":["backend","web"]}]'
export BWS_ACCESS_TOKEN="your_bws_token"

./run.sh --command up
```

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

Configuration is passed via environment variables from the parent `run.sh`, which reads from `maestro.yaml`:

| Variable                | Source in maestro.yaml                  |
| ----------------------- | --------------------------------------- |
| `DOMAIN`                | `domain`                                |
| `CLOUDFLARE_ACCOUNT_ID` | `pulumi.cloudflare_account_id`          |
| `SSH_PORT`              | `pulumi.ssh_port`                       |
| `BACKEND_PORT`          | `ansible.backend.port`                  |
| `PULUMI_STACK`          | Derived from `pulumi.stacks.<env>` keys |
| `PULUMI_SERVERS_JSON`   | `pulumi.stacks.<env>.servers` (as JSON) |

## Required Secrets (from Bitwarden)

| Secret                 | Purpose                         |
| ---------------------- | ------------------------------- |
| `PULUMI_ACCESS_TOKEN`  | Pulumi Cloud authentication     |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API access           |
| `DIGITALOCEAN_TOKEN`   | DigitalOcean API access         |
| `VPS_SSH_KEY`          | SSH key for server provisioning |

## Optional CLI Flags

| Flag         | Purpose                                                                   |
| ------------ | ------------------------------------------------------------------------- |
| `--command`  | Pulumi action: `up`, `refresh`, `cancel`, or `output` (default: `up`)     |
| `--skip-bws` | Skip fetching secrets from Bitwarden (use when called from parent script) |

## Ports

- SSH traffic is exposed via Cloudflare tunnels targeting port 22 on each host; no direct public exposure of port 22 is required when using the tunnel.

## Components

- `run.sh` validates configuration, builds the Docker image, and starts a container.
- `image/` holds the Pulumi project.
- `image/entrypoint.sh` runs inside the container and executes Pulumi commands.
- `image/providers/` hosts services that discover infrastructure (e.g., Cloudflare zone ID).
- `image/resources/` defines record components for provisioning resources.

## Prerequisites

- Docker installed locally (the script builds and runs a container).
