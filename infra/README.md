# Infra

Infrastructure-as-code and operations tooling for the dalhe.ai stack live here. Each component stays in its own subdirectory with dedicated documentation and deployment scripts.

## Workflow

`run.sh` is an orchestration script that wires the DigitalOcean server bootstrapper, the Pulumi Cloudflare stack, and the Ansible playbooks into a single command.

```bash
./run.sh \
  --digital-ocean-api-key "$DIGITAL_OCEAN_API_KEY" \
  --pulumi-access-token "$PULUMI_ACCESS_TOKEN" \
  --cloudflare-api-token "$CLOUDFLARE_API_TOKEN" \
  --ssh-key "$HOME/.ssh/ssh_dalhe_ai"
```

## Required flags

| Flag | Purpose |
| --- | --- |
| `--digital-ocean-api-key` | Token with permission to list SSH keys, create droplets, list droplets, and destroy droplets. |
| `--pulumi-access-token` | Pulumi Cloud access token that can log into and mutate the `prod` stack. |
| `--cloudflare-api-token` | Cloudflare token with `Zone → DNS → Edit` and `Account → Cloudflare Tunnel → Edit` permissions for the dalhe.ai account. |
| `--ssh-key` | Path to the SSH private key that can reach every server. The same key is bind-mounted inside both the Pulumi and Ansible containers. |

## Optional Flags

| Flag | Purpose |
| --- | --- |
| `--skip-server` | Skips provisioning new DigitalOcean droplets. |
| `--skip-pulumi` | Skips running the Pulumi stack. |
| `--skip-ansible` | Skips the Ansible provisioning step entirely. |

## Components

- `server/` — Dockerized bootstrapper (see `server/run.sh` + `config.env`) that creates virtual servers.
- `pulumi/` — Pulumi programs for provisioning Cloudflare DNS and related cloud resources.
- `ansible/` — Ansible execution environment, inventories, and playbooks that configures the servers (e.g., nginx, groups, etc).

## Working In This Folder

- Make changes inside the relevant component directory following its README.
- Keep commits scoped to a single infrastructure component to simplify rollbacks.

### Prerequisites

- The SSH private key passed via `--ssh-key` must already match a public key uploaded to DigitalOcean so both Pulumi (for remote commands) and Ansible can log into the droplets.