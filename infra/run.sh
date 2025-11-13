#!/usr/bin/env bash
set -euo pipefail


SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_RUN="${SCRIPT_DIR}/server/run.sh"
PULUMI_RUN="${SCRIPT_DIR}/pulumi/run.sh"
ANSIBLE_RUN="${SCRIPT_DIR}/ansible/run.sh"


# FIXME: parse optional variables with amount of servers and whether to even create servers
# Parse mandatory arguments
PROVISION_SERVER=false
DIGITAL_OCEAN_API_KEY=""
PULUMI_ACCESS_TOKEN=""
CLOUDFLARE_API_TOKEN=""
HOST_SSH_KEY_PATH=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --provision-server)
        PROVISION_SERVER=true
        shift 1
    ;;
    --digital-ocean-api-key)
      [[ -n "${2:-}" ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 1; }
      DIGITAL_OCEAN_API_KEY="$2"
      shift 2
      ;;
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
if [[ -z "${HOST_SSH_KEY_PATH}" ]]; then
  printf 'Error: --ssh-key </path/to/key> is required.\n' >&2
  exit 1
fi

# only provision servers if explicitly requested
if [[ "${PROVISION_SERVER}" == "true" ]]; then
  if [[ -z "${DIGITAL_OCEAN_API_KEY}" ]]; then
    printf 'Error: --digital-ocean-api-key <digital_ocean_api_key> is required when provisioning servers.\n' >&2
    exit 1
  fi
  "${SERVER_RUN}" --api-key "${DIGITAL_OCEAN_API_KEY}"
else
  echo "Skipping server provisioning"
fi

# provision pulumi and capture created ssh hostnames
echo "Provisioning cloudflare..."
PULUMI_OUTPUT_LOG="$(mktemp -t pulumi_output)"
trap 'rm -f "${PULUMI_OUTPUT_LOG}"' EXIT
"${PULUMI_RUN}" --pulumi-access-token "${PULUMI_ACCESS_TOKEN}" --cloudflare-api-token "${CLOUDFLARE_API_TOKEN}" --digital-ocean-api-key "${DIGITAL_OCEAN_API_KEY}" --ssh-key "${HOST_SSH_KEY_PATH}" | tee "${PULUMI_OUTPUT_LOG}"

SSH_HOSTNAMES="$(
  awk '
    /__PULUMI_OUTPUTS_BEGIN__/ {capture=1; next}
    /__PULUMI_OUTPUTS_END__/ {capture=0}
    capture && $1 == "sshHostnames" {print $2; exit}
  ' "${PULUMI_OUTPUT_LOG}" \
  | sed 's/^[[:space:]]*\[//; s/\][[:space:]]*$//' \
  | tr -d '"' \
  | tr -d '[:space:]'
)"

# provision ansible
echo "Provisioning ansible..."
"${ANSIBLE_RUN}" --ssh-hostnames ""${SSH_HOSTNAMES}"" --ssh-key "${HOST_SSH_KEY_PATH}"
