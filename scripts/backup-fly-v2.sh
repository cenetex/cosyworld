#!/usr/bin/env bash
# Create and verify an on-demand Fly Volume snapshot before a v2 deploy.
#
# Usage: backup-fly-v2.sh <fly-app> <primary|lonelyforest>
# Requires: flyctl authenticated with the app-scoped FLY_API_TOKEN.
#
# The script deliberately resolves the configured volume by its exact mount
# name, requires exactly one attached volume, and waits for the specific
# snapshot returned by flyctl to reach `created`. It never destroys, detaches,
# or replaces a volume, so a failed or interrupted run is recoverable.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: backup-fly-v2.sh <fly-app> <primary|lonelyforest>" >&2
  exit 2
fi

APP="$1"
PROFILE="$2"
case "$PROFILE" in
  primary)
    VOLUME_NAME="cosyworld_data"
    ;;
  lonelyforest)
    VOLUME_NAME="lonelyforest_data"
    ;;
  *)
    echo "::error::unsupported v2 deployment profile '$PROFILE'" >&2
    exit 2
    ;;
esac

command -v flyctl >/dev/null 2>&1 || {
  echo "::error::flyctl is required" >&2
  exit 2
}
command -v python3 >/dev/null 2>&1 || {
  echo "::error::python3 is required to parse flyctl JSON" >&2
  exit 2
}

json_value() {
  python3 - "$@"
}

if ! volumes_json="$(flyctl volumes list --app "$APP" --json 2>&1)"; then
  volumes_json="${volumes_json//$'\n'/ }"
  echo "::error::could not list volumes for $APP: $volumes_json" >&2
  exit 1
fi

volume_id="$(VOLUME_JSON="$volumes_json" json_value "$VOLUME_NAME" <<'PY'
import json
import os
import sys

name = sys.argv[1]
try:
    value = json.loads(os.environ["VOLUME_JSON"])
except (KeyError, json.JSONDecodeError) as error:
    raise SystemExit(f"invalid flyctl volume JSON: {error}")

volumes = value.get("volumes", []) if isinstance(value, dict) else value
if not isinstance(volumes, list):
    raise SystemExit("flyctl volume JSON did not contain a volume list")

matches = [
    volume for volume in volumes
    if isinstance(volume, dict)
    and volume.get("name") == name
    and volume.get("state") not in {"destroyed", "pending_destroy"}
]
if len(matches) != 1:
    raise SystemExit(
        f"expected exactly one active volume named {name!r}, found {len(matches)}"
    )

volume = matches[0]
volume_id = volume.get("id")
if not isinstance(volume_id, str) or not volume_id.startswith("vol_"):
    raise SystemExit(f"volume {name!r} has no verifiable Fly volume id")
if not volume.get("attached_machine_id"):
    raise SystemExit(f"volume {name!r} is not attached to a live machine")
print(volume_id)
PY
)" || {
  echo "::error::refusing to snapshot $APP/$VOLUME_NAME: $volume_id" >&2
  exit 1
}

echo "Resolved $APP/$VOLUME_NAME to $volume_id"

if ! create_json="$(flyctl volumes snapshots create "$volume_id" --app "$APP" --json 2>&1)"; then
  create_json="${create_json//$'\n'/ }"
  echo "::error::could not create snapshot for $volume_id: $create_json" >&2
  exit 1
fi

snapshot_id="$(CREATE_JSON="$create_json" json_value <<'PY'
import json
import os
import sys

try:
    value = json.loads(os.environ["CREATE_JSON"])
except (KeyError, json.JSONDecodeError) as error:
    raise SystemExit(f"invalid flyctl snapshot JSON: {error}")

def find_snapshot_id(candidate):
    if isinstance(candidate, dict):
        for key in ("id", "snapshot_id"):
            value = candidate.get(key)
            if isinstance(value, str) and value.startswith("vs_"):
                return value
        for child in candidate.values():
            result = find_snapshot_id(child)
            if result:
                return result
    elif isinstance(candidate, list):
        for child in candidate:
            result = find_snapshot_id(child)
            if result:
                return result
    return None

snapshot_id = find_snapshot_id(value)
if not snapshot_id:
    raise SystemExit("flyctl did not return a verifiable snapshot id")
print(snapshot_id)
PY
)" || {
  echo "::error::snapshot request for $volume_id returned no verifiable snapshot id" >&2
  exit 1
}

timeout_secs="${COSYWORLD_FLY_SNAPSHOT_TIMEOUT_SECS:-180}"
poll_secs="${COSYWORLD_FLY_SNAPSHOT_POLL_SECS:-5}"
if ! [[ "$timeout_secs" =~ ^[0-9]+$ ]] || [ "$timeout_secs" -lt 1 ]; then
  echo "::error::COSYWORLD_FLY_SNAPSHOT_TIMEOUT_SECS must be a positive integer" >&2
  exit 2
fi
if ! [[ "$poll_secs" =~ ^[0-9]+$ ]] || [ "$poll_secs" -lt 1 ]; then
  echo "::error::COSYWORLD_FLY_SNAPSHOT_POLL_SECS must be a positive integer" >&2
  exit 2
fi

deadline=$((SECONDS + timeout_secs))
while [ "$SECONDS" -lt "$deadline" ]; do
  if ! snapshots_json="$(flyctl volumes snapshots list "$volume_id" --app "$APP" --json 2>&1)"; then
    snapshots_json="${snapshots_json//$'\n'/ }"
    echo "::error::could not verify snapshot $snapshot_id for $APP: $snapshots_json" >&2
    exit 1
  fi

  snapshot_status="$(SNAPSHOTS_JSON="$snapshots_json" json_value "$snapshot_id" <<'PY'
import json
import os
import sys

snapshot_id = sys.argv[1]
try:
    value = json.loads(os.environ["SNAPSHOTS_JSON"])
except (KeyError, json.JSONDecodeError) as error:
    raise SystemExit(f"invalid flyctl snapshot-list JSON: {error}")

snapshots = value.get("snapshots", []) if isinstance(value, dict) else value
if not isinstance(snapshots, list):
    raise SystemExit("flyctl snapshot JSON did not contain a snapshot list")

for snapshot in snapshots:
    if isinstance(snapshot, dict) and snapshot.get("id") == snapshot_id:
        print(snapshot.get("status", ""))
        break
else:
    print("missing")
PY
)" || {
    echo "::error::could not parse snapshot verification response for $snapshot_id" >&2
    exit 1
  }

  case "$snapshot_status" in
    created)
      echo "Verified Fly volume snapshot $snapshot_id for $APP/$VOLUME_NAME"
      exit 0
      ;;
    failed|error|destroyed)
      echo "::error::Fly volume snapshot $snapshot_id entered terminal state '$snapshot_status'" >&2
      exit 1
      ;;
    missing)
      echo "Waiting for Fly volume snapshot $snapshot_id to appear"
      ;;
    *)
      echo "Waiting for Fly volume snapshot $snapshot_id: ${snapshot_status:-unknown}"
      ;;
  esac
  sleep "$poll_secs"
done

echo "::error::timed out waiting for Fly volume snapshot $snapshot_id to reach created" >&2
exit 1
