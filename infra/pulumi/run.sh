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
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      exit 1
      ;;
  esac
done


# ensure --command is either up or refresh
case "$PULUMI_COMMAND" in
  up|refresh)
    ;;
  *)
    printf 'Invalid value for --command: %s. Expected "up" or "refresh".\n' "$PULUMI_COMMAND" >&2
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



echo "Building Docker image ${IMAGE_NAME}..."
if ! build_output=$(docker build -t "${IMAGE_NAME}" "${BUILD_CONTEXT}" 2>&1); then
  printf 'Failed to build Docker image "%s". Docker responded with:\n%s\n' "${IMAGE_NAME}" "${build_output}" >&2
  exit 1
fi

echo "Running the ${IMAGE_NAME} container..."
docker run -it --rm \
    -e CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN}" \
    -e PULUMI_ACCESS_TOKEN="${PULUMI_ACCESS_TOKEN}" \
    -e DIGITAL_OCEAN_API_KEY="${DIGITAL_OCEAN_API_KEY}" \
    -e PULUMI_COMMAND="${PULUMI_COMMAND}" \
    "${IMAGE_NAME}"
