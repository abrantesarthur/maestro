#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER_RUNTIME="${CONTAINER_RUNTIME:-docker}"
EE_IMAGE_TAG="${EE_IMAGE_TAG:-ansible_ee}"
EE_DEFINITION_FILE="${SCRIPT_DIR}/execution_environment/execution-environment.yml"
PROD_SERVER_IP=""
CLOUDFLARE_ACCOUNT_ID=""
CLOUDFLARE_TUNNEL_ID=""
CLOUDFLARE_API_KEY=""
CLOUDFLARE_TUNNEL_TOKEN=""

usage() {
  cat <<EOF
Usage: $(basename "$0") --prod-server-ip <ip> --cloudflare-account-id <id> --cloudflare-tunnel-id <id> --cloudflare-api-key <token>

Options:
  --prod-server-ip <ip>            Public IP for the production server (required).
  --cloudflare-account-id <id>     Cloudflare account identifier (required).
  --cloudflare-tunnel-id <id>      Cloudflare tunnel identifier (required).
  --cloudflare-api-key <token>     Cloudflare API token/key with Tunnel read permissions (required).
  -h, --help                       Show this message.
EOF
}

# require needed flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    --prod-server-ip)
      [[ -n "${2:-}" ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 1; }
      PROD_SERVER_IP="$2"
      shift 2
      ;;
    --cloudflare-account-id)
      [[ -n "${2:-}" ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 1; }
      CLOUDFLARE_ACCOUNT_ID="$2"
      shift 2
      ;;
    --cloudflare-tunnel-id)
      [[ -n "${2:-}" ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 1; }
      CLOUDFLARE_TUNNEL_ID="$2"
      shift 2
      ;;
    --cloudflare-api-key)
      [[ -n "${2:-}" ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 1; }
      CLOUDFLARE_API_KEY="$2"
      shift 2
      ;;
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
if [[ -z "${PROD_SERVER_IP}" ]]; then
  printf 'Error: --prod-server-ip <public_ip> is required.\n' >&2
  usage
  exit 1
fi
if [[ -z "${CLOUDFLARE_ACCOUNT_ID}" ]]; then
  printf 'Error: --cloudflare-account-id <id> is required.\n' >&2
  usage
  exit 1
fi
if [[ -z "${CLOUDFLARE_TUNNEL_ID}" ]]; then
  printf 'Error: --cloudflare-tunnel-id <id> is required.\n' >&2
  usage
  exit 1
fi
if [[ -z "${CLOUDFLARE_API_KEY}" ]]; then
  printf 'Error: --cloudflare-api-key <token> is required.\n' >&2
  usage
  exit 1
fi

fetch_cloudflare_tunnel_token() {
  local api_url="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel/${CLOUDFLARE_TUNNEL_ID}/token"
  local tmpfile
  tmpfile="$(mktemp)"
  local http_status
  if ! http_status="$(curl --silent --show-error \
      --header "Authorization: Bearer ${CLOUDFLARE_API_KEY}" \
      --output "${tmpfile}" \
      "${api_url}")"; then
    cat "${tmpfile}" >&2 || true
    rm -f "${tmpfile}"
    printf 'Error: failed to contact Cloudflare API.\n' >&2
    exit 1
  fi

  local response_body
  response_body="$(cat "${tmpfile}")"
  rm -f "${tmpfile}"

  CLOUDFLARE_TUNNEL_TOKEN=$(printf '%s\n' "$response_body" | sed -n 's/.*"result":"\([^"]*\)".*/\1/p')
  if [[ -z "${CLOUDFLARE_TUNNEL_TOKEN}" ]]; then
    printf 'Error: failed to retrieve the tunnel token from Cloudflare API. Ensure you specified correct values for --cloudflare-tunnel-id, --cloudflare-account-id and --cloudflare-api-key.\n' >&2
    exit 1
  fi
}

echo "Retrieving Cloudflare tunnel token from Cloudflare API..."
fetch_cloudflare_tunnel_token
echo "Cloudflare tunnel token retrieved."


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

# provision cloudflared first. We need the tunnel established before we can rely on the friendly hostname `ssh.dalhe.ai`.
echo "Provisioning cloudflared..."
export PROD_SERVER_IP
export CLOUDFLARE_TUNNEL_TOKEN
ansible-navigator run playbooks/cloudflared.yml

# provision groups
echo "Provisioning groups..."
ansible-navigator run playbooks/groups.yml

popd >/dev/null

echo "Done."
