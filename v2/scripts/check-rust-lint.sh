#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CEILING_FILE="$ROOT/scripts/rust-lint-warning-ceiling.txt"
CLIPPY_TARGET_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cosyworld-clippy.XXXXXX")"
trap 'rm -rf "$CLIPPY_TARGET_DIR"' EXIT

ceiling="$(awk '!/^[[:space:]]*(#|$)/ { print $1; exit }' "$CEILING_FILE")"
if [[ ! "$ceiling" =~ ^[0-9]+$ ]]; then
  echo "Invalid Rust lint warning ceiling in ${CEILING_FILE}: '${ceiling}'" >&2
  exit 2
fi

set +e
output="$(
  cd "$ROOT/orchestrator-rust"
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

count="$(printf '%s\n' "$output" | grep -c '^warning:' || true)"
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
