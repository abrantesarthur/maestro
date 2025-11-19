#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_CONTEXT="${SCRIPT_DIR}/image"
IMAGE_NAME="dalhe_pulumi"


# parse then validate the flags
PULUMI_ACCESS_TOKEN=""
CLOUDFLARE_API_TOKEN=""
DIGITALOCEAN_TOKEN=""
PULUMI_COMMAND="up"
HOST_SSH_KEY_PATH=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pulumi-access-token)
      [[ -n "${2:-}" ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 1; }
      PULUMI_ACCESS_TOKEN="$2"
      shift 2
      ;;
    --cloudflare-api-token)
      [[ -n "${2:-}" ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 1; }
      CLOUDFLARE_API_TOKEN="$2"
      shift 2
      ;;
    --digital-ocean-token)
      [[ -n "${2:-}" ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 1; }
      DIGITALOCEAN_TOKEN="$2"
      shift 2
      ;;
    --command)
      [[ -n "${2:-}" ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 1; }
      PULUMI_COMMAND="$2"
      shift 2
      ;;
    --ssh-key)
      [[ -n "${2:-}" ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 1; }
      HOST_SSH_KEY_PATH="$2"
      shift 2
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
    printf 'Invalid value for --command: %s. Expected "up", "refresh", "cancel", or "output".\n' "$PULUMI_COMMAND" >&2
    exit 1
    ;;
esac

NEEDS_PROVIDER_CREDS=true
if [[ "${PULUMI_COMMAND}" == "output" ]]; then
  NEEDS_PROVIDER_CREDS=false
fi

# require mandatory api keys
if [[ -z "${PULUMI_ACCESS_TOKEN}" ]]; then
  printf 'Error: --pulumi-access-token <token> is required.\n' >&2
  exit 1
fi
if [[ "${NEEDS_PROVIDER_CREDS}" == "true" ]]; then
  if [[ -z "${CLOUDFLARE_API_TOKEN}" ]]; then
    printf 'Error: --cloudflare-api-token <token> is required.\n' >&2
    exit 1
  fi
  if [[ -z "${DIGITALOCEAN_TOKEN}" ]]; then
    printf 'Error: --digital-ocean-token <api_key> is required.\n' >&2
    exit 1
  fi
  if [[ -z "${HOST_SSH_KEY_PATH}" ]]; then
    printf 'Error: --ssh-key </path/to/key> is required.\n' >&2
    exit 1
  fi
  if [[ ! -f "${HOST_SSH_KEY_PATH}" ]]; then
    printf 'Error: %s does not exist or is not a file.\n' "${HOST_SSH_KEY_PATH}" >&2
    exit 1
  fi
fi

# convert SSH key path to absolute for docker volume mounting
if [[ -n "${HOST_SSH_KEY_PATH}" && "${HOST_SSH_KEY_PATH}" != /* ]]; then
  HOST_SSH_KEY_PATH="$(cd "$(dirname "${HOST_SSH_KEY_PATH}")" && pwd)/$(basename "${HOST_SSH_KEY_PATH}")"
fi

echo "Building Docker image ${IMAGE_NAME}..."
if ! build_output=$(docker build -t "${IMAGE_NAME}" "${BUILD_CONTEXT}" 2>&1); then
  printf 'Failed to build Docker image "%s". Docker responded with:\n%s\n' "${IMAGE_NAME}" "${build_output}" >&2
  exit 1
fi

echo "Running the ${IMAGE_NAME} container..."
docker_env=(
  -e "PULUMI_ACCESS_TOKEN=${PULUMI_ACCESS_TOKEN}"
  -e "PULUMI_COMMAND=${PULUMI_COMMAND}"
)
if [[ "${NEEDS_PROVIDER_CREDS}" == "true" ]]; then
  docker_env+=(
    -e "CLOUDFLARE_API_TOKEN=${CLOUDFLARE_API_TOKEN}"
    -e "DIGITALOCEAN_TOKEN=${DIGITALOCEAN_TOKEN}"
  )
fi

docker_cmd=(docker run -it --rm)
if [[ "${NEEDS_PROVIDER_CREDS}" == "true" ]]; then
  docker_cmd+=(-v "${HOST_SSH_KEY_PATH}:/root/.ssh/ssh_dalhe_ai:ro")
fi
docker_cmd+=("${docker_env[@]}")
docker_cmd+=("${IMAGE_NAME}")

"${docker_cmd[@]}"
