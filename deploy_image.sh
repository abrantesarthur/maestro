#!/usr/bin/env bash
set -euo pipefail


ROOT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPERS_PATH="${ROOT_DIR}/helpers.sh"

# import helper functions
source "$HELPERS_PATH"

log() {
  echo "[deply_image.sh] $*"
}
require_cmd() {
  require_command log "$@"
}
require_bws_var() {
  require_bws_variable log "$@"
}

require_cmd docker
require_cmd git

usage() { cat <<'EOF'
Build and push the root Dockerfile image to GHCR.

Required env:
  BWS_PROJECT_ID   The BWS project from which to retrieve the secrets. Defaults to "Prod Infra".
Optional env/flags:
  GHCR_IMAGE       Fully-qualified image. Defaults to ghcr.io/dalhe-ai/backend.
  TAG              Image tag (default: git short SHA).
  PLATFORMS        Comma-separated platforms for buildx (default: linux/amd64).
Flags:
  --tag <tag>      Override TAG.
  --latest         Also tag/push :latest.
  --platforms <p>  Override PLATFORMS (e.g., linux/amd64,linux/arm64).
  -h|--help        Show help.
EOF
}

GHCR_IMAGE="${GHCR_IMAGE:-ghcr.io/dalhe-ai/backend}"
TAG="${TAG:-}"
PLATFORMS="${PLATFORMS:-linux/amd64}"
PUSH_LATEST=false
BWS_PROJECT_ID="${BWS_PROJECT_ID:-${BWS_PROD_INFRA_PROJECT_ID:-}}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)
      [[ -n "${2:-}" ]] || { log "Missing value for $1." >&2; exit 1; }
      TAG="$2"
      shift 2
      ;;
    --latest)
      PUSH_LATEST=true
      shift 1
      ;;
    --platforms)
      [[ -n "${2:-}" ]] || { log "Missing value for $1." >&2; exit 1; }
      PLATFORMS="$2"
      shift 2
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

# Export secrets from Bitwarden so child commands inherit them.
source_bws_secrets

# Ensure we got the needed secrets from BWS
require_bws_var 'GHCR_TOKEN'
require_bws_var 'GHCR_USERNAME'

# Build default image tag if one is not explicitly specified
if [[ -z "${TAG}" ]]; then
  TAG="$(git -C "${ROOT_DIR}" rev-parse --short HEAD)"
fi
IMAGE_TAG="${GHCR_IMAGE}:${TAG}"

log "Logging into ghcr.io as ${GHCR_USERNAME}..."
echo "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_USERNAME}" --password-stdin >/dev/null

log "Building ${IMAGE_TAG} for platforms ${PLATFORMS} from ${ROOT_DIR}/Dockerfile..."
build_cmd=(
  docker buildx build
  --platform "${PLATFORMS}"
  -f "${ROOT_DIR}/Dockerfile"
  -t "${IMAGE_TAG}"
)
if [[ "${PUSH_LATEST}" == "true" ]]; then
  build_cmd+=(-t "${GHCR_IMAGE}:latest")
fi
build_cmd+=("--push" "${ROOT_DIR}")
"${build_cmd[@]}"

log "Done. Published ${IMAGE_TAG}${PUSH_LATEST:+ and :latest}.${PLATFORMS:+ Platforms: ${PLATFORMS}.}"
