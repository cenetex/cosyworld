#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CEILING_FILE="$ROOT/scripts/rust-lint-warning-ceiling.txt"
# CI keeps its Clippy build in a cached directory. Local runs use a fresh one.
if [ -n "${COSYWORLD_CLIPPY_TARGET_DIR:-}" ]; then
  CLIPPY_TARGET_DIR="$COSYWORLD_CLIPPY_TARGET_DIR"
else
  CLIPPY_TARGET_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cosyworld-clippy.XXXXXX")"
  trap 'rm -rf "$CLIPPY_TARGET_DIR"' EXIT
fi

ceiling="$(awk '!/^[[:space:]]*(#|$)/ { print $1; exit }' "$CEILING_FILE")"
if [[ ! "$ceiling" =~ ^[0-9]+$ ]]; then
  echo "Invalid Rust lint warning ceiling in ${CEILING_FILE}: '${ceiling}'" >&2
  exit 2
fi

set +e
output="$(
  cd "$ROOT/orchestrator-rust"
  CARGO_TERM_COLOR=never \
    CARGO_TARGET_DIR="$CLIPPY_TARGET_DIR" \
    RUST_MIN_STACK="${RUST_MIN_STACK:-16777216}" \
    cargo clippy --all-targets 2>&1
)"
status=$?
set -e

if [[ "$status" -ne 0 ]]; then
  printf '%s\n' "$output" >&2
  echo "cargo clippy failed to build (exit ${status}); see output above." >&2
  exit "$status"
fi

# Cargo retries registry downloads before Clippy runs. Count compiler warnings
# after a successful build; a failed download still exits through the guard above.
count="$(printf '%s\n' "$output" | awk '
  /^warning:/ && !/^warning: spurious network error \([0-9]+ tr(y|ies) remaining\):/ { count++ }
  END { print count + 0 }
')"
echo "cargo clippy: ${count} warnings (ceiling: ${ceiling})"

if [[ "$count" -gt "$ceiling" ]]; then
  printf '%s\n' "$output" >&2
  cat >&2 <<EOF

clippy warnings rose from ${ceiling} to ${count}.

Fix the new warning, or raise ${CEILING_FILE} to ${count} in the same diff as
a deliberate reviewed exception.
EOF
  exit 1
fi

if [[ "$count" -lt "$ceiling" ]]; then
  echo "clippy warnings dropped by $((ceiling - count)); lower ${CEILING_FILE} to ${count} to lock in the win."
fi
