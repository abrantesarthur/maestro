# Backend

Lightweight Bun HTTP service exposing a `/health` endpoint on port 3000.

## Workflow

```bash
# Default image ghcr.io/dalhe-ai/backend, tag from git short SHA
./deploy_image.sh --latest

# Override the tag or image if needed
# GHCR_IMAGE="ghcr.io/dalhe-ai/backend" TAG="v0.1.0" ./deploy_image.sh --platforms linux/amd64,linux/arm64
```

## Required environment

| Variable           | Purpose                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BWS_ACCESS_TOKEN` | Bitwarden Secrets Manager's token required for retrieving other secrets.                                                                                     |
| `BWS_PROJECT_ID`   | The id of the Bitwarden Secrets Manager's project from which to draw secrets. It defaults to the value of the BWS_PROD_INFRA_PROJECT_ID environment variable |

## Optional environment

| Variable     | Purpose                                                          |
| ------------ | ---------------------------------------------------------------- |
| `GHCR_IMAGE` | Target image reference; defaults to `ghcr.io/dalhe-ai/backend`.  |
| `TAG`        | Image tag; defaults to the git short SHA if not set.             |
| `PLATFORMS`  | Comma-separated platforms for buildx; defaults to `linux/amd64`. |

## Optional flags

| Flag              | Purpose                                                                     |
| ----------------- | --------------------------------------------------------------------------- |
| `--tag <tag>`     | Override the image tag instead of using the git short SHA.                  |
| `--latest`        | Also tag and push the image as `:latest`.                                   |
| `--platforms <p>` | Override platforms (e.g., `linux/amd64,linux/arm64`) for multi-arch builds. |
| `-h`, `--help`    | Show script usage.                                                          |

## Components

`local.env`: The environment injected into the app when running locally.

# TODO:

- Security: configure mTLS for webhooks https://developers.facebook.com/docs/graph-api/webhooks/getting-started/#mtls-for-webhooks
- Logs: how can we easily see production logs?
- Update this README and Notion security to mention BWS.
  - We create a token issued for my specific macbook m4 that can be used to access the secrets.
    - locally, we store it at the gitignored .env for convenience
    - point of failure: BitWarden master password + 2FA.
- Update this README to mention how to retrieve a new token for this machine
