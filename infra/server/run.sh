#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config.env"
BUILD_CONTEXT="${SCRIPT_DIR}/image"

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "Config file not found: ${CONFIG_FILE}" >&2
  exit 1
fi

# Parse mandatory API key argument
API_KEY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-key)
      [[ -n "${2:-}" ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 1; }
      API_KEY="$2"
      shift 2
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${API_KEY}" ]]; then
  printf 'Error: --api-key <digital_ocean_api_key> is required.\n' >&2
  exit 1
fi

# shellcheck disable=SC1090
source "${CONFIG_FILE}"

: "${IMAGE_NAME:?IMAGE_NAME must be set in config.env}"
interactive_mode="${INTERACTIVE:-false}"
case "${interactive_mode}" in
  true|false) ;;
  *)
    printf 'INTERACTIVE must be "true" or "false" (got "%s")\n' "${interactive_mode}" >&2
    exit 1
    ;;
esac

if [[ "${interactive_mode}" == "false" ]]; then
  : "${DROPLET_REGION:?DROPLET_REGION must be set in config.env}"
  : "${DROPLET_OS_IMAGE:?DROPLET_OS_IMAGE must be set in config.env}"
  : "${DROPLET_SSH_KEY_ID:?DROPLET_SSH_KEY_ID must be set in config.env}"
  : "${DROPLET_SIZE:?DROPLET_SIZE must be set in config.env}"
  : "${DROPLET_NAME:?DROPLET_NAME must be set in config.env}"
fi

echo "Building Docker image ${IMAGE_NAME}..."
if ! build_output=$(docker build -t "${IMAGE_NAME}" "${BUILD_CONTEXT}" 2>&1); then
  printf 'Failed to build Docker image "%s". Docker responded with:\n%s\n' "${IMAGE_NAME}" "${build_output}" >&2
  exit 1
fi

echo "Running dalhe bootstrap container..."
echo "DROPLET_SSH_KEY_ID ${DROPLET_SSH_KEY_ID}"
if [[ "${interactive_mode}" == "true" ]]; then
  docker run -it "${IMAGE_NAME}" \
    --api-key "${API_KEY}"
else
  docker run -it --rm "${IMAGE_NAME}" \
    --region "${DROPLET_REGION}" \
    --image "${DROPLET_OS_IMAGE}" \
    --ssh-key-id "${DROPLET_SSH_KEY_ID}" \
    --size "${DROPLET_SIZE}" \
    --api-key "${API_KEY}" \
    --name "${DROPLET_NAME}"
fi
