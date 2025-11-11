# Pulumi Infrastructure

This directory contains a Dockerised Pulumi program that provisions the cloudflare environment. The program currently targets the single `prod` stack.


## Workflow

Run the `run.sh` script. It validates that all required flags are present,  builds and runs a docker image that executes Pulumi up or refresh.

```bash
./run.sh \
  --pulumi-access-token "$PULUMI_ACCESS_TOKEN" \
  --cloudflare-api-token "$CLOUDFLARE_API_TOKEN" \
  --digital-ocean-api-key "$DIGITAL_OCEAN_API_KEY" \
  [--command up|refresh] \
  [--prod-server-ips '["123.45.678.00","123.45.678.01"]']
```

The Pulumi program provisions Cloudflare resources, including DNS records and an SSH tunnel into `ssh.dalhe.ai`. To connect through the tunnel from your machine, install `cloudflared` locally and add the following to your `~/.ssh/config`:

```
Host ssh.dalhe.ai
  ProxyCommand /opt/homebrew/bin/cloudflared access ssh --hostname %h
  IdentityFile <path to the ssh private key>
```

### Required flags:


| Flag | Purpose |
| --- | --- |
| `--pulumi-access-token` | authenticates the container with Pulumi Cloud so the program can `pulumi login` non-interactively.  It must have
   permissions to operate on the `prod` stack. |
| `--cloudflare-api-token` | authorises changes to the target Cloudflare zone. It must have `Zone` → `DNS` → `Edit` and `Account` → `Cloudflare Tunnel` → `Edit` permissions for the dalhe.ai zone (Manage Account → Account API Tokens). |
| `--digital-ocean-api-key` | is exported as `DIGITAL_OCEAN_API_KEY` and used by `doctl` to look up droplet details. It must have permission to list droplets.   |

### Optional flags:

| Flag | Purpose |
| --- | --- |
| `--command` | controls the Pulumi action (`up` by default). Supported values are `up` to apply infrastructure changes and `refresh` to reconcile the state without deploying.   |
| `--prod-server-ips` | accepts a JSON array of IPv4 addresses (for example `'["123.45.678.00","123.45.678.01"]'`). If provided, Pulumi creates DNS records only for the supplied servers. Otherwise, it creates records for every server it can find.   |

## Components

- `run.sh` ensures the required API tokens are provided, builds the
  `dalhe_pulumi` Docker image, and starts a container with those credentials.
- `image/` holds the Pulumi project.
- `image/entrypoint.sh` runs inside the container. It validates the environment
  variables and executes pulumi.
- `image/Pulumi.<stack>.yaml` specifies stack-specific configuration values, such as the domain and cloudflare accountId.
- `image/providers/` hosts the services that discovers our infrastructure, such as the server IPv4.
- `image/resources/` defines the record components at our disposal for provisioning resources.

## Prerequisites

- Docker installed locally (the script builds and runs a container).

## Current Limitations

- Only the `prod` stack is wired up; adding more stacks will require code and
  configuration changes.
