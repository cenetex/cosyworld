#!/usr/bin/env bash
set -euo pipefail

APP="${1:?fly app name required}"
MOUNT="${2:-/data}"
THRESHOLD="${3:-85}"

if ! [[ "$THRESHOLD" =~ ^[0-9]+$ ]] || [ "$THRESHOLD" -lt 1 ] || [ "$THRESHOLD" -gt 100 ]; then
  echo "::error::threshold must be an integer 1-100, got '$THRESHOLD'" >&2
  exit 2
fi

if ! df_output="$(flyctl ssh console -a "$APP" -C "df -P $MOUNT" 2>&1)"; then
  df_output="${df_output//$'\n'/ }"
  echo "::error::could not read df for $MOUNT on app $APP — refusing to deploy blind. flyctl: $df_output" >&2
  exit 1
fi

df_line="$(
  printf '%s\n' "$df_output" \
    | awk -v mount="$MOUNT" '$5 ~ /^[0-9]+%$/ && $6 == mount { print; exit }'
)"
if [ -z "$df_line" ]; then
  df_output="${df_output//$'\n'/ }"
  echo "::error::could not read df for $MOUNT on app $APP — refusing to deploy blind. flyctl: $df_output" >&2
  exit 1
fi

used_percent="$(echo "$df_line" | awk '{gsub(/%/, "", $5); print $5}')"
available="$(echo "$df_line" | awk '{print $4}')"
if ! [[ "$used_percent" =~ ^[0-9]+$ ]]; then
  echo "::error::could not parse df output for $MOUNT on app $APP: $df_line" >&2
  exit 1
fi

echo "$APP $MOUNT is ${used_percent}% used (${available} blocks available; threshold ${THRESHOLD}%)"
if [ "$used_percent" -ge "$THRESHOLD" ]; then
  echo "::error::$APP $MOUNT at ${used_percent}% >= ${THRESHOLD}% — extend the volume (flyctl volumes extend <id> --size <gb> -a $APP) or free space before deploying. Deploying onto a full volume crash-loops the release." >&2
  exit 1
fi
