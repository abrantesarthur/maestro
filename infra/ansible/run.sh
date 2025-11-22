#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER_RUNTIME="${CONTAINER_RUNTIME:-docker}"
EE_IMAGE_TAG="${EE_IMAGE_TAG:-ansible_ee}"
EE_DEFINITION_FILE="${SCRIPT_DIR}/execution_environment/execution-environment.yml"
WEBSITE_BUILD_SCRIPT="${SCRIPT_DIR}/scripts/build_website.sh"
WEBSITE_ASSETS_DIR="${SCRIPT_DIR}/execution_environment/files/website"
BACKEND_IMAGE="${BACKEND_IMAGE:-ghcr.io/dalhe-ai/backend}"
BACKEND_IMAGE_TAG="${BACKEND_IMAGE_TAG:-latest}"
GHCR_TOKEN="${GHCR_TOKEN:-}"
GHCR_USERNAME="${GHCR_USERNAME:-${GITHUB_ACTOR:-}}"
SSH_HOSTS_ARG=""
CONTAINER_SSH_KEY_PATH="/root/.ssh/dalhe_ai"
HOST_SSH_KEY_PATH=""

usage() {
  cat <<EOF
Usage: $(basename "$0")
Options:
  -h, --help                       Show this message.
  --ssh-hosts <json>                   json with list of hostname and tags (e.g., --ssh-hosts {"hosts":[{"hostname":"ssh0.dalhe.ai","tags":["backend","prod","web"]}]}) (required)
  --ssh-key <path>                 Path to the host SSH private key (required).
EOF
}

# require needed flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --ssh-hosts)
      if [[ $# -lt 2 ]]; then
        echo "Error: --ssh-hosts requires an argument." >&2
        exit 1
      fi
      SSH_HOSTS_ARG="$2"
      shift 2
      ;;
    --ssh-key)
      if [[ $# -lt 2 ]]; then
        echo "Error: --ssh-key requires an argument." >&2
        exit 1
      fi
      HOST_SSH_KEY_PATH="$2"
      shift 2
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${SSH_HOSTS_ARG}" ]]; then
  echo "Error: --ssh-hosts must be provided with at least one hostname." >&2
  exit 1
fi

if [[ -z "${HOST_SSH_KEY_PATH}" ]]; then
  echo "Error: --ssh-key must be provided and point to the host SSH private key." >&2
  exit 1
fi

if [[ -z "${GHCR_TOKEN}" ]]; then
  echo "Error: GHCR_TOKEN must be set for GHCR authentication." >&2
  exit 1
fi

if [[ -z "${GHCR_USERNAME}" ]]; then
  echo "Error: GHCR_USERNAME or GITHUB_ACTOR must be set for GHCR authentication." >&2
  exit 1
fi

if [[ "${HOST_SSH_KEY_PATH}" != /* ]]; then
  HOST_SSH_KEY_PATH="$(cd "$(dirname "${HOST_SSH_KEY_PATH}")" && pwd -P)/$(basename "${HOST_SSH_KEY_PATH}")"
fi

# ensure ansible-builder and ansible-navigator are installed in the host
if ! command -v ansible-builder >/dev/null 2>&1 || ! command -v ansible-navigator >/dev/null 2>&1; then
  echo "ansible-builder not found; installing Ansible tooling via pip..."

  if command -v pip3 >/dev/null 2>&1; then
    PIP_CMD="pip3"
  elif command -v pip >/dev/null 2>&1; then
    PIP_CMD="pip"
  elif command -v python3 >/dev/null 2>&1; then
    PIP_CMD="python3 -m pip"
  elif command -v python >/dev/null 2>&1; then
    PIP_CMD="python -m pip"
  else
    echo "Error: pip is not installed; cannot bootstrap Ansible tooling." >&2
    exit 1
  fi

  if ! ${PIP_CMD} install --user ansible-navigator ansible-runner >/dev/null; then
    echo "Error: failed to install Ansible tooling via pip." >&2
    exit 1
  fi

  hash -r

  if ! command -v ansible-builder >/dev/null 2>&1 || ! command -v ansible-navigator >/dev/null 2>&1; then
    echo "Error: ansible-builder/ansible-navigator are still not available on PATH. Ensure your pip user bin directory (e.g., ~/.local/bin) is in PATH." >&2
    exit 1
  fi
fi

if [[ ! -f "${EE_DEFINITION_FILE}" ]]; then
  echo "Error: execution environment definition not found at ${EE_DEFINITION_FILE}." >&2
  exit 1
fi

if [[ ! -f "${WEBSITE_BUILD_SCRIPT}" ]]; then
  echo "Error: website build script not found at ${WEBSITE_BUILD_SCRIPT}." >&2
  exit 1
fi

# make sure the website assets baked into the EE are up to date
echo "Building website assets for Ansible execution environment..."
"${WEBSITE_BUILD_SCRIPT}" --output-dir "${WEBSITE_ASSETS_DIR}" >/dev/null; 

# build the ansible execution environment image
echo "Building Ansible execution environment image '${EE_IMAGE_TAG}' using ${CONTAINER_RUNTIME}..."
pushd "${SCRIPT_DIR}" >/dev/null
ansible-builder build \
  --container-runtime "${CONTAINER_RUNTIME}" \
  --tag "${EE_IMAGE_TAG}" \
  -f "${EE_DEFINITION_FILE}" 

# helper to run ansible playbooks with shared environment
run_playbook() {
  local playbook="$1"
  SSH_HOSTS="${SSH_HOSTS_ARG}" \
  SSH_KEY_PATH="${CONTAINER_SSH_KEY_PATH}" \
  GHCR_TOKEN="${GHCR_TOKEN}" \
  GHCR_USERNAME="${GHCR_USERNAME}" \
  BACKEND_IMAGE="${BACKEND_IMAGE}" \
  BACKEND_IMAGE_TAG="${BACKEND_IMAGE_TAG}" \
    ansible-navigator run \
    "playbooks/${playbook}" \
    "--container-options=-v=${HOST_SSH_KEY_PATH}:${CONTAINER_SSH_KEY_PATH}:ro"
}

echo "Provisioning permissions..."
run_playbook "perms.yml"

echo "Provisioning web server..."
run_playbook "web.yml"

echo "Provisioning backend..."
run_playbook "backend.yml"
popd >/dev/null

echo "Done."
