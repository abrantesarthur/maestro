# Pulumi Infrastructure

This directory contains a Dockerised Pulumi program that provisions the cloudflare environment. The program currently targets the single `prod` stack.

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

1. Docker installed locally (the script builds and runs a container).
2. Pulumi access token from https://app.pulumi.com/user/settings/tokens with
   permissions to operate on the `prod` stack.
3. Cloudflare API token with at least `Zone` → `DNS` → `Edit` and `Account` → `Cloudflare Tunnel` → `Edit` permissions for the dalhe.ai zone (Manage Account → Account API Tokens).
4. DigitalOcean API key that can list droplets (`doctl` uses it to enumerate
   servers).

## Usage

Run the helper script from `infra/pulumi`:

```bash
./run.sh \
  --pulumi-access-token "$PULUMI_ACCESS_TOKEN" \
  --cloudflare-api-token "$CLOUDFLARE_API_TOKEN" \
  --digital-ocean-api-key "$DIGITAL_OCEAN_API_KEY" \
  [--command up|refresh] \
  [--prod-ipv4s '["123.45.678.00","123.45.678.01"]']
```

When you run the script it:

- validates that all required flags are present.
- rebuilds the `dalhe_pulumi` Docker image so the container picks up any code or
  dependency changes;
- starts a disposable container that executes the Pulumi entrypoint with the
  provided credentials exposed as environment variables.

### Required flags:

- `--pulumi-access-token` authenticates the container with Pulumi Cloud so the
  program can `pulumi login` non-interactively.
- `--cloudflare-api-token` authorises changes to the target Cloudflare zone.
- `--digital-ocean-api-key` is exported as `DIGITAL_OCEAN_API_KEY` and used by
  `doctl` to look up droplet details.

### Optional flags:

- `--command` controls the Pulumi action (`up` by default). Supported values are
  `up` to apply infrastructure changes and `refresh` to reconcile the state
  without deploying.
- `--prod-ipv4s` accepts a JSON array of IPv4 addresses (for example
  `'["123.45.678.00","123.45.678.01"]'`). If provided, Pulumi
  creates DNS records only for the supplied servers. Otherwise, it creates records for every server it can find.

## What the Container Does

1. `entrypoint.sh` validates all required environment variables.
2. Pulumi logs in to the managed service using the supplied access token.
3. The TypeScript program provisions Cloudflare resources, including DNS records and an SSH tunnel into `ssh.dalhe.ai`.
4. To connect through the tunnel from your machine, install `cloudflared` locally and add the following to your `~/.ssh/config`:

   ```
   Host ssh.dalhe.ai
     ProxyCommand /opt/homebrew/bin/cloudflared access ssh --hostname %h
     IdentityFile <path to the ssh private key>
   ```

## Current Limitations

- Only the `prod` stack is wired up; adding more stacks will require code and
  configuration changes.
