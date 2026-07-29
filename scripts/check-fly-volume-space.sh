#!/usr/bin/env bash
# Pre-deploy guard: refuse to swap a machine onto a nearly full data volume.
#
# A boot that cannot write (journal append, snapshot, migration) crash-loops
# the release, and with a single machine that is an outage by construction.
# The 2026-07-28 production outage was exactly this: the volume hit 100%, a
# deploy swapped configs, and the app could not boot until the volume was
# extended by hand.
#
# Usage: check-fly-volume-space.sh <fly-app> [mount-point] [threshold-percent]
# Requires: flyctl authenticated (FLY_API_TOKEN) and ssh-agent access to the app.
set -euo pipefail

APP="${1:?fly app name required}"
MOUNT="${2:-/data}"
THRESHOLD="${3:-85}"

if ! [[ "$THRESHOLD" =~ ^[0-9]+$ ]] || [ "$THRESHOLD" -lt 1 ] || [ "$THRESHOLD" -gt 100 ]; then
  echo "::error::threshold must be an integer 1-100, got '$THRESHOLD'" >&2
  exit 2
fi

df_line="$(flyctl ssh console -a "$APP" -C "df -P $MOUNT" 2>/dev/null | awk 'NR==2 {print}')"
if [ -z "$df_line" ]; then
  echo "::error::could not read df for $MOUNT on app $APP — refusing to deploy blind" >&2
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
