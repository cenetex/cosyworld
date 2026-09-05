#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$ROOT/orchestrator-rust/src/main.rs"
CEILING_FILE="$ROOT/scripts/main-rs-line-ceiling.txt"

ceiling="$(awk '!/^[[:space:]]*(#|$)/ { print NR": "$1 }' "$CEILING_FILE" | tail -1 | cut -d' ' -f2)"
count="$(awk '!/^[[:space:]]*(#|$)/ { n++ } END { print n+0 }' "$CEILING_FILE")"
if [[ "$count" -ne 1 ]]; then
  echo "Invalid main.rs line ceiling in ${CEILING_FILE}: expected exactly one bare number, found ${count}." >&2
  echo "Keep the history as comments; only the final ceiling is a bare number." >&2
  exit 2
fi
if [[ ! "$ceiling" =~ ^[0-9]+$ ]]; then
  echo "Invalid main.rs line ceiling in ${CEILING_FILE}: '${ceiling}'" >&2
  exit 2
fi

current="$(wc -l < "$TARGET" | tr -d ' ')"
echo "main.rs: ${current} lines (ceiling: ${ceiling})"

if [[ "$current" -gt "$ceiling" ]]; then
  cat >&2 <<EOF

main.rs grew from ${ceiling} to ${current} lines.

ENG.md Priority #1 forbids new systems in main.rs. Extract the change through
the documented world/, cards.rs, economy/, rpg/, ai_gateway/, persistence.rs,
or moderation.rs seams, including tests that belong to the extracted system.

If this is a deliberate reviewed exception, raise ${CEILING_FILE} to ${current}
in the same diff so the exception is visible.
EOF
  exit 1
fi

if [[ "$current" -lt "$ceiling" ]]; then
  delta=$((ceiling - current))
  unit="lines"
  if [[ "$delta" -eq 1 ]]; then
    unit="line"
  fi
  echo "main.rs shrank by ${delta} ${unit}; lower ${CEILING_FILE} to ${current} to lock in the win."
fi
