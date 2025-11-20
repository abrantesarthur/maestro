# Pulumi Infrastructure

This directory contains a Dockerised Pulumi program that provisions the cloudflare environment. The program currently targets the single `prod` stack.

## Workflow

Run the `run.sh` script. It validates that all required flags are present, builds and runs a docker image that executes Pulumi up or refresh.

```bash
./run.sh \
  --pulumi-access-token "$PULUMI_ACCESS_TOKEN" \
  --cloudflare-api-token "$CLOUDFLARE_API_TOKEN" \
  --digital-ocean-api-key "$DIGITAL_OCEAN_API_KEY" \
  --ssh-key "/path/to/key>" \
  [--command up|refresh]
```

The Pulumi program provisions:
1. DigitalOcean virtual servers that come with cloudflared and ssl/tls certificates properly installed, so Cloudflare can provision tunnels and https connections properly.
2. Cloudflare resources, including DNS A records pointing `dalhe.ai` to our webservers and tunnels allowing us to ssh to our servers via `ssh0.dalhe.ai`, `ssh-b.dalhe.ai`, etc. Notice that, these URIs will only work if we tagged our servers appropriately (i.e., with `ssh0`, `ssh-b`, etc).

To connect through the tunnel from your machine, install `cloudflared` locally and add as many of the following entries to your `~/.ssh/config` as there are servers (don't forget to replace `ssh0` by the appropriate tag):

```
Host ssh0.dalhe.ai
  ProxyCommand /opt/homebrew/bin/cloudflared access ssh --hostname %h
  IdentityFile <path to the ssh private key>
```

In the event that a server is destroyed, pulumi correctly takes down the tunnels that were linked to it.

### Required flags:

| Flag | Purpose |
| --- | --- |
| `--pulumi-access-token` | authenticates the container with Pulumi Cloud so the program can `pulumi login` non-interactively. It must have |
| permissions to operate on the `prod` stack. |
| `--cloudflare-api-token` | authorises changes to the target Cloudflare zone. It must have `Zone` → `DNS` → `Edit`, `Zone` → `SSL and Certificates` → `Edit`, `Zone` → `Zone Settings` → `Edit`, and `Account` → `Cloudflare Tunnel` → `Edit` permissions for the dalhe.ai zone (Manage Account → Account API Tokens). |
| `--digital-ocean-api-key` | is exported as `DIGITAL_OCEAN_API_KEY` and used by `doctl` to look up droplet details. It must have permission to list droplets. |
| `--ssh-key`| absolute path to the private key that can SSH into the production servers. The script bind-mounts this key into the Pulumi container at `/root/.ssh/ssh_dalhe_ai` so destroy operations can stop remote `cloudflared` daemons. |

### Optional flags:

| Flag | Purpose |
| --- | --- |
| `--command` | controls the Pulumi action (`up` by default). Supported values are `up` to apply infrastructure changes and `refresh` to reconcile the state without deploying. |

## Components

- `run.sh` ensures the required API tokens are provided, builds the
  `dalhe_pulumi` Docker image, and starts a container with those credentials.
- `image/` holds the Pulumi project.
- `image/entrypoint.sh` runs inside the container. It validates the environment
  variables and executes pulumi.
- `image/Pulumi.<stack>.yaml` specifies stack-specific configuration values, such as the domain and cloudflare accountId.
- `image/providers/` hosts the services that discovers our infrastructure, such as the cloudflare zone id.
- `image/resources/` defines the record components at our disposal for provisioning resources.

## Prerequisites

- Docker installed locally (the script builds and runs a container).

## Current Limitations

- Only the `prod` stack is wired up; adding more stacks will require code and
  configuration changes.
