#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPERS_PATH="$(cd -- "${SCRIPT_DIR}/.." && pwd)/helpers.sh"
SHARED_ENV_PATH="$(cd -- "${SCRIPT_DIR}/.." && pwd)/shared.env"
PULUMI_ENV_PATH="${SCRIPT_DIR}/.env"
BUILD_CONTEXT="${SCRIPT_DIR}/image"
IMAGE_NAME="provisioner_pulumi"

# import helper functions
source "$HELPERS_PATH"

log() {
  echo "[provisioner/pulumi] $*"
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

# parse then validate the flags
log "Parsing flags..."
PULUMI_COMMAND="up"
SKIP_BWS=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --command)
      [[ -n "${2:-}" ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 1; }
      PULUMI_COMMAND="$2"
      shift 2
      ;;
    --skip-bws)
      SKIP_BWS=true
      shift 1
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      exit 1
      ;;
  esac
done


# ensure --command is either up, refresh, cancel, or output
case "$PULUMI_COMMAND" in
  up|refresh|cancel|output)
    ;;
  *)
    log "Invalid value for --command: '${PULUMI_COMMAND}'. Expected 'up', 'refresh', 'cancel', or 'output'.\n" >&2
    exit 1
    ;;
esac

NEEDS_PROVIDER_CREDS=true
if [[ "${PULUMI_COMMAND}" == "output" ]]; then
  NEEDS_PROVIDER_CREDS=false
fi

if [[ "${SKIP_BWS}" == "false" ]]; then
  log "Fetching secrets from Bitwarden..."
  source_bws_secrets
else
  log "Skipping fetch of secrets from Bitwarden..."
fi

log "Ensuring required flags and environment variables..."
# require mandatory api keys
require_var "${PULUMI_ACCESS_TOKEN-}" 'PULUMI_ACCESS_TOKEN is required.'
if [[ "${NEEDS_PROVIDER_CREDS}" == "true" ]]; then
  require_var "${CLOUDFLARE_API_TOKEN-}" 'CLOUDFLARE_API_TOKEN is required.'
  require_var "${DIGITALOCEAN_TOKEN-}" 'DIGITALOCEAN_TOKEN is required.'
fi
require_bws_var 'VPS_SSH_KEY'

# write Bitwarden-provided SSH key to a secure temp file for mounting into the container
SSH_KEY_TEMP_FILE="$(create_temp_secret_file VPS_SSH_KEY)"
trap 'rm -f "${SSH_KEY_TEMP_FILE}"' EXIT

log "Building Docker image ${IMAGE_NAME}..."
if ! build_output=$(docker build -t "${IMAGE_NAME}" "${BUILD_CONTEXT}" 2>&1); then
  printf 'Failed to build Docker image "%s". Docker responded with:\n%s\n' "${IMAGE_NAME}" "${build_output}" >&2
  exit 1
fi

log "Running the ${IMAGE_NAME} image..."
PULUMI_SSH_KEY_PATH="/root/.ssh/id_rsa"
docker_env=(
  --env-file=${SHARED_ENV_PATH}
  --env-file=${PULUMI_ENV_PATH}
  -e "PULUMI_ACCESS_TOKEN=${PULUMI_ACCESS_TOKEN}"
  -e "PULUMI_COMMAND=${PULUMI_COMMAND}"
  -e "PULUMI_SSH_KEY_PATH=${PULUMI_SSH_KEY_PATH}"
)
docker_cmd=(docker run -it --rm)
if [[ "${NEEDS_PROVIDER_CREDS}" == "true" ]]; then
  docker_env+=(
    -e "CLOUDFLARE_API_TOKEN=${CLOUDFLARE_API_TOKEN}"
    -e "DIGITALOCEAN_TOKEN=${DIGITALOCEAN_TOKEN}"
  )
  docker_cmd+=(-v "${SSH_KEY_TEMP_FILE}:${PULUMI_SSH_KEY_PATH}:ro")
fi

docker_cmd+=("${docker_env[@]}")
docker_cmd+=("${IMAGE_NAME}")

# FIXME: improve logging
"${docker_cmd[@]}"
