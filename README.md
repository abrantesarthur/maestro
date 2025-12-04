# Maestro

## Workflow

`run.sh` is an orchestration script that wires the Pulumi and Ansible provisioning into a single command.

```bash
./run.sh
```

### Required env:

| Variable           | Purpose                                                                  |
| ------------------ | ------------------------------------------------------------------------ |
| `BWS_ACCESS_TOKEN` | Bitwarden Secrets Manager's token required for retrieving other secrets. |

### Optional env:

| Variable            | Purpose                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `BWS_PROJECT_ID`    | The id of the Bitwarden Secrets Manager's project from which to draw secrets. If omitted, we fetch secrets from every project. |
| `BWS_REQUIRED_VARS` | Comma-separated list of BWS secret names to validate (e.g., `MY_API_KEY,DATABASE_PASSWORD`). Validated before provisioning.    |

## Required flags

## Optional Flags

| Flag                   | Purpose                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| `--skip-pulumi`        | Skips running the Pulumi stack.                                    |
| `--skip-ansible`       | Skips the Ansible provisioning step entirely.                      |
| `--skip-bws`           | Whether to skip pulling secrets from Bitwarden Secrets Manager     |
| `--website-dir <path>` | Path to the website source directory (required unless --skip-web). |
| `--skip-web`           | Whether to skip provisioning web.                                  |
| `--skip-backend`       | Whether to skip provisioning backend.                              |
| `--skip-perms`         | Whether to skip provisioning perms.                                |

## Components

- `pulumi/` — Pulumi programs for provisioning Cloudflare DNS and related cloud resources.
- `ansible/` — Ansible execution environment, inventories, and playbooks that configures the servers (e.g., nginx, groups, etc).

## Working In This Folder

- Make changes inside the relevant component directory following its README.
- Keep commits scoped to a single infrastructure component to simplify rollbacks.
