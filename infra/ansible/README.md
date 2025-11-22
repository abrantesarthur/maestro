# Ansible Provisioning

This directory contains the Ansible automation that provisions resources in a server.

## Workflow

Run `./run.sh --ssh-hosts <list>` with the required flags. The script validates required inputs and ensures `ansible-builder`/`ansible-navigator` exist before doing any work. Then, it builds the execution environment image, and uses `ansible-navigator` to run the container.

After secrets are in place, `run.sh` builds the execution environment image via `ansible-builder` and then provisions the ansible playbooks.
It assumes the backend application image has already been built and pushed to GHCR under the tag you provide.

## Required Flags

| Flag          | Purpose                                                                                                                                                                                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--ssh-hosts` | A JSON list of hosts and their tags (e.g., {"hosts":[{"hostname":"ssh0.dalhe.ai","tags":["backend","prod"]}]}). Tags on each host become Ansible inventory groups, that playbooks can target. For instance, we can decide to provision nginx only on hosts tagged with `web`. |
| `--ssh-key`   | Absolute path to the host SSH private key that should be mounted into the execution environment to provide access to the remote servers.                                                                                                                                      |

## Required Environment

| Variable                         | Purpose                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `GHCR_TOKEN`                     | GitHub token used to authenticate against GHCR when pulling the backend image (must include `read:packages`). |
| `GHCR_USERNAME` / `GITHUB_ACTOR` | Username for GHCR login. `GHCR_USERNAME` overrides; otherwise `GITHUB_ACTOR` must be set.                     |

## Optional Environment

| Variable            | Purpose                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `BACKEND_IMAGE`     | Image reference pulled by Ansible; defaults to `ghcr.io/dalhe-ai/backend`.                       |
| `BACKEND_IMAGE_TAG` | Tag pulled/deployed; defaults to `latest` (override with a CI tag/SHA for reproducible deploys). |

## Ports

- Web server (nginx): 443 (TLS entrypoint for domains dalhe.ai website).

## Components

### Roles and Playbooks

Roles:

- **roles/groups**: manages system groups from `roles/groups/vars/main.yml`.
- **roles/docker**: installs and enables the Docker engine and Python bindings.
- **roles/nginx**: installs and configures nginx for the web tier.
- **roles/backend_app**: logs into GHCR, pulls the tagged backend image, and runs the backend container in port 3000 by default.

Playbooks:

- **perms.yml**: applies group/permission management.
- **web.yml**: provisions the web tier (nginx).
- **backend.yml**: provisions backend hosts (Docker engine + backend_app).

### Inventory, Hosts, and Groups

The dynamic inventory (`inventory/hosts.py`) reads the SSH_HOSTS JSON provided to `run.sh` and builds:

- `all` hosts with common vars (including the Cloudflare proxy SSH args).
- One group per tag listed on each host, so you can target plays to all `backend`, `prod`, `web`, etc. hosts by tag.

## Prerequisites

- Docker installed locally (the script builds and runs a container).
- The `ansible-builder` and `ansible-navigator` programs must be installed.

## Idempotence

All playbooks are idempotent. Running them repeatedly will either make changes (if drift is detected) or do nothing (if the server already matches the declared state).

## Future improvements

- right now there is no distinction between servers. We should support different provisionings for different kinds of servers (e.g. web servers, backend servers. etc). This way, we can provision nginx only on servers with the website.

### Future Improvements

- limit IPs that can send requests to the server (e.g., only from cloudflare?)
- udpate nginx to forward requests from webhook.dalhe.ai to the port and preserves headers required by Meta (e.g., X-Hub-Signature-256).
- implement UFW policies
- implement cloudflare DNS records to forward requests to the webserver
