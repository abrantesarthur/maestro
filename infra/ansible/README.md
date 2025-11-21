# Ansible Provisioning

This directory contains the Ansible automation that provisions resources in a server.

## Workflow

Run `./run.sh --hosts <list>` with the required flags. The script validates required inputs and ensures `ansible-builder`/`ansible-navigator` exist before doing any work. Then, it builds the execution environment image, and uses `ansible-navigator` to run the container.

After secrets are in place, `run.sh` builds the execution environment image via `ansible-builder` and then provisions the ansible playbooks.

## Required Flags

| Flag | Purpose |
| --- | --- |
| `--hosts` | A JSON list of hosts and their tags (e.g., {"hosts":[{"hostname":"ssh0.dalhe.ai","tags":["backend","prod"]}]}). Tags on each host become Ansible inventory groups, that playbooks can target. For instance, we can decide to provision nginx only on hosts tagged with `web`. |
| `--ssh-key` | Absolute path to the host SSH private key that should be mounted into the execution environment to provide access to the remote servers. |

## Components

### Roles and Playbooks

- **`roles/groups`** creates every group listed in `roles/groups/vars/main.yml` while allowing system groups (root, nogroup, etc.) to remain untouched.

`playbooks` consume these roles via `groups.yml` and actually provisions them.

### Inventory, Hosts, and Groups

The dynamic inventory (`inventory/hosts.py`) reads the HOSTS JSON provided to `run.sh` and builds:
- `all` hosts with common vars (including the Cloudflare proxy SSH args).
- One group per tag listed on each host, so you can target plays to all `backend`, `prod`, `web`, etc. hosts by tag.

## Prerequisites

- Docker installed locally (the script builds and runs a container).
- The `ansible-builder` and `ansible-navigator` programs must be installed.

## Idempotence

All playbooks are idempotent. Running them repeatedly will either make changes (if drift is detected) or do nothing (if the server already matches the declared state).

## Future improvements
- right now there is no distinction between servers. We should support different provisionings for different kinds of servers (e.g. web servers, backend servers. etc). This way, we can provision nginx only on servers with the website.
