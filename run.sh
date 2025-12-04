#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPERS_PATH="$(cd -- "${SCRIPT_DIR}" && pwd)/helpers.sh"
PULUMI_RUN="${SCRIPT_DIR}/pulumi/run.sh"
ANSIBLE_RUN="${SCRIPT_DIR}/ansible/run.sh"

# import helper functions
source "$HELPERS_PATH"

# Create a require_cmd and require_var functions with custom logger
log() {
  echo "[maestro] $*"
}
require_cmd() {
  require_command log "$@"
}
require_var() {
  require_variable log "$@"
}
require_bws_var() {
  require_bws_variable log "$@"
}

# Parse mandatory arguments
log "Parsing flags..."
SKIP_PULUMI=false
SKIP_ANSIBLE=false
BACKEND_IMAGE=""
BACKEND_IMAGE_TAG=""
WEBSITE_DIR=""
SKIP_WEB=false
SKIP_BACKEND=false
SKIP_PERMS=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-pulumi)
      SKIP_PULUMI=true
      shift 1
    ;;
    --skip-ansible)
      SKIP_ANSIBLE=true
      shift 1
    ;;
    --backend-image)
      [[ -n "${2:-}" ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 1; }
      BACKEND_IMAGE="$2"
      shift 2
    ;;
    --backend-image-tag)
      [[ -n "${2:-}" ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 1; }
      BACKEND_IMAGE_TAG="$2"
      shift 2
    ;;
    --website-dir)
      [[ -n "${2:-}" ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 1; }
      WEBSITE_DIR="$2"
      shift 2
    ;;
    --skip-web)
      SKIP_WEB=true
      shift 1
    ;;
    --skip-backend)
      SKIP_BACKEND=true
      shift 1
    ;;
    --skip-perms)
      SKIP_PERMS=true
      shift 1
    ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      exit 1
      ;;
  esac
done

log "Ensuring required commands exist..."
require_cmd jq
require_cmd cloudflared

log "Fetching secrets from Bitwarden..."
source_bws_secrets

log "Ensuring required secrets and variables exist in the environment..."
require_bws_var 'GHCR_TOKEN'
require_bws_var 'VPS_SSH_KEY'

if [[ "${SKIP_PULUMI}" == "false" || "${SKIP_ANSIBLE}" == "false" ]]; then
  require_bws_var 'PULUMI_ACCESS_TOKEN'
fi

if [[ "${SKIP_PULUMI}" == "false" ]]; then
  require_bws_var 'CLOUDFLARE_API_TOKEN'
  require_bws_var 'DIGITALOCEAN_TOKEN'
fi

if [[ "${SKIP_ANSIBLE}" == "false" ]]; then
  require_bws_var 'GHCR_USERNAME'
fi

