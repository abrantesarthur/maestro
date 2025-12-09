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
  --skip-bws                       Skip fetching secrets from Bitwarden Secrets Manager
  --skip-web                       Skip provisioning web server
  --skip-backend                   Skip provisioning backend

Web configuration is passed via environment variables:
  WEB_MODE                         Web mode: 'static' or 'docker'
  WEB_STATIC_SOURCE                Static source: 'local' or 'image'
  WEB_STATIC_DIR                   Local directory path (when source=local)
  WEB_STATIC_BUILD                 Build command (optional, when source=local)
  WEB_STATIC_DIST                  Dist subdirectory (default: dist)
  WEB_STATIC_IMAGE                 Container image (when source=image)
  WEB_STATIC_TAG                   Image tag (when source=image)
  WEB_STATIC_PATH                  Path inside container (when source=image)
  WEB_DOCKER_IMAGE                 Docker web app image (when mode=docker)
  WEB_DOCKER_TAG                   Docker web app tag (when mode=docker)
  WEB_DOCKER_PORT                  Docker web app port (when mode=docker)

Security configuration is passed via environment variables:
  MANAGED_GROUPS                   JSON array of groups to manage (default: ["devops"])
EOF
}

# require needed flags
SSH_HOSTS_ARG=""
SKIP_BWS=false
SKIP_WEB=false
SKIP_BACKEND=false
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

# Validate web configuration from environment variables
if [[ "${SKIP_WEB}" == "false" ]]; then
  require_var "${WEB_MODE-}" 'WEB_MODE environment variable is required when web provisioning is enabled.'
  
  if [[ "${WEB_MODE}" == "static" ]]; then
    require_var "${WEB_STATIC_SOURCE-}" 'WEB_STATIC_SOURCE is required for static mode.'
    if [[ "${WEB_STATIC_SOURCE}" == "local" ]]; then
      require_var "${WEB_STATIC_DIR-}" 'WEB_STATIC_DIR is required when source is local.'
    elif [[ "${WEB_STATIC_SOURCE}" == "image" ]]; then
      require_var "${WEB_STATIC_IMAGE-}" 'WEB_STATIC_IMAGE is required when source is image.'
    fi
  elif [[ "${WEB_MODE}" == "docker" ]]; then
    require_var "${WEB_DOCKER_IMAGE-}" 'WEB_DOCKER_IMAGE is required for docker mode.'
  else
    log "Error: WEB_MODE must be 'static' or 'docker', got '${WEB_MODE}'." >&2
    exit 1
  fi
fi

log "Ensuring required configuration from environment..."
# Configuration is passed via environment variables from parent run.sh
# Note: DOMAIN is no longer required here as nginx uses effective_domain from host variables
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
if [[ "${SKIP_WEB}" == "false" && "${WEB_MODE}" == "static" ]]; then
  if [[ "${WEB_STATIC_SOURCE}" == "local" ]]; then
    log "Preparing static website assets from local directory..."
    build_args=(--website-dir "${WEB_STATIC_DIR}" --output-dir "${WEBSITE_ASSETS_DIR}")
    if [[ -n "${WEB_STATIC_BUILD:-}" ]]; then
      build_args+=(--build-command "${WEB_STATIC_BUILD}")
    fi
    if [[ -n "${WEB_STATIC_DIST:-}" ]]; then
      build_args+=(--dist-dir "${WEB_STATIC_DIST}")
    fi
    "${WEBSITE_BUILD_SCRIPT}" "${build_args[@]}" >/dev/null
  elif [[ "${WEB_STATIC_SOURCE}" == "image" ]]; then
    log "Extracting static website assets from container image..."
    rm -rf "${WEBSITE_ASSETS_DIR}"
    mkdir -p "${WEBSITE_ASSETS_DIR}"
    
    # Pull the image
    docker pull "${WEB_STATIC_IMAGE}:${WEB_STATIC_TAG:-latest}"
    
    # Create a temporary container and copy assets out
    container_id=$(docker create "${WEB_STATIC_IMAGE}:${WEB_STATIC_TAG:-latest}")
    trap "docker rm -f '${container_id}' >/dev/null 2>&1 || true" EXIT
    docker cp "${container_id}:${WEB_STATIC_PATH:-/app/dist}/." "${WEBSITE_ASSETS_DIR}/"
    docker rm -f "${container_id}" >/dev/null
  fi
else
  log "Skipping website assets preparation; creating empty directory..."
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

# BACKEND_PORT is already in environment from parent run.sh
# Domain is now passed per-host via effective_domain in SSH_HOSTS JSON
# BACKEND_ENV_* variables are already exported by parent run.sh

# Validate backend image configuration when deploying backend
if [[ "${SKIP_BACKEND}" == "false" ]]; then
  require_var "${BACKEND_IMAGE:-}" 'BACKEND_IMAGE is required when deploying backend (set in maestro.yaml).'
  require_var "${BACKEND_IMAGE_TAG:-}" 'BACKEND_IMAGE_TAG is required when deploying backend (set in maestro.yaml).'
fi
# Export for Ansible even if empty (will be validated above when needed)
export BACKEND_IMAGE="${BACKEND_IMAGE:-}"
export BACKEND_IMAGE_TAG="${BACKEND_IMAGE_TAG:-}"

# Export web configuration for Ansible playbooks
export WEB_MODE="${WEB_MODE:-}"
export WEB_DOCKER_IMAGE="${WEB_DOCKER_IMAGE:-}"
export WEB_DOCKER_TAG="${WEB_DOCKER_TAG:-latest}"
export WEB_DOCKER_PORT="${WEB_DOCKER_PORT:-3000}"

# Export security configuration for Ansible playbooks
export MANAGED_GROUPS="${MANAGED_GROUPS:-}"


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

# Security hardening always runs on all servers
log "Applying security hardening..."
run_playbook "security.yml"

# we recommend running this playbook last because it may block connections to the server.
popd >/dev/null

log "Done."
