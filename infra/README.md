# Infra

Infrastructure-as-code and operations tooling for the dalhe.ai stack live here. Each component stays in its own subdirectory with dedicated documentation and deployment scripts.

## Workflow

`run.sh` is an orchestration script that wires the Pulumi and Ansible provisioning into a single command.

```bash
./run.sh
```

### Required env:

| Variable           | Purpose                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BWS_ACCESS_TOKEN` | Bitwarden Secrets Manager's token required for retrieving other secrets.                                                                                     |
| `BWS_PROJECT_ID`   | The id of the Bitwarden Secrets Manager's project from which to draw secrets. It defaults to the value of the BWS_PROD_INFRA_PROJECT_ID environment variable |

## Required flags

## Optional Flags

| Flag             | Purpose                                       |
| ---------------- | --------------------------------------------- |
| `--skip-pulumi`  | Skips running the Pulumi stack.               |
| `--skip-ansible` | Skips the Ansible provisioning step entirely. |

## Components

- `pulumi/` — Pulumi programs for provisioning Cloudflare DNS and related cloud resources.
- `ansible/` — Ansible execution environment, inventories, and playbooks that configures the servers (e.g., nginx, groups, etc).

## Working In This Folder

- Make changes inside the relevant component directory following its README.
- Keep commits scoped to a single infrastructure component to simplify rollbacks.

## FIXME:

- explain the purpose of the .env file
- rename the Pulumi.yaml name to something other than cloudflared, as it includes digital ocean resources as well.
