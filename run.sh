#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPERS_PATH="$(cd -- "${SCRIPT_DIR}" && pwd)/helpers.sh"
PULUMI_RUN="${SCRIPT_DIR}/pulumi/run.sh"
ANSIBLE_RUN="${SCRIPT_DIR}/ansible/run.sh"
CONFIG_FILE="${SCRIPT_DIR}/maestro.yaml"

# import helper functions
source "$HELPERS_PATH"

# Create logging and require functions with custom logger
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
cfg_get() {
  config_get log "${CONFIG_FILE}" "$@"
}
cfg_get_bool() {
  config_get_bool log "${CONFIG_FILE}" "$@"
}
cfg_get_array() {
  config_get_array log "${CONFIG_FILE}" "$@"
}
cfg_export_map() {
  config_export_map log "${CONFIG_FILE}" "$@"
}
cfg_has() {
  config_has log "${CONFIG_FILE}" "$@"
}

# Parse minimal CLI arguments (only --config and --dry-run supported)
log "Parsing arguments..."
DRY_RUN=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift 1
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      printf 'Usage: %s [--dry-run]\n' "$0" >&2
      exit 1
      ;;
  esac
done

log "Ensuring required commands exist..."
require_cmd jq
require_cmd yq
require_cmd cloudflared

# Validate config file exists
if [[ ! -f "${CONFIG_FILE}" ]]; then
  log "Error: Config file not found at ${CONFIG_FILE}"
  log "Create a maestro.yaml file. See example.maestro.yaml for a template."
  exit 1
fi

log "Loading configuration from ${CONFIG_FILE}..."

# ============================================
# Read configuration from YAML
# ============================================

# Domain configuration (shared between pulumi and ansible)
DOMAIN="$(cfg_get '.domain' '')"
require_var "${DOMAIN}" "domain is required in ${CONFIG_FILE}"

# Pulumi configuration
PULUMI_ENABLED="$(cfg_get_bool '.pulumi.enabled' 'true')"
PULUMI_COMMAND="$(cfg_get '.pulumi.command' 'up')"
CLOUDFLARE_ACCOUNT_ID="$(cfg_get '.pulumi.cloudflare_account_id' '')"
SSH_PORT="$(cfg_get '.pulumi.ssh_port' '22')"

# Pulumi servers configuration (read as JSON for validation and export)
PULUMI_SERVERS_JSON="$(yq eval -o=json '.pulumi.servers // []' "${CONFIG_FILE}" 2>/dev/null)"

# Ansible configuration
ANSIBLE_ENABLED="$(cfg_get_bool '.ansible.enabled' 'true')"
WEBSITE_DIR="$(cfg_get '.ansible.website_dir' '')"

# Ansible sub-components
WEB_ENABLED="$(cfg_get_bool '.ansible.web.enabled' 'true')"
BACKEND_ENABLED="$(cfg_get_bool '.ansible.backend.enabled' 'true')"
PERMS_ENABLED="$(cfg_get_bool '.ansible.perms.enabled' 'true')"

# Backend configuration
BACKEND_IMAGE="$(cfg_get '.ansible.backend.image' '')"
BACKEND_IMAGE_TAG="$(cfg_get '.ansible.backend.tag' '')"
BACKEND_PORT="$(cfg_get '.ansible.backend.port' '3000')"

# Secrets configuration
SECRETS_PROVIDER="$(cfg_get '.secrets.provider' 'bws')"
BWS_PROJECT_ID="$(cfg_get '.secrets.project_id' '')"

# Export backend environment variables from YAML (ansible.backend.env -> BACKEND_ENV_*)
cfg_export_map '.ansible.backend.env' 'BACKEND_ENV_'

# Auto-inject PORT into the container environment from backend.port
export BACKEND_ENV_PORT="${BACKEND_PORT}"


# ============================================
# Validate configuration
# ============================================

