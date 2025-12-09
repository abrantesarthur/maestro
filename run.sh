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

# Pulumi stacks configuration (read as JSON for validation and export)
PULUMI_STACKS_JSON="$(yq eval -o=json '.pulumi.stacks // {}' "${CONFIG_FILE}" 2>/dev/null)"

# Ansible configuration
ANSIBLE_ENABLED="$(cfg_get_bool '.ansible.enabled' 'true')"

# Security configuration - managed groups (read as JSON array)
MANAGED_GROUPS="$(yq eval -o=json '.ansible.groups // ["devops"]' "${CONFIG_FILE}" 2>/dev/null)"

# Web configuration - determine mode (static vs docker)
# Mode is determined by presence of static or docker block
WEB_MODE=""
if cfg_has '.ansible.web.static'; then
  WEB_MODE="static"
elif cfg_has '.ansible.web.docker'; then
  WEB_MODE="docker"
fi

# Static mode configuration
WEB_STATIC_SOURCE="$(cfg_get '.ansible.web.static.source' 'local')"
WEB_STATIC_DIR="$(cfg_get '.ansible.web.static.dir' '')"
WEB_STATIC_BUILD="$(cfg_get '.ansible.web.static.build' '')"
WEB_STATIC_DIST="$(cfg_get '.ansible.web.static.dist' 'dist')"
WEB_STATIC_IMAGE="$(cfg_get '.ansible.web.static.image' '')"
WEB_STATIC_TAG="$(cfg_get '.ansible.web.static.tag' 'latest')"
WEB_STATIC_PATH="$(cfg_get '.ansible.web.static.path' '/app/dist')"

