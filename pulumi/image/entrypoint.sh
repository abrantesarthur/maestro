#!/bin/bash
set -euo pipefail

log () {
  local msg="${1}"
  echo "[pulumi-image]: ${msg}"
}

require_env_var() {
  local name="${1:-}"
  local value="${!name-}"

  if [ -z "$value" ]; then
    log "Error: environment variable '$name' must be set"
    exit 1
  fi
}
require_env_var "BACKEND_PORT"
require_env_var "SSH_PORT"
require_env_var "DOMAIN"
require_env_var "CLOUDFLARE_ACCOUNT_ID"
require_env_var "PULUMI_ACCESS_TOKEN" 
require_env_var "PULUMI_COMMAND" 
require_env_var "PULUMI_SSH_KEY_PATH"
require_env_var "PULUMI_SERVERS_JSON" 

# Only provisioning commands need provider credentials
if [[ "${PULUMI_COMMAND}" != "output" ]]; then
  require_env_var "CLOUDFLARE_API_TOKEN"
  require_env_var "DIGITALOCEAN_TOKEN"
fi

# Use PULUMI_ACCESS_TOKEN to log into Pulumi Cloud at api.pulumi.com without prompting.
pulumi login 

print_stack_outputs() {
  echo "__PULUMI_OUTPUTS_BEGIN__"
  pulumi stack output --stack prod --json
  echo "__PULUMI_OUTPUTS_END__"
}

# Inject required values in the prod configuration
case "$PULUMI_COMMAND" in
  up|refresh|cancel)
    pulumi config set --stack prod maestro:domain "$DOMAIN" --non-interactive
    pulumi config set --stack prod maestro:cloudflareAccountId "$CLOUDFLARE_ACCOUNT_ID" --non-interactive
    pulumi config set --stack prod maestro:sshKeyPath "$PULUMI_SSH_KEY_PATH" --non-interactive
    pulumi config set --stack prod maestro:backendPort "$BACKEND_PORT" --non-interactive
    pulumi config set --stack prod maestro:sshPort "$SSH_PORT" --non-interactive
    pulumi config set --stack prod maestro:servers "$PULUMI_SERVERS_JSON" --non-interactive
esac

# Run the requested Pulumi action
case "$PULUMI_COMMAND" in
  up)
    pulumi up --yes --stack prod
    print_stack_outputs
    ;;
  refresh)
    pulumi refresh --stack prod
    ;;
  cancel)
    pulumi cancel --stack prod
    ;;
  output)
    print_stack_outputs
    ;;
  *)
    printf 'Unsupported PULUMI_COMMAND env var: %s (expected "up", "refresh", "cancel", or "output")\n' "$PULUMI_COMMAND" >&2
    exit 1
    ;;
esac
