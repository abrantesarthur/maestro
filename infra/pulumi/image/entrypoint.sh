#!/bin/bash
set -euo pipefail

if [[ -z "${PULUMI_ACCESS_TOKEN:-}" ]]; then
    echo "PULUMI_ACCESS_TOKEN must be set for Pulumi authentication" >&2
    exit 1
fi
if [[ -z "${PULUMI_COMMAND:-}" ]]; then
    echo "PULUMI_COMMAND must be set for how to run pulumi" >&2
    exit 1
fi

# Only provisioning commands need provider credentials
if [[ "${PULUMI_COMMAND}" != "output" ]]; then
    if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
        echo "CLOUDFLARE_API_TOKEN must be set for Cloudflare authentication" >&2
        exit 1
    fi
    if [[ -z "${DIGITALOCEAN_TOKEN:-}" ]]; then
        echo "DIGITALOCEAN_TOKEN must be set for Digital Ocean authentication" >&2
        exit 1
    fi
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
    pulumi config set --stack prod dalhe:sshKeyPath "$PULUMI_SSH_KEY_PATH" --non-interactive
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