# Docker mode configuration
WEB_DOCKER_IMAGE="$(cfg_get '.ansible.web.docker.image' '')"
WEB_DOCKER_TAG="$(cfg_get '.ansible.web.docker.tag' 'latest')"
WEB_DOCKER_PORT="$(cfg_get '.ansible.web.docker.port' '3000')"

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
  
  # Get list of defined stacks
  PULUMI_STACK_NAMES=()
  while IFS= read -r stack_name; do
    [[ -n "${stack_name}" ]] && PULUMI_STACK_NAMES+=("${stack_name}")
  done < <(echo "${PULUMI_STACKS_JSON}" | jq -r 'keys[]')
  
  if [[ ${#PULUMI_STACK_NAMES[@]} -eq 0 ]]; then
    log "Error: pulumi.stacks is required when pulumi is enabled. Define at least one stack (dev, staging, or prod)."
    exit 1
  fi
  
  # Validate each stack and its servers
  total_server_count=0
  for stack_name in "${PULUMI_STACK_NAMES[@]}"; do
    # Validate stack name
    if [[ "${stack_name}" != "dev" && "${stack_name}" != "staging" && "${stack_name}" != "prod" ]]; then
      log "Error: pulumi.stacks contains invalid stack '${stack_name}' (must be one of: dev, staging, prod)"
      exit 1
    fi
    
    # Get servers for this stack
    stack_servers_json="$(echo "${PULUMI_STACKS_JSON}" | jq ".\"${stack_name}\".servers // []")"
    server_count="$(echo "${stack_servers_json}" | jq 'length')"
    
    if [[ "${server_count}" -eq 0 ]]; then
      log "Error: pulumi.stacks.${stack_name}.servers is required. Define at least one server."
      exit 1
    fi
    
    # Validate each server entry in this stack
    for i in $(seq 0 $((server_count - 1))); do
      server="$(echo "${stack_servers_json}" | jq ".[$i]")"
      roles_count="$(echo "${server}" | jq '.roles // [] | length')"
      
      # Validate roles
      if [[ "${roles_count}" -eq 0 ]]; then
        log "Error: pulumi.stacks.${stack_name}.servers[$i].roles is required (must include at least one of: backend, web)"
        exit 1
      fi
      
      # Validate each role is valid
      for j in $(seq 0 $((roles_count - 1))); do
        role="$(echo "${server}" | jq -r ".roles[$j]")"
        if [[ "${role}" != "backend" && "${role}" != "web" ]]; then
          log "Error: pulumi.stacks.${stack_name}.servers[$i].roles contains invalid role '${role}' (must be one of: backend, web)"
          exit 1
        fi
      done
    done
    
    total_server_count=$((total_server_count + server_count))
  done
  log "Validated ${#PULUMI_STACK_NAMES[@]} stack(s) with ${total_server_count} total server(s)"
  
  # Collect all unique roles from all stacks for role-based Ansible provisioning
  ALL_ROLES_JSON="$(echo "${PULUMI_STACKS_JSON}" | jq '[.[].servers[].roles[]] | unique')"
  HAS_ROLE_WEB="$(echo "${ALL_ROLES_JSON}" | jq 'any(. == "web")')"
  HAS_ROLE_BACKEND="$(echo "${ALL_ROLES_JSON}" | jq 'any(. == "backend")')"
  log "Detected roles: $(echo "${ALL_ROLES_JSON}" | jq -c '.')"
fi

# Role-based validation: if a role is used, its config must exist
if [[ "${ANSIBLE_ENABLED}" == "true" && "${HAS_ROLE_WEB:-false}" == "true" ]]; then
  if [[ -z "${WEB_MODE}" ]]; then
    log "Error: ansible.web.static or ansible.web.docker must be configured when servers have the 'web' role"
    exit 1
  fi
  
  if [[ "${WEB_MODE}" == "static" ]]; then
    if [[ "${WEB_STATIC_SOURCE}" == "local" ]]; then
      require_var "${WEB_STATIC_DIR}" "ansible.web.static.dir is required when source is 'local'"
    elif [[ "${WEB_STATIC_SOURCE}" == "image" ]]; then
      require_var "${WEB_STATIC_IMAGE}" "ansible.web.static.image is required when source is 'image'"
    else
      log "Error: ansible.web.static.source must be 'local' or 'image', got '${WEB_STATIC_SOURCE}'"
      exit 1
    fi
  elif [[ "${WEB_MODE}" == "docker" ]]; then
    require_var "${WEB_DOCKER_IMAGE}" "ansible.web.docker.image is required for docker mode"
  fi
fi

if [[ "${ANSIBLE_ENABLED}" == "true" && "${HAS_ROLE_BACKEND:-false}" == "true" ]]; then
  require_var "${BACKEND_IMAGE}" "ansible.backend.image is required when servers have the 'backend' role"
  require_var "${BACKEND_IMAGE_TAG}" "ansible.backend.tag is required when servers have the 'backend' role"
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
  log "  pulumi.stacks: $(echo "${PULUMI_STACKS_JSON}" | jq -c '.')"
  log "  detected roles: ${ALL_ROLES_JSON:-[]}"
  log "  ansible.enabled: ${ANSIBLE_ENABLED}"
  log "  ansible.web (role=${HAS_ROLE_WEB:-false}):"
  log "    mode: ${WEB_MODE:-<not configured>}"
  if [[ "${WEB_MODE}" == "static" ]]; then
    log "    static.source: ${WEB_STATIC_SOURCE}"
    if [[ "${WEB_STATIC_SOURCE}" == "local" ]]; then
      log "    static.dir: ${WEB_STATIC_DIR}"
      log "    static.build: ${WEB_STATIC_BUILD:-<none>}"
      log "    static.dist: ${WEB_STATIC_DIST}"
    else
      log "    static.image: ${WEB_STATIC_IMAGE}"
      log "    static.tag: ${WEB_STATIC_TAG}"
      log "    static.path: ${WEB_STATIC_PATH}"
    fi
  elif [[ "${WEB_MODE}" == "docker" ]]; then
    log "    docker.image: ${WEB_DOCKER_IMAGE}"
    log "    docker.tag: ${WEB_DOCKER_TAG}"
    log "    docker.port: ${WEB_DOCKER_PORT}"
  fi
  log "  ansible.backend (role=${HAS_ROLE_BACKEND:-false}):"
  log "    image: ${BACKEND_IMAGE}"
  log "    tag: ${BACKEND_IMAGE_TAG}"
  log "    port: ${BACKEND_PORT}"
  log "  ansible.groups: ${MANAGED_GROUPS}"
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
  local stack_name="$1"
  local pulumi_command="$2"
  local servers_json="$3"
  local show_logs="${4:-true}"
  local output_log
  output_log="$(mktemp -t pulumi_output)"
  PULUMI_OUTPUT_LOGS+=("${output_log}")

  # Export configuration as environment variables for pulumi/run.sh
  export DOMAIN
  export CLOUDFLARE_ACCOUNT_ID
  export SSH_PORT
  export BACKEND_PORT
  export PULUMI_STACK="${stack_name}"
  export PULUMI_SERVERS_JSON="${servers_json}"

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

# Aggregate hosts from all stacks for Ansible
ALL_HOSTS_JSON='{"hosts":[]}'

if [[ "${PULUMI_ENABLED}" == "true" ]]; then
  log "Provisioning ${#PULUMI_STACK_NAMES[@]} stack(s)..."
  for stack_name in "${PULUMI_STACK_NAMES[@]}"; do
    log "Provisioning stack: ${stack_name}"
    stack_servers_json="$(echo "${PULUMI_STACKS_JSON}" | jq -c ".\"${stack_name}\".servers // []")"
    stack_hosts="$(capture_pulumi_hosts "${stack_name}" "${PULUMI_COMMAND}" "${stack_servers_json}")"
    # Merge hosts from this stack into the aggregate
    ALL_HOSTS_JSON="$(echo "${ALL_HOSTS_JSON}" "${stack_hosts}" | jq -s '{"hosts": (.[0].hosts + (.[1].hosts // []))}')"
  done
elif [[ "${ANSIBLE_ENABLED}" == "true" ]]; then
  log "Fetching existing Pulumi outputs for Ansible..."
  for stack_name in "${PULUMI_STACK_NAMES[@]}"; do
    stack_servers_json="$(echo "${PULUMI_STACKS_JSON}" | jq -c ".\"${stack_name}\".servers // []")"
    stack_hosts="$(capture_pulumi_hosts "${stack_name}" "output" "${stack_servers_json}" "false")"
    # Merge hosts from this stack into the aggregate
    ALL_HOSTS_JSON="$(echo "${ALL_HOSTS_JSON}" "${stack_hosts}" | jq -s '{"hosts": (.[0].hosts + (.[1].hosts // []))}')"
  done
