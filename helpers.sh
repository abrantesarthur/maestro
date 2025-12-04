#!/usr/bin/env bash

# require <mode> <log_fn?> "<value/path>" "Message when missing"
require() {
  local mode="$1"
  shift

  local echo_fn="echo"
  local target
  local message

  # Support optional echo/log function as the first argument.
  if [[ $# -ge 3 ]]; then
    echo_fn="$1"
    target="$2"
    message="$3"
  else
    target="$1"
    message="$2"
  fi

  local should_fail=false
  case "${mode}" in
    variable)
      [[ -z "${target}" ]] && should_fail=true
      ;;
    file)
      [[ ! -f "${target}" ]] && should_fail=true
      ;;
    *)
      printf 'Unknown require mode: %s\n' "${mode}" >&2
      exit 1
      ;;
  esac

  if [[ "${should_fail}" == "true" ]]; then
    if [[ "${echo_fn}" == "echo" ]]; then
      printf '%s\n' "${message}" >&2
    else
      "${echo_fn}" "${message}" >&2
    fi
    exit 1
  fi
}

#   require_variable <log_fn?> "<value>" "Message when missing"
require_variable() {
  require variable "$@"
}

# require_file <log_fn?> "<path>" "Message when missing"
require_file() {
  require file "$@"
}

require_bws_variable() {
  local echo_fn="echo"
  local var_name

  # Support optional echo/log function as the first argument.
  if [[ $# -ge 2 ]]; then
    echo_fn="$1"
    var_name="$2"
  else
    var_name="$1"
  fi

  # Use default expansion to avoid errors when the variable is unset under `set -u`.
  require variable "${echo_fn}" "${!var_name-}" "Missing ${var_name} from the bws response."
}


# require_command <log_fn?> <cmd>
require_command() {
  local echo_fn="${1:-echo}"
  local cmd="${2:-}"

  # If only one arg is provided, treat it as the command and default to echo.
  if [[ -z "${cmd}" ]]; then
    cmd="${echo_fn}"
    echo_fn="echo"
  fi

  if ! command -v "${cmd}" >/dev/null 2>&1; then
    "${echo_fn}" "Error: required command '${cmd}' not found in PATH." >&2
    exit 1
  fi
}

# fetches secrets from BWS_PROJECT_ID if specified. Otherwise, fetches from all projects.
source_bws_secrets () {
  require_command echo bws
  set -a
  if [[ -z "${BWS_PROJECT_ID:-}" ]]; then
    eval "$(bws secret list -o env)"
  else
    eval "$(bws secret list -o env "${BWS_PROJECT_ID}")"
  fi
  set +a
}

# write a secret from the environment into a secure temp file and echo the path
create_temp_secret_file() {
  local var_name="${1:?variable name required}"
  local secret_value="${!var_name-}"
  require_variable "${secret_value}" "Missing ${var_name} in the environment."

  local tmp_file
  tmp_file="$(mktemp -t secret_XXXXXX)"
  # normalize escaped newlines, strip CRs, and ensure a trailing newline for OpenSSH
  printf '%b' "${secret_value}" | tr -d '\r' > "${tmp_file}"
  printf '\n' >> "${tmp_file}"
  chmod 600 "${tmp_file}"

  echo "${tmp_file}"
}

# ============================================
# YAML Configuration Helpers (requires yq)
# ============================================

# Read a value from a YAML config file
# Usage: config_get <config_file> <yq_path> [default_value]
# Example: config_get maestro.yaml '.domain' 'example.com'
config_get() {
  local config_file="${1:?config file required}"
  local yq_path="${2:?yq path required}"
  local default_value="${3:-}"

  if [[ ! -f "${config_file}" ]]; then
    if [[ -n "${default_value}" ]]; then
      echo "${default_value}"
      return 0
    fi
    echo "Config file not found: ${config_file}" >&2
    return 1
  fi

  local value
  value="$(yq eval "${yq_path} // \"\"" "${config_file}" 2>/dev/null)"

  # Return default if value is empty or null
  if [[ -z "${value}" || "${value}" == "null" ]]; then
    echo "${default_value}"
  else
    echo "${value}"
  fi
}

# Read a boolean value from YAML config (returns "true" or "false")
# Usage: config_get_bool <config_file> <yq_path> [default_value]
config_get_bool() {
  local config_file="${1:?config file required}"
  local yq_path="${2:?yq path required}"
  local default_value="${3:-false}"

  local value
  value="$(config_get "${config_file}" "${yq_path}" "${default_value}")"

  # Normalize to lowercase and check for truthy values
  case "${value,,}" in
    true|yes|1|on)
      echo "true"
      ;;
    *)
      echo "false"
      ;;
  esac
}

# Read an array from YAML config as newline-separated values
# Usage: config_get_array <config_file> <yq_path>
config_get_array() {
  local config_file="${1:?config file required}"
  local yq_path="${2:?yq path required}"

  if [[ ! -f "${config_file}" ]]; then
    return 0
  fi

  yq eval "${yq_path} // [] | .[]" "${config_file}" 2>/dev/null
}

# Read key-value pairs from a YAML map and export as environment variables
# Usage: config_export_map <config_file> <yq_path> [prefix]
# Example: config_export_map maestro.yaml '.ansible.backend.env' 'BACKEND_ENV_'
config_export_map() {
  local config_file="${1:?config file required}"
  local yq_path="${2:?yq path required}"
  local prefix="${3:-}"

  if [[ ! -f "${config_file}" ]]; then
    return 0
  fi

  local keys_values
  keys_values="$(yq eval "${yq_path} // {} | to_entries | .[] | .key + \"=\" + (.value | tostring)" "${config_file}" 2>/dev/null)"

  while IFS='=' read -r key value; do
    if [[ -n "${key}" ]]; then
      export "${prefix}${key}=${value}"
    fi
  done <<< "${keys_values}"
}

# Check if a YAML path exists and is not null
# Usage: config_has <config_file> <yq_path>
config_has() {
  local config_file="${1:?config file required}"
  local yq_path="${2:?yq path required}"

  if [[ ! -f "${config_file}" ]]; then
    return 1
  fi

  local value
  value="$(yq eval "${yq_path}" "${config_file}" 2>/dev/null)"

  [[ -n "${value}" && "${value}" != "null" ]]
}
