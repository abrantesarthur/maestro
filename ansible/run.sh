#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPERS_PATH="$(cd -- "${SCRIPT_DIR}/.." && pwd)/helpers.sh"

# import helper functions
source "$HELPERS_PATH"

log() {
  echo "[maestro/ansible] $*"
}
require_cmd() {
  require_command log "$@"
}
require_var() {
  require_variable log "$@"
}
require_f() {
  require_file log "$@"
}
require_bws_var() {
  require_bws_variable log "$@"
}

usage() {
  cat <<EOF
Usage: $(basename "$0")
Options:
  -h, --help                       Show this message.
  --ssh-hosts <json>               json with list of hostname and tags (e.g., --ssh-hosts {"hosts":[{"hostname":"ssh0.dalhe.ai","tags":["backend","prod","web"]}]}) (required)
  --website-dir <path>             Path to the website source directory (required unless --skip-web)
  --skip-bws                       Skip fetching secrets from Bitwarden Secrets Manager
  --skip-web                       Skip provisioning web server
  --skip-backend                   Skip provisioning backend
  --skip-perms                     Skip provisioning permissions
EOF
}

# require needed flags
SSH_HOSTS_ARG=""
WEBSITE_DIR=""
SKIP_BWS=false
SKIP_WEB=false
SKIP_BACKEND=false
SKIP_PERMS=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --ssh-hosts)
      [[ -n "${2:-}" ]] || { log "Missing value for $1." >&2; exit 1; }
      SSH_HOSTS_ARG="$2"
      shift 2
      ;;
    --website-dir)
      [[ -n "${2:-}" ]] || { log "Missing value for $1." >&2; exit 1; }
      WEBSITE_DIR="$2"
      shift 2
      ;;
    --skip-bws)
      SKIP_BWS=true
      shift 1
      ;;
    --skip-web)
      SKIP_WEB=true
      shift 1
      ;;
    --skip-backend)
      SKIP_BACKEND=true
      shift 1
      ;;
    --skip-perms)
      SKIP_PERMS=true
      shift 1
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      exit 1
      ;;
  esac
done

log "Ensuring required files..."
EE_DEFINITION_FILE="${SCRIPT_DIR}/execution_environment/execution-environment.yml"
WEBSITE_BUILD_SCRIPT="${SCRIPT_DIR}/scripts/build_website.sh"
require_f "${EE_DEFINITION_FILE}" "execution environment definition not found at ${EE_DEFINITION_FILE}."
require_f "${WEBSITE_BUILD_SCRIPT}" "website build script not found at ${WEBSITE_BUILD_SCRIPT}."

log "Ensuring required flags..."
require_var "${SSH_HOSTS_ARG}" '--ssh-hosts must be provided with at least one hostname.'
if [[ "${SKIP_WEB}" == "false" ]]; then
  require_var "${WEBSITE_DIR}" '--website-dir is required when building website (use --skip-web to skip).'
fi

log "Ensuring required configuration from environment..."
# Configuration is passed via environment variables from parent run.sh
require_var "${DOMAIN-}" 'DOMAIN environment variable is required (set in maestro.yaml).'
require_var "${BACKEND_PORT-}" 'BACKEND_PORT environment variable is required (set in maestro.yaml).'

if [[ "${SKIP_BWS}" == "false" ]]; then
  log "Fetching secrets from Bitwarden..."
  source_bws_secrets
else
  log "Skipping fetch of secrets from Bitwarden..."
fi

log "Ensuring required secrets..."
require_bws_var 'GHCR_TOKEN'
require_bws_var 'GHCR_USERNAME'
require_bws_var 'VPS_SSH_KEY'

