# Backend
Lightweight Bun HTTP service exposing a `/health` endpoint on port 3000.

## Workflow
```bash
# Default image ghcr.io/dalhe-ai/backend, tag from git short SHA
GHCR_TOKEN="<ghcr_token>" GHCR_USERNAME="<gh_username>" ./build.sh --latest

# Override the tag or image if needed
# GHCR_IMAGE="ghcr.io/dalhe-ai/backend" TAG="v0.1.0" ./build.sh --platforms linux/amd64,linux/arm64
```

## Required environment
| Variable       | Purpose |
| -------------- | ------- |
| `GHCR_TOKEN`   | GitHub token used for `docker login`; must include `write:packages` (and `repo` if the image is private). |
| `GHCR_USERNAME` / `GITHUB_ACTOR` | Username for `docker login`; `GHCR_USERNAME` overrides, otherwise `GITHUB_ACTOR` is used. |

## Optional environment
| Variable       | Purpose |
| -------------- | ------- |
| `GHCR_IMAGE`   | Target image reference; defaults to `ghcr.io/dalhe-ai/backend`. |
| `TAG`          | Image tag; defaults to the git short SHA if not set. |
| `PLATFORMS`    | Comma-separated platforms for buildx; defaults to `linux/amd64`. |

## Optional flags
| Flag | Purpose |
| ---- | ------- |
| `--tag <tag>` | Override the image tag instead of using the git short SHA. |
| `--latest` | Also tag and push the image as `:latest`. |
| `--platforms <p>` | Override platforms (e.g., `linux/amd64,linux/arm64`) for multi-arch builds. |
| `-h`, `--help` | Show script usage. |