if [[ "${PULUMI_ENABLED}" == "true" ]]; then
  require_var "${CLOUDFLARE_ACCOUNT_ID}" "pulumi.cloudflare_account_id is required when pulumi is enabled"
  
  # Validate pulumi.servers is present and non-empty
  server_count="$(echo "${PULUMI_SERVERS_JSON}" | jq 'length')"
  if [[ "${server_count}" -eq 0 ]]; then
    log "Error: pulumi.servers is required when pulumi is enabled. Define at least one server."
    exit 1
  fi
  
  # Validate each server entry
  for i in $(seq 0 $((server_count - 1))); do
    server="$(echo "${PULUMI_SERVERS_JSON}" | jq ".[$i]")"
    env_tag="$(echo "${server}" | jq -r '.environment // ""')"
    roles="$(echo "${server}" | jq -r '.roles // []')"
    roles_count="$(echo "${server}" | jq '.roles // [] | length')"
    
    # Validate environment tag
    if [[ -z "${env_tag}" ]]; then
      log "Error: pulumi.servers[$i].environment is required (must be one of: dev, staging, prod)"
      exit 1
    fi
    if [[ "${env_tag}" != "dev" && "${env_tag}" != "staging" && "${env_tag}" != "prod" ]]; then
      log "Error: pulumi.servers[$i].environment '${env_tag}' is invalid (must be one of: dev, staging, prod)"
      exit 1
    fi
    
    # Validate roles
    if [[ "${roles_count}" -eq 0 ]]; then
      log "Error: pulumi.servers[$i].roles is required (must include at least one of: backend, web)"
      exit 1
    fi
    
    # Validate each role is valid
    for j in $(seq 0 $((roles_count - 1))); do
      role="$(echo "${server}" | jq -r ".roles[$j]")"
      if [[ "${role}" != "backend" && "${role}" != "web" ]]; then
        log "Error: pulumi.servers[$i].roles contains invalid role '${role}' (must be one of: backend, web)"
        exit 1
      fi
    done
  done
  log "Validated ${server_count} server(s) in pulumi.servers"
fi

if [[ "${ANSIBLE_ENABLED}" == "true" && "${WEB_ENABLED}" == "true" ]]; then
  require_var "${WEBSITE_DIR}" "ansible.website_dir is required when web provisioning is enabled"
fi

if [[ "${ANSIBLE_ENABLED}" == "true" && "${BACKEND_ENABLED}" == "true" ]]; then
  require_var "${BACKEND_IMAGE}" "ansible.backend.image is required when backend provisioning is enabled"
  require_var "${BACKEND_IMAGE_TAG}" "ansible.backend.tag is required when backend provisioning is enabled"
fi

if [[ "${SECRETS_PROVIDER}" != "bws" ]]; then
  log "Error: secrets.provider must be 'bws'. Other providers are not supported yet."
  exit 1
fi

# ============================================
# Display configuration (dry-run mode)
# ============================================

if [[ "${DRY_RUN}" == "true" ]]; then
  log "Dry-run mode enabled. Configuration loaded:"
  log "  domain: ${DOMAIN}"
  log "  pulumi.enabled: ${PULUMI_ENABLED}"
  log "  pulumi.command: ${PULUMI_COMMAND}"
  log "  pulumi.cloudflare_account_id: ${CLOUDFLARE_ACCOUNT_ID}"
  log "  pulumi.ssh_port: ${SSH_PORT}"
  log "  pulumi.servers: $(echo "${PULUMI_SERVERS_JSON}" | jq -c '.')"
  log "  ansible.enabled: ${ANSIBLE_ENABLED}"
  log "  ansible.website_dir: ${WEBSITE_DIR}"
  log "  ansible.web.enabled: ${WEB_ENABLED}"
  log "  ansible.backend.enabled: ${BACKEND_ENABLED}"
  log "  ansible.backend.image: ${BACKEND_IMAGE}"
  log "  ansible.backend.tag: ${BACKEND_IMAGE_TAG}"
  log "  ansible.backend.port: ${BACKEND_PORT}"
  log "  ansible.perms.enabled: ${PERMS_ENABLED}"
  log "  secrets.provider: ${SECRETS_PROVIDER}"
  log "  secrets.project_id: ${BWS_PROJECT_ID:-<not set>}"
  # Show BACKEND_ENV_* variables
  log "  Backend environment variables:"
  env | grep '^BACKEND_ENV_' | while read -r line; do
    log "    ${line}"
  done || log "    (none)"
  exit 0
