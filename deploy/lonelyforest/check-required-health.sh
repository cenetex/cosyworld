#!/bin/sh
set -eu

tenant_config="${1:?tenant configuration path is required}"
supervisor_pid="${2:?supervisor pid is required}"
startup_grace_secs="${3:?startup grace seconds are required}"
interval_secs="${4:?health interval seconds are required}"

log() {
  printf '[lonelyforest-required-health] %s\n' "$*"
}

case "$startup_grace_secs:$interval_secs" in
  *[!0-9:]*|:*|*:) log "health timing must be integer seconds"; exit 2 ;;
esac

# All processes are given time to validate their registry and replay their
# persisted journal before a composite readiness failure is actionable. Once
# that grace is over, every required tenant must answer its private readiness
# endpoint; this catches a hung/unready process as well as an exited child.
sleep "$startup_grace_secs"
while :; do
  while IFS='|' read -r slug requirement hosts upstream port registry entry_location snapshot_path event_db_path generated_asset_dir extra_origins; do
    case "$slug" in
      ""|\#*) continue ;;
    esac
    [ "$requirement" = "required" ] || continue
    if ! curl --noproxy '*' --fail --silent --show-error --max-time 3 "http://127.0.0.1:$port/health" >/dev/null; then
      log "required tenant $slug failed private /health on 127.0.0.1:$port; failing supervisor $supervisor_pid"
      kill -USR1 "$supervisor_pid" 2>/dev/null || true
      exit 1
    fi
  done < "$tenant_config"
  sleep "$interval_secs"
done
