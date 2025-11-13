#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER_RUNTIME="${CONTAINER_RUNTIME:-docker}"
EE_IMAGE_TAG="${EE_IMAGE_TAG:-ansible_ee}"
EE_DEFINITION_FILE="${SCRIPT_DIR}/execution_environment/execution-environment.yml"

usage() {
  cat <<EOF
Usage: $(basename "$0")
Options:
  -h, --help                       Show this message.
EOF
}

# require needed flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      exit 1
      ;;
  esac
done

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

# build the ansible execution environment image
echo "Building Ansible execution environment image '${EE_IMAGE_TAG}' using ${CONTAINER_RUNTIME}..."
pushd "${SCRIPT_DIR}" >/dev/null
ansible-builder build \
  --container-runtime "${CONTAINER_RUNTIME}" \
  --tag "${EE_IMAGE_TAG}" \
  -f "${EE_DEFINITION_FILE}" 

# provision groups
echo "Provisioning groups..."
ansible-navigator run playbooks/groups.yml

popd >/dev/null

echo "Done."
