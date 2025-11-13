#!/bin/bash
set -euo pipefail

# Ensure the api keys are set in the environment
if [[ -z "${PULUMI_ACCESS_TOKEN:-}" ]]; then
    echo "PULUMI_ACCESS_TOKEN must be set for Pulumi authentication" >&2
    exit 1
fi
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    echo "CLOUDFLARE_API_TOKEN must be set for Cloudflare authentication" >&2
    exit 1
fi
if [[ -z "${DIGITAL_OCEAN_API_KEY:-}" ]]; then
    echo "DIGITAL_OCEAN_API_KEY must be set for Digital Ocean authentication" >&2
    exit 1
fi
if [[ -z "${PULUMI_COMMAND:-}" ]]; then
    echo "PULUMI_COMMAND must be set for how to run pulumi" >&2
    exit 1
fi

# Use PULUMI_ACCESS_TOKEN to log into Pulumi Cloud at api.pulumi.com without prompting.
pulumi login 

if [[ -n "${PULUMI_CONFIG_PROD_IPV4S:-}" ]]; then
  pulumi config set --stack prod "dalhe:prodIpv4s" "${PULUMI_CONFIG_PROD_IPV4S}"
fi

# Run the requested Pulumi action
case "$PULUMI_COMMAND" in
  up)
    pulumi up --yes --stack prod
    echo "__PULUMI_OUTPUTS_BEGIN__"
    pulumi stack output --stack prod
    echo "__PULUMI_OUTPUTS_END__"
    ;;
  refresh)
    pulumi refresh --stack prod
    ;;
  cancel)
    pulumi cancel --stack prod
    ;;
  *)
    printf 'Unsupported PULUMI_COMMAND env var: %s (expected "up" or "refresh")\n' "$PULUMI_COMMAND" >&2
    exit 1
    ;;
esac
