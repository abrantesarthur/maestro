# Nginx Deployment Scripts

This directory contains automation for pushing the nginx configuration to the production server. The workflow consists of a local step (`deploy.sh`) that copies the configuration files to the remote server, and a remote step (`remote/apply.sh`) that is executed automatically on the server to validate and activate the new configuration.

## Prerequisites
- Required binaries on your workstation: `ssh`, `rsync`, `ssh-agent`, and `ssh-add`.
- SSH access to the target host with sudo privileges to write under `/etc/nginx`.
- The private key file that grants access to the target server.
- Environment variables exported in your shell session:
  - `REMOTE_HOST` – server IP or hostname (e.g., `203.0.113.10`).
  - `REMOTE_USER` – SSH user with permissions to manage nginx (e.g., `root`).
  - `SSH_PK_FILE` – path to the SSH private key that should be loaded into `ssh-agent`.

## Deploying
1. Start a fresh shell session on your workstation (not inside a container or VM).
2. Export the required environment variables. Example:
   ```bash
   export REMOTE_HOST=203.0.113.10
   export REMOTE_USER=admin
   export SSH_PK_FILE=~/.ssh/dalheai_nginx
   ```
3. From the repository root, run:
   ```bash
   infra/nginx/scripts/deploy.sh
   ```
   The script loads your private key into `ssh-agent`, syncs `nginx.conf` and the site configurations to `/tmp/nginx` on the remote host via `rsync`, uploads `remote/apply.sh`, and executes it over SSH.
4. The remote script validates the configuration with `nginx -t`, reloads nginx via `systemctl reload nginx`, and removes stale backups. Watch the log output for any reported errors.

## Recovery
- If `nginx -t` fails, the remote script restores the previous configuration using the backup files created by `install`. Investigate the error, fix the local configuration, and rerun the deployment.
