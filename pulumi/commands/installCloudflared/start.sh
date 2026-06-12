#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: startCloudflared.sh --cloudflare-account-id <id> --cloudflare-tunnel-id <id> --cloudflare-api-key <token>

Installs cloudflared on the host and provisions the systemd service using the tunnel token
retrieved from the Cloudflare API.
EOF
}

if [[ "${EUID}" -ne 0 ]]; then
  echo "This script must be run as root." >&2
  exit 1
fi

log() {
  echo "[start-cloudflared] $*"
}

CLOUDFLARE_ACCOUNT_ID=""
CLOUDFLARE_TUNNEL_ID=""
CLOUDFLARE_API_KEY=""
CLOUDFLARE_TUNNEL_TOKEN=""
while [[ $# -gt 0 ]]; do
  case "$1" in
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
      usage
      exit 1
      ;;
  esac
done
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
  local _http_status
  if ! _http_status="$(curl --silent --show-error \
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
  if [[ -z "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]]; then
    printf 'Error: failed to retrieve the tunnel token from Cloudflare API. Ensure you specified correct values for --cloudflare-tunnel-id, --cloudflare-account-id and --cloudflare-api-key.\n' >&2
    exit 1
  fi
}

KEYRING_DIR="/usr/share/keyrings"
GPG_KEY_PATH="${KEYRING_DIR}/cloudflare-public-v2.gpg"
GPG_KEY_URL="https://pkg.cloudflare.com/cloudflare-public-v2.gpg"
APT_REPO_FILE="/etc/apt/sources.list.d/cloudflared.list"
APT_REPO_LINE="deb [signed-by=${GPG_KEY_PATH}] https://pkg.cloudflare.com/cloudflared any main"
SERVICE_UNIT="/etc/systemd/system/cloudflared.service"

log "Ensuring Cloudflare keyring directory exists"
install -d -m 0755 "${KEYRING_DIR}"

log "Downloading Cloudflare GPG key"
tmp_key="$(mktemp)"
curl -fsSL "${GPG_KEY_URL}" -o "${tmp_key}"
install -m 0644 "${tmp_key}" "${GPG_KEY_PATH}"
rm -f "${tmp_key}"

log "Configuring cloudflared apt repository"
cat <<EOF >"${APT_REPO_FILE}"
${APT_REPO_LINE}
EOF

log "Updating apt cache"
apt-get update -y

log "Installing cloudflared package"
DEBIAN_FRONTEND=noninteractive apt-get install -y cloudflared

log "Checking for existing cloudflared systemd service"
service_exists=false
if [[ -f "${SERVICE_UNIT}" ]]; then
  service_exists=true
fi

log "Retrieving Cloudflare tunnel token from Cloudflare API..."
fetch_cloudflare_tunnel_token
log "Cloudflare tunnel token retrieved."

if [[ "${service_exists}" == true ]]; then
  log "Uninstalling previous cloudflared systemd service"
  cloudflared service uninstall
fi

log "Installing cloudflared service with provided tunnel token"
cloudflared service install "${CLOUDFLARE_TUNNEL_TOKEN}"

log "Ensuring cloudflared service is enabled and running"
systemctl daemon-reload
systemctl enable cloudflared
systemctl start cloudflared

log "cloudflared is installed and running"
