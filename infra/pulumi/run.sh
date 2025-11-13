#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_CONTEXT="${SCRIPT_DIR}/image"
IMAGE_NAME="dalhe_pulumi"


# parse then validate the flags
PULUMI_ACCESS_TOKEN=""
CLOUDFLARE_API_TOKEN=""
DIGITAL_OCEAN_API_KEY=""
PULUMI_COMMAND="up"
PULUMI_CONFIG_PROD_IPV4S=""
PROD_SERVER_SSH_KEY_PATH=""
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
    --digital-ocean-api-key)
      [[ -n "${2:-}" ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 1; }
      DIGITAL_OCEAN_API_KEY="$2"
      shift 2
      ;;
    --command)
      [[ -n "${2:-}" ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 1; }
      PULUMI_COMMAND="$2"
      shift 2
      ;;
    --prod-server-ips)
      [[ -n "${2:-}" ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 1; }
      PULUMI_CONFIG_PROD_IPV4S="$2"
      shift 2
      ;;
    --prod-server-ssh-key-path)
      [[ -n "${2:-}" ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 1; }
      PROD_SERVER_SSH_KEY_PATH="$2"
      shift 2
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      exit 1
      ;;
  esac
done


# ensure --command is either up or refresh
case "$PULUMI_COMMAND" in
  up|refresh|cancel)
    ;;
  *)
    printf 'Invalid value for --command: %s. Expected "up", "refresh", or "cancel".\n' "$PULUMI_COMMAND" >&2
    exit 1
    ;;
esac

# require mandatory api keys
if [[ -z "${PULUMI_ACCESS_TOKEN}" ]]; then
  printf 'Error: --pulumi-access-token <token> is required.\n' >&2
  exit 1
fi
if [[ -z "${CLOUDFLARE_API_TOKEN}" ]]; then
  printf 'Error: --cloudflare-api-token <token> is required.\n' >&2
  exit 1
fi
if [[ -z "${DIGITAL_OCEAN_API_KEY}" ]]; then
  printf 'Error: --digital-ocean-api-key <api_key> is required.\n' >&2
  exit 1
fi
if [[ -z "${PROD_SERVER_SSH_KEY_PATH}" ]]; then
  printf 'Error: --prod-server-ssh-key-path </path/to/key> is required.\n' >&2
  exit 1
fi

if [[ ! -f "${PROD_SERVER_SSH_KEY_PATH}" ]]; then
  printf 'Error: %s does not exist or is not a file.\n' "${PROD_SERVER_SSH_KEY_PATH}" >&2
  exit 1
fi

# convert SSH key path to absolute for docker volume mounting
if [[ "${PROD_SERVER_SSH_KEY_PATH}" != /* ]]; then
  PROD_SERVER_SSH_KEY_PATH="$(cd "$(dirname "${PROD_SERVER_SSH_KEY_PATH}")" && pwd)/$(basename "${PROD_SERVER_SSH_KEY_PATH}")"
fi


if [[ -n "${PULUMI_CONFIG_PROD_IPV4S}" ]]; then
  if [[ ! "${PULUMI_CONFIG_PROD_IPV4S}" =~ ^\[.*\]$ ]]; then
    printf 'Error: --prod-server-ips must be a JSON array, e.g. '["123.45.678.00","123.45.678.01"]'.\n' >&2
    exit 1
  fi
fi



echo "Building Docker image ${IMAGE_NAME}..."
if ! build_output=$(docker build -t "${IMAGE_NAME}" "${BUILD_CONTEXT}" 2>&1); then
  printf 'Failed to build Docker image "%s". Docker responded with:\n%s\n' "${IMAGE_NAME}" "${build_output}" >&2
  exit 1
fi

echo "Running the ${IMAGE_NAME} container..."
docker_env=(
  -e "CLOUDFLARE_API_TOKEN=${CLOUDFLARE_API_TOKEN}"
  -e "PULUMI_ACCESS_TOKEN=${PULUMI_ACCESS_TOKEN}"
  -e "DIGITAL_OCEAN_API_KEY=${DIGITAL_OCEAN_API_KEY}"
  -e "PULUMI_COMMAND=${PULUMI_COMMAND}"
)
if [[ -n "${PULUMI_CONFIG_PROD_IPV4S}" ]]; then
  docker_env+=(-e "PULUMI_CONFIG_PROD_IPV4S=${PULUMI_CONFIG_PROD_IPV4S}")
fi

docker run -it --rm \
  -v "${PROD_SERVER_SSH_KEY_PATH}:/root/.ssh/ssh_dalhe_ai:ro" \
  "${docker_env[@]}" \
  "${IMAGE_NAME}"
