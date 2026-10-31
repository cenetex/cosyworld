#!/usr/bin/env bash
# Print a short hash of the dependencies in the given Cargo.lock files.
#
# Every merge bumps the CosyWorld crate versions, so a plain lockfile hash
# changes on every commit and forces a new multi-gigabyte cache entry. This
# hash leaves out the version lines of CosyWorld's own crates, so it changes
# only when a dependency changes.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "Usage: cargo-cache-key.sh <Cargo.lock>..." >&2
  exit 2
fi

hash_stdin() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum
  else
    shasum -a 256
  fi
}

for lock in "$@"; do
  echo "# $lock"
  awk '
    /^name = "cosyworld-/ { own = 1; print; next }
    own && /^version = / { own = 0; next }
    { own = 0; print }
  ' "$lock"
done | hash_stdin | cut -c1-16
