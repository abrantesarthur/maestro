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
