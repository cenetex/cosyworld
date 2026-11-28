#!/bin/sh
set -eu

if [ -n "${COSYWORLD_IMAGE_COMMIT:-}" ] || [ -d "${COSYWORLD_RELEASE_STORE:-/data/releases}" ]; then
  if assets="$(sh "$(dirname "$0")/release-store.sh" choose)"; then
    export COSYWORLD_ASSETS_DIR="$assets"
    # A release of a Rust change brings the server it was checked with.
    if [ -x "$assets/server" ] && [ "${1:-}" = "${COSYWORLD_SERVER_BINARY:-/app/cosyworld-orchestrator}" ]; then
      shift
      set -- "$assets/server" "$@"
    fi
  fi
fi

# Fly mounts /data after the image is built: own it as root, then drop root.
if [ "$(id -u)" -eq 0 ]; then
  chown -R cosyworld:cosyworld /data
  exec gosu cosyworld "$@"
fi

exec "$@"
