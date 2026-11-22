#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$ROOT/card-game/app.mjs"
CEILING_FILE="$ROOT/scripts/app-mjs-line-ceiling.txt"

count="$(awk '!/^[[:space:]]*(#|$)/ { n++ } END { print n+0 }' "$CEILING_FILE")"
ceiling="$(awk '!/^[[:space:]]*(#|$)/ { print $1 }' "$CEILING_FILE" | tail -1)"
if [[ "$count" -ne 1 || ! "$ceiling" =~ ^[0-9]+$ ]]; then
  echo "Invalid app.mjs line ceiling in ${CEILING_FILE}: expected exactly one bare number." >&2
  exit 2
fi

current="$(wc -l < "$TARGET" | tr -d ' ')"
echo "app.mjs: ${current} lines (ceiling: ${ceiling})"

if [[ "$current" -gt "$ceiling" ]]; then
  cat >&2 <<EOF

app.mjs grew from ${ceiling} to ${current} lines.

New systems do not go in app.mjs. Put the change in its own card-game
module, as sleep-view.mjs and speech-text.mjs are, and route that module
to its browser smokes in scripts/fast-smokes.json.

If this is a deliberate reviewed exception, raise ${CEILING_FILE} to ${current}
in the same diff so the exception is visible.
EOF
  exit 1
fi
