# Nginx Infrastructure

This directory contains the nginx configuration and the automation needed to publish it to the production host.

## Configuration Layout
- `nginx.conf` — base nginx configuration shared across every site deployed on the server. It sets common directives, logging, and includes site-specific configs.
- `sites-available/` — per-site configuration files. `dalhe.ai.conf` defines the reverse proxy setup for the dalhe.ai application, including upstream definitions and TLS handling. Copy additional site configs here when expanding the platform.

Keep site configs small by extracting shared directives into `nginx.conf` where possible.

## Deployment Scripts
- `scripts/deploy.sh` — runs locally. Loads your SSH key, syncs the configuration bundle to the remote host over `rsync`, and kicks off the remote apply step.
- `scripts/remote/apply.sh` — runs on the remote server. Installs the synced files into `/etc/nginx`, validates them with `nginx -t`, reloads nginx, and cleans up backups if validation succeeds.
- `scripts/README.md` — detailed usage notes and prerequisites for the deployment workflow.

Trigger deployments from the repository root by executing `infra/nginx/scripts/deploy.sh` after exporting the required environment variables described in the scripts README file.

## Updating The Setup
1. Modify `nginx.conf` or the relevant file under `sites-available/`.
2. Run the deployment script to push the updates live.
3. Monitor nginx logs on the server to confirm the changes behave as expected.

Backups are managed automatically by the remote apply script, so a failed validation rolls the configuration back to the previous revision. See the `./scripts/remote/apply.sh` file for rollback the implementation.
