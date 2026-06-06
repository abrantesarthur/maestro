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
require_env_var "PULUMI_PROJECT_NAME"
require_env_var "PULUMI_STACK"
require_env_var "PULUMI_SSH_KEY_PATH"
require_env_var "PULUMI_SERVERS_JSON"
require_env_var "PULUMI_DATABASE_JSON"

# Detect whether the managed database tier is enabled for this stack.
database_enabled() {
  [[ "${PULUMI_DATABASE_JSON}" == *'"enabled":true'* ]] || \
    [[ "${PULUMI_DATABASE_JSON}" == *'"enabled": true'* ]]
}

# Only provisioning commands need provider credentials
if [[ "${PULUMI_COMMAND}" != "output" ]]; then
  require_env_var "CLOUDFLARE_API_TOKEN"
  require_env_var "DIGITALOCEAN_TOKEN"

  # When the database is enabled, USER + NAME come from bitwarden (i.e., process.env) and HOST/PORT/PASSWORD are DigitalOcean derived (i.e., exported as stack outputs).
  # Hence, once the former are required.
  if database_enabled; then
    require_env_var "POSTGRES_USER"
    require_env_var "POSTGRES_DB"
  fi
fi

# Generate Pulumi.yaml dynamically
cat > /workspace/Pulumi.yaml <<EOF
name: ${PULUMI_PROJECT_NAME}
description: Infrastructure provisioning with Pulumi
runtime:
  name: nodejs
  options:
    packagemanager: npm
EOF

# Use PULUMI_ACCESS_TOKEN to log into Pulumi Cloud at api.pulumi.com without prompting.
pulumi login 

# Select the stack, creating it if it doesn't exist
pulumi stack select "${PULUMI_STACK}" --create

print_stack_outputs() {
  echo "__PULUMI_OUTPUTS_BEGIN__"
  # --show-secrets surfaces sensitive secrets, such as POSTGRES_PASSWORD.
  # It is the caller's responsibility to redact everything so these values never reach the teminal or CI logs., 
  pulumi stack output --stack "${PULUMI_STACK}" --json --show-secrets
  echo "__PULUMI_OUTPUTS_END__"
}

# Inject required values in the stack configuration
case "$PULUMI_COMMAND" in
  up|refresh|cancel|destroy)
    pulumi config set --stack "${PULUMI_STACK}" "${PULUMI_PROJECT_NAME}:domain" "$DOMAIN" --non-interactive
    pulumi config set --stack "${PULUMI_STACK}" "${PULUMI_PROJECT_NAME}:cloudflareAccountId" "$CLOUDFLARE_ACCOUNT_ID" --non-interactive
    pulumi config set --stack "${PULUMI_STACK}" "${PULUMI_PROJECT_NAME}:sshKeyPath" "$PULUMI_SSH_KEY_PATH" --non-interactive
    pulumi config set --stack "${PULUMI_STACK}" "${PULUMI_PROJECT_NAME}:backendPort" "$BACKEND_PORT" --non-interactive
    pulumi config set --stack "${PULUMI_STACK}" "${PULUMI_PROJECT_NAME}:sshPort" "$SSH_PORT" --non-interactive
    pulumi config set --stack "${PULUMI_STACK}" "${PULUMI_PROJECT_NAME}:servers" "$PULUMI_SERVERS_JSON" --non-interactive
    pulumi config set --stack "${PULUMI_STACK}" "${PULUMI_PROJECT_NAME}:database" "$PULUMI_DATABASE_JSON" --non-interactive
    if database_enabled; then
      pulumi config set --stack "${PULUMI_STACK}" "${PULUMI_PROJECT_NAME}:postgresUser" "$POSTGRES_USER" --non-interactive
      pulumi config set --stack "${PULUMI_STACK}" "${PULUMI_PROJECT_NAME}:postgresDb" "$POSTGRES_DB" --non-interactive
    fi
esac

# Run the requested Pulumi action
case "$PULUMI_COMMAND" in
  up)
    pulumi up --yes --stack "${PULUMI_STACK}"
    print_stack_outputs
    ;;
  refresh)
    pulumi refresh --stack "${PULUMI_STACK}"
    ;;
  cancel)
    pulumi cancel --stack "${PULUMI_STACK}"
    ;;
  destroy)
    pulumi refresh --yes --stack "${PULUMI_STACK}"
    pulumi destroy --yes --stack "${PULUMI_STACK}"
    ;;
  output)
    print_stack_outputs
    ;;
  *)
    printf 'Unsupported PULUMI_COMMAND env var: %s (expected "up", "refresh", "cancel", "output", or "destroy")\n' "$PULUMI_COMMAND" >&2
    exit 1
    ;;
esac