fi

# ============================================
# Fetch secrets from Bitwarden
# ============================================
if [[ "${SECRETS_PROVIDER}" == "bws" ]]; then
  log "Fetching secrets from Bitwarden..."
  # Export BWS_PROJECT_ID if specified in config
  if [[ -n "${BWS_PROJECT_ID}" ]]; then
    export BWS_PROJECT_ID
  fi
  source_bws_secrets
fi

log "Ensuring required secrets and variables exist in the environment..."
require_bws_var 'GHCR_TOKEN'
require_bws_var 'VPS_SSH_KEY'

if [[ "${PULUMI_ENABLED}" == "true" || "${ANSIBLE_ENABLED}" == "true" ]]; then
  require_bws_var 'PULUMI_ACCESS_TOKEN'
fi

if [[ "${PULUMI_ENABLED}" == "true" ]]; then
  require_bws_var 'CLOUDFLARE_API_TOKEN'
  require_bws_var 'DIGITALOCEAN_TOKEN'
fi

if [[ "${ANSIBLE_ENABLED}" == "true" ]]; then
  require_bws_var 'GHCR_USERNAME'
fi

# Validate user-specified BWS secrets from config
while IFS= read -r var; do
  [[ -n "${var}" ]] && require_bws_var "${var}"
done < <(cfg_get_array '.secrets.required_vars')

# ============================================
# Setup and helper functions
# ============================================

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

  # Export configuration as environment variables for pulumi/run.sh
  export DOMAIN
  export CLOUDFLARE_ACCOUNT_ID
  export SSH_PORT
  export BACKEND_PORT
  export PULUMI_SERVERS_JSON

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

# ============================================
# Run Pulumi provisioning
# ============================================

PULUMI_HOSTS=""
if [[ "${PULUMI_ENABLED}" == "true" ]]; then
  log "Provisioning pulumi..."
  PULUMI_HOSTS="$(capture_pulumi_hosts "${PULUMI_COMMAND}")"
elif [[ "${ANSIBLE_ENABLED}" == "true" ]]; then
  log "Fetching existing Pulumi outputs for Ansible..."
  PULUMI_HOSTS="$(capture_pulumi_hosts "output" "false")"
else
  log "Skipping pulumi provisioning"
fi

# ============================================
# Run Ansible provisioning
# ============================================

if [[ "${ANSIBLE_ENABLED}" == "true" && -n "${PULUMI_HOSTS}" && "${PULUMI_HOSTS}" != "{\"hosts\":null}" ]]; then
  log "Checking tunnel readiness before running Ansible..."
  wait_for_tunnels_ready "${PULUMI_HOSTS}"
  log "Provisioning ansible..."

  # Export configuration as environment variables for ansible/run.sh
  export DOMAIN
  export BACKEND_PORT
  export BACKEND_IMAGE
  export BACKEND_IMAGE_TAG

  ansible_args=(
    --ssh-hosts "${PULUMI_HOSTS}"
    --skip-bws
  )

  if [[ "${WEB_ENABLED}" == "true" ]]; then
    ansible_args+=(--website-dir "${WEBSITE_DIR}")
  else
    ansible_args+=(--skip-web)
  fi
  if [[ "${BACKEND_ENABLED}" != "true" ]]; then
    ansible_args+=(--skip-backend)
  fi
  if [[ "${PERMS_ENABLED}" != "true" ]]; then
    ansible_args+=(--skip-perms)
  fi

  "${ANSIBLE_RUN}" "${ansible_args[@]}"
else
  log "Skipping ansible provisioning"
fi

log "Done."
