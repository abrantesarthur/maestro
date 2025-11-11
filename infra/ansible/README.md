# Ansible Provisioning

This directory contains the Ansible automation that provisions resources, such as an ssh tunnel and linux groups, in our production server.

## Workflow

Run `./run.sh` with the required flags. The script validates required inputs and ensures `ansible-builder`/`ansible-navigator` exist before doing any work. Then, it retrieves the cloudflare tunnel token, builds the execution environment image, and uses `ansible-navigator` to run the container.

### Required flags

| Flag | Purpose |
| --- | --- |
| `--prod-server-ip` | Public IPv4 address of the droplet. Stored in `PROD_SERVER_IP` and forwarded into the execution environment so the inventory's `prod_server_direct` host can resolve. |
| `--cloudflare-tunnel-id` | Identifies the tunnel whose token we need to probision `cloudflared`. |
| `--cloudflare-account-id` | Used together with the tunnel ID/API key to call the Cloudflare API for a one-time tunnel token. |
| `--cloudflare-api-key` | Bearer token with permission to read tunnel credentials. |

After secrets are in place, `run.sh` builds the execution environment image via `ansible-builder` and then provisions the ansible playbooks.

## Components

### Roles and Playbooks

- **`roles/cloudflared`** enables the `cloudflared` daemon that connects our server to Cloudflare's network, enabling us to ssh via a hostname. We use the `CLOUDFLARE_TUNNEL_TOKEN` to establish this connection.
- **`roles/groups`** creates every group listed in `roles/groups/vars/main.yml` while allowing system groups (root, nogroup, etc.) to remain untouched.

`playbooks` consume these roles via `cloudflared.yml` and `groups.yml` and actually provisions them.

### Inventory, Hosts, and Groups

`inventory/hosts.yml` defines two hosts under `all`:

- `prod_server_direct` talks to the raw IP exposed via the `--prod-server-ip` flag. This host is only used for provisioning cloudflared.
- `prod_server` resolves to `ssh.dalhe.ai` and uses the mounted SSH key plus the baked-in Cloudflare proxy command to connect to the server.

## Prerequisites

- Docker installed locally (the script builds and runs a container).
- The `ansible-builder` and `ansible-navigator` programs must be installed.
- The ansible execution environment's SSH behavior is controlled by `execution_environment/files/ssh_config`. That file declares a `Host ssh.dalhe.ai` stanza with a `cloudflared access ssh` proxy command and the expected identity file path. It is critical that this hostname matches the one Pulumi provisions (`dalhe:tunnelHostname` in `infra/pulumi/image/Pulumi.prod.yaml`, currently `ssh.dalhe.ai`). If you ever change the tunnel hostname in Pulumi, update both the SSH config file and the inventory entry simultaneously to keep Ansible, Cloudflare, and Pulumi aligned.

## Idempotence

All playbooks are idempotent. Running them repeatedly will either make changes (if drift is detected) or do nothing (if the server already matches the declared state).

## Future improvements
- right now we only support provisioning resources in a single production server. In the future, we should suppport multiple environments.