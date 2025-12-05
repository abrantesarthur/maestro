#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR_DEFAULT="${SCRIPT_DIR}/dist"
OUTPUT_DIR="${OUTPUT_DIR_DEFAULT}"
WEBSITE_DIR=""
BUILD_COMMAND=""
DIST_DIR="dist"

usage() {
  cat <<EOF
Usage: $(basename "$0") --website-dir <path> [options]

Options:
  --website-dir <path>    Path to the website source directory (required).
  --output-dir <path>     Destination directory for the built artifacts.
                          Defaults to ${OUTPUT_DIR_DEFAULT}.
  --build-command <cmd>   Build command to run (optional).
                          If omitted, no build is performed and files are
                          copied directly from --dist-dir.
  --dist-dir <subdir>     Subdirectory containing built assets (default: dist).
                          Relative to --website-dir.
EOF
}

log() {
  echo "[website-build] $*"
}

abspath() {
  local input="$1"
  if [[ "${input}" == /* ]]; then
    printf '%s\n' "${input}"
  else
    printf '%s/%s\n' "$(pwd -P)" "${input}"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --website-dir)
      if [[ $# -lt 2 ]]; then
        log "Error: --website-dir requires a path argument." >&2
        exit 1
      fi
      WEBSITE_DIR="$(abspath "$2")"
      shift 2
      ;;
    --output-dir)
      if [[ $# -lt 2 ]]; then
        log "Error: --output-dir requires a path argument." >&2
        exit 1
      fi
      OUTPUT_DIR="$(abspath "$2")"
      shift 2
      ;;
    --build-command)
      if [[ $# -lt 2 ]]; then
        log "Error: --build-command requires a command argument." >&2
        exit 1
      fi
      BUILD_COMMAND="$2"
      shift 2
      ;;
    --dist-dir)
      if [[ $# -lt 2 ]]; then
        log "Error: --dist-dir requires a path argument." >&2
        exit 1
      fi
      DIST_DIR="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      log "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

# Validate required flag
if [[ -z "${WEBSITE_DIR}" ]]; then
  log "Error: --website-dir is required." >&2
  usage
  exit 1
fi

if [[ ! -d "${WEBSITE_DIR}" ]]; then
  log "Error: website directory not found at ${WEBSITE_DIR}." >&2
  exit 1
fi

# Run build command if provided
if [[ -n "${BUILD_COMMAND}" ]]; then
  log "Building website with command: ${BUILD_COMMAND}"
  pushd "${WEBSITE_DIR}" >/dev/null
  eval "${BUILD_COMMAND}"
  popd >/dev/null
else
  log "No build command specified, skipping build step..."
fi

# Determine source directory for assets
WEBSITE_DIST_DIR="${WEBSITE_DIR}/${DIST_DIR}"
if [[ ! -d "${WEBSITE_DIST_DIR}" ]]; then
  log "Error: assets directory not found at ${WEBSITE_DIST_DIR}." >&2
  log "If your site is pre-built, ensure --dist-dir points to the correct subdirectory." >&2
  exit 1
fi

log "Copying assets from ${WEBSITE_DIST_DIR} to ${OUTPUT_DIR}..."
rm -rf -- "${OUTPUT_DIR}"
mkdir -p -- "${OUTPUT_DIR}"
cp -R "${WEBSITE_DIST_DIR}/." "${OUTPUT_DIR}/"

log "Done. Artifacts available at ${OUTPUT_DIR}."