else
  log "Skipping pulumi provisioning"
fi

PULUMI_HOSTS="${ALL_HOSTS_JSON}"

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
  
  # Export web configuration
  export WEB_MODE
  export WEB_STATIC_SOURCE
  export WEB_STATIC_DIR
  export WEB_STATIC_BUILD
  export WEB_STATIC_DIST
  export WEB_STATIC_IMAGE
  export WEB_STATIC_TAG
  export WEB_STATIC_PATH
  export WEB_DOCKER_IMAGE
  export WEB_DOCKER_TAG
  export WEB_DOCKER_PORT
  
  # Export web docker environment variables from YAML (ansible.web.docker.env -> WEB_DOCKER_ENV_*)
  if [[ "${WEB_MODE}" == "docker" ]]; then
    cfg_export_map '.ansible.web.docker.env' 'WEB_DOCKER_ENV_'
  fi

  # Export security configuration (managed groups as JSON array)
  export MANAGED_GROUPS

  ansible_args=(
    --ssh-hosts "${PULUMI_HOSTS}"
    --skip-bws
  )

  # Role-based provisioning: skip playbooks if no server has that role
  # Note: security.yml always runs on all servers (not role-based)
  if [[ "${HAS_ROLE_WEB:-false}" != "true" ]]; then
    ansible_args+=(--skip-web)
  fi
  if [[ "${HAS_ROLE_BACKEND:-false}" != "true" ]]; then
    ansible_args+=(--skip-backend)
  fi

  "${ANSIBLE_RUN}" "${ansible_args[@]}"
else
  log "Skipping ansible provisioning"
fi

log "Done."
