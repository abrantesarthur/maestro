#!/usr/bin/env bash
set -euo pipefail


SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PULUMI_RUN="${SCRIPT_DIR}/pulumi/run.sh"
ANSIBLE_RUN="${SCRIPT_DIR}/ansible/run.sh"

# Parse mandatory arguments
SKIP_PULUMI=false
SKIP_ANSIBLE=false
DIGITALOCEAN_TOKEN=""
PULUMI_ACCESS_TOKEN=""
CLOUDFLARE_API_TOKEN=""
HOST_SSH_KEY_PATH=""
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
    --digital-ocean-token)
      [[ -n "${2:-}" ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 1; }
      DIGITALOCEAN_TOKEN="$2"
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

require_var() {
  local value="$1"
  local message="$2"
  if [[ -z "${value}" ]]; then
    printf '%s\n' "${message}" >&2
    exit 1
  fi
}

if [[ "${SKIP_PULUMI}" == "false" || "${SKIP_ANSIBLE}" == "false" ]]; then
  require_var "${PULUMI_ACCESS_TOKEN}" 'Error: --pulumi-access-token <token> is required when interacting with Pulumi.'
  require_var "${HOST_SSH_KEY_PATH}" 'Error: --ssh-key </path/to/key> is required for Pulumi or Ansible.'
fi

if [[ "${SKIP_PULUMI}" == "false" ]]; then
  require_var "${CLOUDFLARE_API_TOKEN}" 'Error: --cloudflare-api-token <token> is required when running Pulumi.'
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

capture_ssh_hostnames() {
  local pulumi_command="$1"
  local show_logs="${2:-true}"
  local output_log
  output_log="$(mktemp -t pulumi_output)"
  PULUMI_OUTPUT_LOGS+=("${output_log}")

  local pulumi_args=(
    --pulumi-access-token "${PULUMI_ACCESS_TOKEN}"
    --command "${pulumi_command}"
  )

  if [[ "${pulumi_command}" != "output" ]]; then
    pulumi_args+=(
      --cloudflare-api-token "${CLOUDFLARE_API_TOKEN}"
      --digital-ocean-token "${DIGITALOCEAN_TOKEN}"
      --ssh-key "${HOST_SSH_KEY_PATH}"
    )
  fi

  if [[ "${show_logs}" == "true" ]]; then
    "${PULUMI_RUN}" "${pulumi_args[@]}" | tee "${output_log}"
  else
    "${PULUMI_RUN}" "${pulumi_args[@]}" > "${output_log}"
  fi

  local parsed_hosts
  parsed_hosts="$(
    awk '
      /__PULUMI_OUTPUTS_BEGIN__/ {capture=1; next}
      /__PULUMI_OUTPUTS_END__/ {capture=0}
      capture && $1 == "sshHostnames" {print $2; exit}
    ' "${output_log}" \
    | sed 's/^[[:space:]]*\[//; s/\][[:space:]]*$//' \
    | tr -d '"' \
    | tr -d '[:space:]'
  )"

  printf '%s' "${parsed_hosts}"
}

# only provision pulumi if requested
SSH_HOSTNAMES=""
if [[ "${SKIP_PULUMI}" == "false" ]]; then
  # provision pulumi and capture created ssh hostnames
  echo "Provisioning cloudflare..."
  SSH_HOSTNAMES="$(capture_ssh_hostnames "up")"
elif [[ "${SKIP_ANSIBLE}" == "false" ]]; then
  echo "Fetching existing Pulumi outputs for Ansible..."
  SSH_HOSTNAMES="$(capture_ssh_hostnames "output" "false")"
else
  echo "Skipping pulumi provisioning"
fi

# only provision ansible if requested
if [[ "${SKIP_ANSIBLE}" == "false" ]]; then
  echo "Provisioning ansible..."
  "${ANSIBLE_RUN}" --ssh-hostnames "${SSH_HOSTNAMES}" --ssh-key "${HOST_SSH_KEY_PATH}"
else
  echo "Skipping ansible provisioning"
fi
