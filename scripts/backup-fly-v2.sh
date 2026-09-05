#!/usr/bin/env bash
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

snapshot_ids() {
  SNAPSHOTS_JSON="$1" json_value <<'PY'
import json
import os

try:
    value = json.loads(os.environ["SNAPSHOTS_JSON"])
except (KeyError, json.JSONDecodeError) as error:
    raise SystemExit(f"invalid flyctl snapshot-list JSON: {error}")

snapshots = value.get("snapshots", []) if isinstance(value, dict) else value
if not isinstance(snapshots, list):
    raise SystemExit("flyctl snapshot JSON did not contain a snapshot list")

ids = set()
for snapshot in snapshots:
    if not isinstance(snapshot, dict):
        raise SystemExit("flyctl snapshot JSON contained a non-object snapshot")
    snapshot_id = snapshot.get("id")
    if not isinstance(snapshot_id, str) or not snapshot_id.startswith("vs_"):
        raise SystemExit("flyctl snapshot JSON contained an unverifiable snapshot id")
    status = snapshot.get("status", "")
    if not isinstance(status, str):
        raise SystemExit("flyctl snapshot JSON contained an unverifiable snapshot status")
    ids.add(snapshot_id)

print(json.dumps(sorted(ids)))
PY
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

if ! snapshots_before_json="$(flyctl volumes snapshots list "$volume_id" --app "$APP" --json 2>&1)"; then
  snapshots_before_json="${snapshots_before_json//$'\n'/ }"
  echo "::error::could not list existing snapshots for $APP/$VOLUME_NAME: $snapshots_before_json" >&2
  exit 1
fi
if ! snapshot_ids_before="$(snapshot_ids "$snapshots_before_json")"; then
  echo "::error::could not parse existing snapshots for $APP/$VOLUME_NAME" >&2
  exit 1
fi

if ! create_json="$(flyctl volumes snapshots create "$volume_id" --app "$APP" --json 2>&1)"; then
  create_json="${create_json//$'\n'/ }"
  echo "::error::could not create snapshot for $volume_id: $create_json" >&2
  exit 1
fi

snapshot_id="$(CREATE_JSON="$create_json" json_value <<'PY'
import json
import os

raw = os.environ.get("CREATE_JSON", "").strip()
if not raw:
    raise SystemExit(0)
try:
    value = json.loads(raw)
except json.JSONDecodeError:
    raise SystemExit(0)

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
if snapshot_id:
    print(snapshot_id)
PY
)" || {
  echo "::error::could not inspect snapshot creation response for $volume_id" >&2
  exit 1
}
if [ -z "$snapshot_id" ]; then
  echo "::notice::flyctl snapshot create returned no JSON snapshot id; resolving the exact new snapshot from the verified list"
fi

timeout_secs="${COSYWORLD_FLY_SNAPSHOT_TIMEOUT_SECS:-600}"
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

  snapshot_state="$(
    SNAPSHOTS_JSON="$snapshots_json" \
      SNAPSHOT_ID="$snapshot_id" \
      SNAPSHOT_IDS_BEFORE="$snapshot_ids_before" \
      json_value <<'PY'
import json
import os

try:
    value = json.loads(os.environ["SNAPSHOTS_JSON"])
except (KeyError, json.JSONDecodeError) as error:
    raise SystemExit(f"invalid flyctl snapshot-list JSON: {error}")

snapshots = value.get("snapshots", []) if isinstance(value, dict) else value
if not isinstance(snapshots, list):
    raise SystemExit("flyctl snapshot JSON did not contain a snapshot list")

try:
    before = set(json.loads(os.environ["SNAPSHOT_IDS_BEFORE"]))
except (KeyError, json.JSONDecodeError) as error:
    raise SystemExit(f"invalid saved Fly snapshot identity set: {error}")

by_id = {}
for snapshot in snapshots:
    if not isinstance(snapshot, dict):
        raise SystemExit("flyctl snapshot JSON contained a non-object snapshot")
    candidate_id = snapshot.get("id")
    if not isinstance(candidate_id, str) or not candidate_id.startswith("vs_"):
        raise SystemExit("flyctl snapshot JSON contained an unverifiable snapshot id")
    status = snapshot.get("status", "")
    if not isinstance(status, str):
        raise SystemExit("flyctl snapshot JSON contained an unverifiable snapshot status")
    by_id.setdefault(candidate_id, []).append(snapshot)

normalized = {}
terminal_statuses = {"failed", "error", "destroyed"}
for candidate_id, records in by_id.items():
    statuses = {record.get("status", "").strip().lower() for record in records}
    terminal = sorted({
        status for status in statuses if status in terminal_statuses
    })
    if terminal:
        normalized[candidate_id] = terminal[0]
        continue
    normalized[candidate_id] = next(iter(statuses)) if len(statuses) == 1 else "conflicting"
by_id = normalized

snapshot_id = os.environ.get("SNAPSHOT_ID", "")
if not snapshot_id:
    fresh = sorted(set(by_id).difference(before))
    if len(fresh) > 1:
        raise SystemExit(
            "could not identify exactly one new snapshot after a successful create request: "
            + ", ".join(fresh)
        )
    if len(fresh) == 1:
        snapshot_id = fresh[0]

if not snapshot_id:
    print("|pending")
elif snapshot_id in by_id:
    print(f"{snapshot_id}|{by_id[snapshot_id]}")
else:
    print(f"{snapshot_id}|missing")
PY
  )" || {
    echo "::error::could not parse snapshot verification response for ${snapshot_id:-new snapshot}" >&2
    exit 1
  }

  snapshot_id="${snapshot_state%%|*}"
  snapshot_status="${snapshot_state#*|}"

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
    pending)
      echo "Waiting for Fly volume snapshot creation to appear"
      ;;
    *)
      echo "Waiting for Fly volume snapshot $snapshot_id: ${snapshot_status:-unknown}"
      ;;
  esac
  sleep "$poll_secs"
done

echo "::error::timed out waiting for Fly volume snapshot $snapshot_id to reach created" >&2
exit 1
