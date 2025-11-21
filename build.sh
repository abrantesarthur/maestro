#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() { cat <<'EOF'
Build and push the root Dockerfile image to GHCR.

Required env:
  GHCR_TOKEN       GitHub token with write:packages (and repo for private repos).
Optional env/flags:
  GHCR_IMAGE       Fully-qualified image. Defaults to ghcr.io/dalhe-ai/backend.
  GHCR_USERNAME    GHCR username (defaults to GITHUB_ACTOR if set).
  TAG              Image tag (default: git short SHA).
Flags:
  --tag <tag>      Override TAG.
  --latest         Also tag/push :latest.
  -h|--help        Show help.
EOF
}

GHCR_IMAGE="${GHCR_IMAGE:-ghcr.io/dalhe-ai/backend}"
TAG="${TAG:-}"
PUSH_LATEST=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)
      TAG="$2"
      shift 2
      ;;
    --latest)
      PUSH_LATEST=true
      shift 1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

ensure_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "Error: required command '$1' not found in PATH." >&2
    exit 1
  fi
}
ensure_command docker
ensure_command git

if [[ -z "${GHCR_TOKEN:-}" ]]; then
  echo "Set GHCR_TOKEN (token with write:packages)" >&2
  exit 1
fi

GHCR_USERNAME="${GHCR_USERNAME:-${GITHUB_ACTOR:-}}"
if [[ -z "${GHCR_USERNAME}" ]]; then
  echo "Set GHCR_USERNAME or GITHUB_ACTOR for GHCR login" >&2
  exit 1
fi

if [[ -z "${TAG}" ]]; then
  if ! git -C "${ROOT_DIR}" rev-parse --short HEAD >/dev/null 2>&1; then
    echo "Set TAG when git is unavailable" >&2
    exit 1
  fi
  TAG="$(git -C "${ROOT_DIR}" rev-parse --short HEAD)"
fi

echo "Logging into ghcr.io as ${GHCR_USERNAME}..."
echo "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_USERNAME}" --password-stdin >/dev/null

IMAGE_TAG="${GHCR_IMAGE}:${TAG}"

echo "Building ${IMAGE_TAG} from ${ROOT_DIR}/Dockerfile..."
docker build -f "${ROOT_DIR}/Dockerfile" -t "${IMAGE_TAG}" "${ROOT_DIR}"

if [[ "${PUSH_LATEST}" == "true" ]]; then
  docker tag "${IMAGE_TAG}" "${GHCR_IMAGE}:latest"
fi

echo "Pushing ${IMAGE_TAG}..."
docker push "${IMAGE_TAG}"

if [[ "${PUSH_LATEST}" == "true" ]]; then
  echo "Pushing ${GHCR_IMAGE}:latest..."
  docker push "${GHCR_IMAGE}:latest"
fi

echo "Done. Published ${IMAGE_TAG}${PUSH_LATEST:+ and :latest}."
