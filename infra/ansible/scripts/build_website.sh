#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../../.." && pwd)"
WEBSITE_DIR="${REPO_ROOT}/website"
OUTPUT_DIR_DEFAULT="${SCRIPT_DIR}/dist"
OUTPUT_DIR="${OUTPUT_DIR_DEFAULT}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--output-dir <path>]

Options:
  --output-dir <path>   Destination directory for the built artifacts.
                        Defaults to ${OUTPUT_DIR_DEFAULT}.
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
    --output-dir)
      if [[ $# -lt 2 ]]; then
        log "Error: --output-dir requires a path argument." >&2
        exit 1
      fi
      OUTPUT_DIR="$(abspath "$2")"
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

ensure_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "Error: required command '$1' not found in PATH." >&2
    exit 1
  fi
}

ensure_website_submodule() {
  ensure_command git
  if [[ -d "${WEBSITE_DIR}" ]]; then
    return
  fi

  log "website submodule not found. Attempting to initialize it..."
  if pushd "${REPO_ROOT}" >/dev/null; then
    if git submodule update --init --recursive website >/dev/null 2>&1; then
      log "website submodule initialized."
    else
      log "Error: failed to initialize website submodule." >&2
      exit 1
    fi
    popd >/dev/null || true
  else
    log "Error: unable to access repo root at ${REPO_ROOT}." >&2
    exit 1
  fi

  if [[ ! -d "${WEBSITE_DIR}" ]]; then
    log "Error: website directory still missing at ${WEBSITE_DIR}." >&2
    exit 1
  fi
}

ensure_website_submodule

PACKAGE_MANAGER="bun"


build_with_bun() {
  ensure_command bun
  bun install
  bun run build
}


log "Building website using ${PACKAGE_MANAGER}..."
pushd "${WEBSITE_DIR}" >/dev/null
build_with_bun
popd >/dev/null

WEBSITE_DIST_DIR="${WEBSITE_DIR}/dist"
if [[ ! -d "${WEBSITE_DIST_DIR}" ]]; then
  log "Error: website build did not produce ${WEBSITE_DIST_DIR}." >&2
  exit 1
fi

log "Copying built assets to ${OUTPUT_DIR}..."
rm -rf -- "${OUTPUT_DIR}"
mkdir -p -- "${OUTPUT_DIR}"
cp -R "${WEBSITE_DIST_DIR}/." "${OUTPUT_DIR}/"

log "Done. Artifacts available at ${OUTPUT_DIR}."
