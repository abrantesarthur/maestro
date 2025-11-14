# Ansible Provisioning

This directory contains the Ansible automation that provisions resources in a server.

## Workflow

Run `./run.sh --ssh-hostnames <list>` with the required flags. The script validates required inputs and ensures `ansible-builder`/`ansible-navigator` exist before doing any work. Then, it builds the execution environment image, and uses `ansible-navigator` to run the container.

After secrets are in place, `run.sh` builds the execution environment image via `ansible-builder` and then provisions the ansible playbooks.

## Required Flags

| Flag | Purpose |
| --- | --- |
| `--ssh-hostnames` | Comma-separated list of SSH tunnel hostnames to target (e.g., `ssh-a.dalhe.ai,ssh-b.dalhe.ai`). |
| `--ssh-key` | Absolute path to the host SSH private key that should be mounted into the execution environment to provide access to the remote servers. |

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

## Idempotence

All playbooks are idempotent. Running them repeatedly will either make changes (if drift is detected) or do nothing (if the server already matches the declared state).

## Future improvements
- right now there is no distinction between servers. We should support different provisionings for different kinds of servers (e.g. web servers, backend servers. etc). This way, we can provision nginx only on servers with the website.