# Validate user-specified BWS secrets
if [[ -n "${BWS_REQUIRED_VARS:-}" ]]; then
  IFS=',' read -ra BWS_VARS <<< "${BWS_REQUIRED_VARS}"
  for var in "${BWS_VARS[@]}"; do
    # Trim whitespace
    var="${var#"${var%%[![:space:]]*}"}"
    var="${var%"${var##*[![:space:]]}"}"
    [[ -n "${var}" ]] && require_bws_var "${var}"
  done
fi

declare -a PULUMI_OUTPUT_LOGS=()

cleanup_pulumi_logs() {
  if ((${#PULUMI_OUTPUT_LOGS[@]})); then
    for log_file in "${PULUMI_OUTPUT_LOGS[@]}"; do
      [[ -n "${log_file}" && -f "${log_file}" ]] && rm -f "${log_file}"
    done
  fi
}
trap cleanup_pulumi_logs EXIT

# write Bitwarden-provided SSH key to a secure temp file for mounting into the container
SSH_KEY_TEMP_FILE="$(create_temp_secret_file VPS_SSH_KEY)"
trap 'rm -f "${SSH_KEY_TEMP_FILE}"' EXIT

capture_pulumi_hosts() {
  local pulumi_command="$1"
  local show_logs="${2:-true}"
  local output_log
  output_log="$(mktemp -t pulumi_output)"
  PULUMI_OUTPUT_LOGS+=("${output_log}")

  local pulumi_args=(
    --command "${pulumi_command}"
    --skip-bws # we already inject the secrets  
  )

  if [[ "${show_logs}" == "true" ]]; then
    # Mirror Pulumi output to the terminal while still capturing for parsing.
    "${PULUMI_RUN}" "${pulumi_args[@]}" | tee "${output_log}" >&2
  else
    "${PULUMI_RUN}" "${pulumi_args[@]}" > "${output_log}"
  fi

  local parsed_hosts
  parsed_hosts="$(
    awk '/__PULUMI_OUTPUTS_BEGIN__/{flag=1;next}/__PULUMI_OUTPUTS_END__/{flag=0}flag' "${output_log}" \
    | jq -c '{hosts: .hosts}'
  )"

  printf '%s' "${parsed_hosts}"
}

wait_for_tunnel() {
  local host="$1"
  local attempts="${2:-30}"
  local delay_seconds="${3:-10}"

  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if ssh \
      -o ProxyCommand="cloudflared access ssh --hostname ${host}" \
      -o BatchMode=yes \
      -o ConnectTimeout=5 \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -i "${SSH_KEY_TEMP_FILE}" \
      "root@${host}" \
      exit >/dev/null 2>&1; then
      log "Tunnel reachable: ${host}"
      return 0
    fi
    log "Waiting for tunnel ${host} to become reachable (attempt ${attempt}/${attempts})..."
    sleep "${delay_seconds}"
  done

  log "Error: tunnel ${host} not reachable after ${attempts} attempts." >&2
  return 1
}

wait_for_tunnels_ready() {
  local pulumi_hosts_json="$1"

  local tunnel_hosts=()
  while IFS= read -r host; do
    tunnel_hosts+=("${host}")
  done < <(printf '%s' "${pulumi_hosts_json}" | jq -r '(.hosts // [])[].hostname // empty')
  if ((${#tunnel_hosts[@]} == 0)); then
    log "Error: no tunnel hostnames found in PULUMI_HOSTS." >&2
    exit 1
  fi

  for host in "${tunnel_hosts[@]}"; do
    wait_for_tunnel "${host}"
  done
}

# only provision pulumi if requested
PULUMI_HOSTS=""
if [[ "${SKIP_PULUMI}" == "false" ]]; then
  # provision pulumi and capture created ssh hostnames
  log "Provisioning pulumi..."
  PULUMI_HOSTS="$(capture_pulumi_hosts "up")"
elif [[ "${SKIP_ANSIBLE}" == "false" ]]; then
  log "Fetching existing Pulumi outputs for Ansible..."
  PULUMI_HOSTS="$(capture_pulumi_hosts "output" "false")"
else
  log "Skipping pulumi provisioning"
fi

# only provision ansible if requested or if no hosts were returned by pulumi
if [[ "${SKIP_ANSIBLE}" == "false" && -n "${PULUMI_HOSTS}" && "${PULUMI_HOSTS}" != "{\"hosts\":null}" ]]; then
  log "Checking tunnel readiness before running Ansible..."
  wait_for_tunnels_ready "${PULUMI_HOSTS}"
  log "Provisioning ansible..."
  ansible_args=(
    --ssh-hosts "${PULUMI_HOSTS}"
    --skip-bws
  )

  if [[ "${SKIP_WEB}" == "true" ]]; then
    ansible_args+=(--skip-web)
  else
    ansible_args+=(--website-dir "${WEBSITE_DIR}")
  fi
  if [[ "${SKIP_BACKEND}" == "true" ]]; then
    ansible_args+=(--skip-backend)
  fi
  if [[ "${SKIP_PERMS}" == "true" ]]; then
    ansible_args+=(--skip-perms)
  fi

  BWS_REQUIRED_VARS="${BWS_REQUIRED_VARS:-}" \
  BACKEND_IMAGE="${BACKEND_IMAGE}" \
  BACKEND_IMAGE_TAG="${BACKEND_IMAGE_TAG}" \
    "${ANSIBLE_RUN}" "${ansible_args[@]}"
else
  log "Skipping ansible provisioning"
fi
