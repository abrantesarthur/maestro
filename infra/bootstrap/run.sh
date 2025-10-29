#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config.env"
BUILD_CONTEXT="${SCRIPT_DIR}/image"

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "Config file not found: ${CONFIG_FILE}" >&2
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
  : "${DROPLET_SSH_KEY:?DROPLET_SSH_KEY must be set in config.env}"
  : "${DROPLET_SIZE:?DROPLET_SIZE must be set in config.env}"
  : "${DIGITAL_OCEAN_API_KEY:?DIGITAL_OCEAN_API_KEY must be set in config.env}"
  : "${DROPLET_NAME:?DROPLET_NAME must be set in config.env}"
fi

echo "Building Docker image ${IMAGE_NAME}..."
docker build -t "${IMAGE_NAME}" "${BUILD_CONTEXT}"

echo "Running dalhe bootstrap container..."
if [[ "${interactive_mode}" == "true" ]]; then
  docker run -it "${IMAGE_NAME}"
else
  docker run -it "${IMAGE_NAME}" \
    --region "${DROPLET_REGION}" \
    --image "${DROPLET_OS_IMAGE}" \
    --ssh-key "${DROPLET_SSH_KEY}" \
    --size "${DROPLET_SIZE}" \
    --api-key "${DIGITAL_OCEAN_API_KEY}" \
    --name "${DROPLET_NAME}"
fi
