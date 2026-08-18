#!/bin/sh
set -eu

tenant_config="${1:?tenant configuration path is required}"
supervisor_pid="${2:?supervisor pid is required}"
startup_grace_secs="${3:?startup grace seconds are required}"
interval_secs="${4:?health interval seconds are required}"
# A required tenant that is merely busy must not cost every hostname on this
# Machine. Root can hold the authoritative runtime lock for several seconds
# under load, which starves its readiness endpoint while the world is alive and
# serving, so a single missed probe is not evidence of a hung process.
failure_threshold="${5:-3}"
probe_timeout_secs="${6:-10}"

log() {
  printf '[lonelyforest-required-health] %s\n' "$*"
}

case "$startup_grace_secs:$interval_secs:$failure_threshold:$probe_timeout_secs" in
  *[!0-9:]*|:*|*:) log "health timing must be integer seconds"; exit 2 ;;
esac
if [ "$failure_threshold" -lt 1 ]; then
  log "health failure threshold must be at least 1"
  exit 2
fi

# Slugs are tenant ids like "7" or "hoppycat", so they cannot be shell variable
# names on their own.
counter_var() {
  printf 'consecutive_failures_%s' "$(printf '%s' "$1" | tr -c '[:alnum:]' '_')"
}

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
    variable="$(counter_var "$slug")"
    if curl --noproxy '*' --fail --silent --show-error --max-time "$probe_timeout_secs" "http://127.0.0.1:$port/health" >/dev/null; then
      eval "$variable=0"
      continue
    fi
    eval "failures=\${$variable:-0}"
    failures=$((failures + 1))
    eval "$variable=$failures"
    if [ "$failures" -ge "$failure_threshold" ]; then
      log "required tenant $slug failed private /health on 127.0.0.1:$port ${failures} consecutive times; failing supervisor $supervisor_pid"
      kill -USR1 "$supervisor_pid" 2>/dev/null || true
      exit 1
    fi
    log "required tenant $slug missed private /health on 127.0.0.1:$port (${failures}/${failure_threshold}); still within tolerance"
  done < "$tenant_config"
  sleep "$interval_secs"
done
