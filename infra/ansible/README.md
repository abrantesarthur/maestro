# Ansible Provisioning

This directory contains the Ansible automation that provisions resources in a server.

## Workflow

Run `./run.sh` with the required flags. The script validates required inputs and ensures `ansible-builder`/`ansible-navigator` exist before doing any work. Then, it builds the execution environment image, and uses `ansible-navigator` to run the container.

After secrets are in place, `run.sh` builds the execution environment image via `ansible-builder` and then provisions the ansible playbooks.

## Components

### Roles and Playbooks

- **`roles/groups`** creates every group listed in `roles/groups/vars/main.yml` while allowing system groups (root, nogroup, etc.) to remain untouched.

`playbooks` consume these roles via `groups.yml` and actually provisions them.

### Inventory, Hosts, and Groups

`inventory/hosts.yml` defines two hosts under `all`:

- `prod_server` resolves to `ssh.dalhe.ai` and uses the mounted SSH key plus the baked-in Cloudflare proxy command to connect to the server.

## Prerequisites

- Docker installed locally (the script builds and runs a container).
- The `ansible-builder` and `ansible-navigator` programs must be installed.
- The ansible execution environment's SSH behavior is controlled by `execution_environment/files/ssh_config`. That file declares a `Host ssh.dalhe.ai` stanza with a `cloudflared access ssh` proxy command and the expected identity file path. It is critical that this hostname matches the one Pulumi provisions (`dalhe:tunnelHostname` in `infra/pulumi/image/Pulumi.prod.yaml`, currently `ssh.dalhe.ai`). If you ever change the tunnel hostname in Pulumi, update both the SSH config file and the inventory entry simultaneously to keep Ansible, Cloudflare, and Pulumi aligned.

## Idempotence

All playbooks are idempotent. Running them repeatedly will either make changes (if drift is detected) or do nothing (if the server already matches the declared state).

## Future improvements
- right now we only support provisioning resources in a single production server. In the future, we should suppport multiple environments and servers.

## TODO
- find a way to update the `execution_environment/files/ssh_config` files so that we have every provisioned server (e.g., ssh-a, ssh-b, etc)