log "Ensuring ansible-builder and ansible-navigator are installed..."
if ! command -v ansible-builder >/dev/null 2>&1 || ! command -v ansible-navigator >/dev/null 2>&1; then
  log "ansible-builder not found; installing Ansible tooling via pip..."

  if command -v pip3 >/dev/null 2>&1; then
    PIP_CMD="pip3"
  elif command -v pip >/dev/null 2>&1; then
    PIP_CMD="pip"
  elif command -v python3 >/dev/null 2>&1; then
    PIP_CMD="python3 -m pip"
  elif command -v python >/dev/null 2>&1; then
    PIP_CMD="python -m pip"
  else
    log "pip is not installed; cannot bootstrap Ansible tooling." >&2
    exit 1
  fi

  if ! ${PIP_CMD} install --user ansible-navigator ansible-runner >/dev/null; then
    log "failed to install Ansible tooling via pip." >&2
    exit 1
  fi

  hash -r

  if ! command -v ansible-builder >/dev/null 2>&1 || ! command -v ansible-navigator >/dev/null 2>&1; then
    log "ansible-builder/ansible-navigator are still not available on PATH. Ensure your pip user bin directory (e.g., ~/.local/bin) is in PATH." >&2
    exit 1
  fi
fi


WEBSITE_ASSETS_DIR="${SCRIPT_DIR}/execution_environment/files/website"
if [[ "${SKIP_WEB}" == "false" ]]; then
  log "Building website assets for Ansible execution environment..."
  "${WEBSITE_BUILD_SCRIPT}" --website-dir "${WEBSITE_DIR}" --output-dir "${WEBSITE_ASSETS_DIR}" >/dev/null;
else
  log "Skipping building website assets for Ansible execution environment; creating empty directory..."
  rm -rf "${WEBSITE_ASSETS_DIR}"
  mkdir -p "${WEBSITE_ASSETS_DIR}"
fi


log "Building Ansible execution environment image 'ansible_ee'..."
pushd "${SCRIPT_DIR}" >/dev/null
ansible-builder build \
  --container-runtime "docker" \
  --tag "ansible_ee" \
  -f "${EE_DEFINITION_FILE}" 

# write Bitwarden-provided SSH key to a secure temp file for mounting into the container
SSH_KEY_TEMP_FILE="$(create_temp_secret_file VPS_SSH_KEY)"
trap 'rm -f "${SSH_KEY_TEMP_FILE}"' EXIT

# helper to run ansible playbooks with shared environment
CONTAINER_SSH_KEY_PATH="/tmp/vps_ssh_key"
run_playbook() {
  local playbook="$1"
    ansible-navigator run \
    "playbooks/${playbook}" \
    "--container-options=-v=${SSH_KEY_TEMP_FILE}:${CONTAINER_SSH_KEY_PATH}:ro"
}

# Export variables for Ansible inventory and playbooks
# SSH_HOSTS and SSH_KEY_PATH are used by the dynamic inventory (inventory/hosts.py)
export SSH_HOSTS="${SSH_HOSTS_ARG}"
export SSH_KEY_PATH="${CONTAINER_SSH_KEY_PATH}"

# DOMAIN and BACKEND_PORT are already in environment from parent run.sh
# BACKEND_ENV_* variables are already exported by parent run.sh

# Validate backend image configuration when deploying backend
if [[ "${SKIP_BACKEND}" == "false" ]]; then
  require_var "${BACKEND_IMAGE:-}" 'BACKEND_IMAGE is required when deploying backend (set in maestro.yaml).'
  require_var "${BACKEND_IMAGE_TAG:-}" 'BACKEND_IMAGE_TAG is required when deploying backend (set in maestro.yaml).'
fi
# Export for Ansible even if empty (will be validated above when needed)
export BACKEND_IMAGE="${BACKEND_IMAGE:-}"
export BACKEND_IMAGE_TAG="${BACKEND_IMAGE_TAG:-}"


if [[ "${SKIP_WEB}" == "false" ]]; then
  log "Provisioning web server..."
  run_playbook "web.yml"
else
  log "Skipping provisioning web server..."
fi

if [[ "${SKIP_BACKEND}" == "false" ]]; then
  log "Provisioning backend..."
  run_playbook "backend.yml"
else
  log "Skipping provisioning backend..."
fi

if [[ "${SKIP_PERMS}" == "false" ]]; then
  log "Provisioning permissions..."
  run_playbook "perms.yml"
else
  log "Skipping provisioning permissions..."
fi

# we recommend running this playbook last because it may block connections to the server.
popd >/dev/null

log "Done."
