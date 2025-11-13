#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <host>" >&2
  exit 1
fi

SSH_USER="root"
SSH_PORT="22"
SSH_KEY="/root/.ssh/ssh_dalhe_ai" # mounted by docker run
HOST="$1"

log() {
  echo "[stop-cloudflared] $*"
}

SSH_OPTS=(
  -i "${SSH_KEY}"
  -p "${SSH_PORT}"
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
  -o ConnectTimeout=10
)

REMOTE_CMD=$(cat <<'EOF'
set -euo pipefail
if systemctl is-active --quiet cloudflared; then
  systemctl stop cloudflared
else
  systemctl stop cloudflared || true
fi
EOF
)

log "Stopping cloudflared on ${HOST}"
if ! ssh_output=$(ssh "${SSH_OPTS[@]}" "${SSH_USER}@${HOST}" "${REMOTE_CMD}" 2>&1); then
  ssh_status=$?
  if [[ ${ssh_status} -eq 255 ]] && grep -qiE 'could not resolve hostname|name or service not known|temporary failure in name resolution|no address associated with hostname' <<<"${ssh_output}"; then
    log "Host ${HOST} does not exist; treating as already stopped"
    exit 0
  fi
  echo "${ssh_output}" >&2
  exit "${ssh_status}"
fi
if [[ -n "${ssh_output}" ]]; then
  echo "${ssh_output}"
fi
log "Successfully stopped cloudflare on ${HOST}"
