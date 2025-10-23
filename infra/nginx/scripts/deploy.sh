#!/usr/bin/env bash
# Use bash located via env so the script runs on systems where bash is not in /bin.

#####################################################################
####  Important: run this script directly in the host with the ssh private key!
####  Important: REMOTE_USER must have sufficient permission in the server (e.g., to write to /etc/nginx)
####  TODO: create a group of users in the server that have permission to write to 
####        /etc/tmp and /etc/nginx.
####  TODO: link private keys to users. This way, a user is only able to log in as
####        root if it also has root's private key!
####  
####  Required env vars
####    - REMOTE_HOST: The remote server's IP address (e.g., REMOTE_HOST=203.0.11.10)
####    - REMOTE_USER: The user to log into the remote server (e.g., REMOTE_USER=root)
####    - SSH_PK_FILE: The file from which the ssh private key is read (added to ssh-agent).
####
#####################################################################

# Exit when any command fails, when vars are unset, or when pipelines fail.
set -euo pipefail

# Function to check that an environment variable is set.
require_env_var() {
  local env_var_name="$1"
  if [[ -z "${!env_var_name:-}" ]]; then
    echo "Missing the ${env_var_name} environment variable." >&2
    exit 1
  fi
}

# Function to check if a binary is installed.
require_binary() {
  local binary_name="$1"
  if ! command -v "${binary_name}" >/dev/null 2>&1; then
    echo "${binary_name} not found. Install it locally to deploy nginx configs." >&2
    exit 1
  fi
}

# Ensure the required binaries are installed
require_binary ssh
require_binary rsync
require_binary ssh-add

# Ensure the required environment variables are set
require_env_var "REMOTE_HOST"
require_env_var "REMOTE_USER"
require_env_var "SSH_PK_FILE"

# Creates an array with the SSH command.
REMOTE="${REMOTE_USER}@${REMOTE_HOST}"
SSH_CMD=(ssh "${REMOTE}")

# Start the ssh-agent register a trap to kill it when this script exits.
eval "$(ssh-agent -s)" >/dev/null
cleanup_ssh_agent() {
  if [[ -n "${SSH_AGENT_PID:-}" ]]; then
    kill "${SSH_AGENT_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup_ssh_agent EXIT

# Resolve the absolute path to directory with script to deploy nginx.
DEPLOY_NGINX_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# Resolve the absolute path to directory with script to apply nginx.
APPLY_NGINX_DIR="${DEPLOY_NGINX_DIR}/remote/apply.sh"
# Resolve the absolute path to the nginx config directory.
NGINX_DIR="$(cd "${DEPLOY_NGINX_DIR}/.." && pwd -P)"

# load the private key into memory
ssh-add "${SSH_PK_FILE}" >/dev/null 2>&1

# Register a cleanup to remove the stagin directory when the script exits.
cleanup() {
  "${SSH_CMD[@]}" "rm -rf '${REMOTE_STAGING_DIR}'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Create a clean staging directory on the remote host.
REMOTE_STAGING_DIR="/tmp/nginx"
echo "Creating staging directories to sync nginx configuration files to server..."
"${SSH_CMD[@]}" "rm -rf '${REMOTE_STAGING_DIR}' && mkdir -p '${REMOTE_STAGING_DIR}/sites-available'" >/dev/null

# Function to sync a file to the remote nginx staging directory
sync_nginx_file() {
  # get the function argument with the local file's relative path
  local relative_path="$1"
  # Compute absolute paths.
  local local_path="${NGINX_DIR}/${relative_path}"
  local remote_path="${REMOTE_STAGING_DIR}/${relative_path}"
  # Ensure the local file actually exists.
  if [[ ! -f "${local_path}" ]]; then
    echo "Missing ${local_path}; aborting." >&2
    exit 1
  fi
  # Transfer to remote staging directory.
  echo "  > ${relative_path}"
  rsync -avz "${local_path}" "${REMOTE}:${remote_path}" >/dev/null
}

# Global nginx configuration file.
NGINX_GLOBAL_CONFIG="nginx.conf"
# Site-specific nginx configuration files
NGINX_SITES_CONFIG=(
  "dalhe.ai.conf"
)

# send the nginx global config and site-specific configs
echo "Syncing nginx configuration files to server..."
sync_nginx_file "${NGINX_GLOBAL_CONFIG}"
for nginx_site_config in "${NGINX_SITES_CONFIG[@]}"; do
  sync_nginx_file "sites-available/${nginx_site_config}"
done

# send the apply script and make it executable
APPLY_NGINX_REMOTE_DIR="${REMOTE_STAGING_DIR}/apply.sh"
echo "  > apply.sh" 
rsync -avz "${APPLY_NGINX_DIR}" "${REMOTE}:${APPLY_NGINX_REMOTE_DIR}" >/dev/null
"${SSH_CMD[@]}" "chmod +x '${APPLY_NGINX_REMOTE_DIR}'"

# # Inform the user that the remote apply step is beginning.
echo "Running apply.sh on remote server..."

# Execute the prepared remote command via ssh using the helper script.
remote_env=(
  "REMOTE_STAGING_DIR=${REMOTE_STAGING_DIR}"
  "REMOTE_TARGET_DIR=/etc/nginx"
  "NGINX_CONFIG=${NGINX_GLOBAL_CONFIG}"
  "NGINX_SITES_CONFIG=${NGINX_SITES_CONFIG[*]}"
)
"${SSH_CMD[@]}" "${remote_env[*]} '${APPLY_NGINX_REMOTE_DIR}'"

# Report successful completion to the user.
echo "Deployment complete!"
