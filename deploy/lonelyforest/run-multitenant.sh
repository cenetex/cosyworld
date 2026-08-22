#!/bin/sh
set -eu

orchestrator="${COSYWORLD_ORCHESTRATOR_BINARY:-/app/cosyworld-orchestrator}"
nginx_config="${COSYWORLD_MULTITENANT_NGINX_CONFIG:-/app/deploy/lonelyforest/nginx.conf}"
tenant_data_root="${COSYWORLD_MULTITENANT_DATA_ROOT:-/data/worldpacks}"
tenant_config="${COSYWORLD_MULTITENANT_TENANTS_CONFIG:-/app/deploy/lonelyforest/tenants.tsv}"
health_monitor="${COSYWORLD_MULTITENANT_HEALTH_MONITOR:-/app/deploy/lonelyforest/check-required-health.sh}"
health_startup_grace_secs="${COSYWORLD_MULTITENANT_HEALTH_STARTUP_GRACE_SECS:-45}"
health_interval_secs="${COSYWORLD_MULTITENANT_HEALTH_INTERVAL_SECS:-5}"
health_failure_threshold="${COSYWORLD_MULTITENANT_HEALTH_FAILURE_THRESHOLD:-3}"
health_probe_timeout_secs="${COSYWORLD_MULTITENANT_HEALTH_PROBE_TIMEOUT_SECS:-10}"
restart_delay="${COSYWORLD_MULTITENANT_RESTART_DELAY_SECS:-2}"
shutdown_grace_secs="${COSYWORLD_MULTITENANT_SHUTDOWN_GRACE_SECS:-4}"
supervisor_pid="$$"
workers=""
worker_count=0
nginx_pid=""
nginx_log_pid=""
health_monitor_pid=""
required_health_urls=""
shutdown_started=0
shutdown_marker_dir="/tmp/cosyworld-multitenant-shutdown.$$"

log() {
  printf '[lonelyforest-multitenant] %s\n' "$*"
}

wait_shutdown_grace() {
  cancel_file="${1:-}"
  remaining="$shutdown_grace_secs"
  while [ "$remaining" -gt 0 ]; do
    if [ -n "$cancel_file" ] && [ -f "$cancel_file" ]; then
      return
    fi
    sleep 1
    remaining=$((remaining - 1))
  done
  if [ -n "$cancel_file" ] && [ -f "$cancel_file" ]; then
    return
  fi
}

wait_for_pid_exit() {
  process="$1"
  [ -n "$process" ] || return
  # A trapped signal can interrupt wait before a shell subprocess finishes its
  # own handler. Re-enter wait until the PID is actually gone, then reap it.
  while kill -0 "$process" 2>/dev/null; do
    wait "$process" 2>/dev/null || true
  done
  wait "$process" 2>/dev/null || true
}

run_world() {
  slug="$1"
  port="$2"
  registry="$3"
  entry_location_id="$4"
  origin="$5"
  snapshot_path="$6"
  event_db_path="$7"
  generated_asset_dir="$8"
  extra_origins="$9"
  requirement="${10}"
  supervisor_pid="${11}"
  shutdown_grace_secs="${12}"
  shutdown_marker_dir="${13}"
  active_child=""

  # Invoked indirectly by the signal trap below.
  # shellcheck disable=SC2329
  stop_world() {
    trap '' TERM INT HUP
    started_at="$(date +%s)"
    if [ -n "$active_child" ]; then
      log "event=tenant_shutdown_started tenant=$slug child_pid=$active_child grace_secs=$shutdown_grace_secs"
      kill -TERM "$active_child" 2>/dev/null || true
      child_watchdog_cancel="$shutdown_marker_dir/.cancel-tenant-$slug"
      (
        trap - TERM INT HUP
        wait_shutdown_grace "$child_watchdog_cancel"
        if kill -0 "$active_child" 2>/dev/null; then
          log "event=tenant_shutdown_forced tenant=$slug child_pid=$active_child forced_process_count=1"
          : > "$shutdown_marker_dir/tenant-$slug"
          kill -KILL "$active_child" 2>/dev/null || true
        fi
      ) &
      child_watchdog_pid="$!"
      wait_for_pid_exit "$active_child"
      : > "$child_watchdog_cancel"
      kill -TERM "$child_watchdog_pid" 2>/dev/null || true
      wait "$child_watchdog_pid" 2>/dev/null || true
    fi
    elapsed_secs="$(($(date +%s) - started_at))"
    log "event=tenant_shutdown_complete tenant=$slug elapsed_secs=$elapsed_secs"
    exit 0
  }
  trap stop_world TERM INT HUP

  mkdir -p "$(dirname "$snapshot_path")" "$(dirname "$event_db_path")" "$generated_asset_dir"

  while :; do
    log "starting $slug on 127.0.0.1:$port with $registry"
    if [ "$entry_location_id" = "-" ]; then
      env -u COSYWORLD_ENTRY_LOCATION_ID \
        COSYWORLD_V2_ADDR="127.0.0.1:$port" \
        COSYWORLD_PROCESS_ID="lonelyforest-$slug" \
        COSYWORLD_V2_SHARD_ID="lonelyforest-$slug" \
        COSYWORLD_CONTENT_REGISTRY_PATH="$registry" \
        COSYWORLD_V2_SNAPSHOT_PATH="$snapshot_path" \
        COSYWORLD_V2_EVENT_DB_PATH="$event_db_path" \
        COSYWORLD_GENERATED_ASSET_DIR="$generated_asset_dir" \
        COSYWORLD_REQUIRED_HEALTH_URLS="$required_health_urls" \
        COSYWORLD_WEBAUTHN_RP_ID="lonelyforest.com" \
        COSYWORLD_WEBAUTHN_ORIGIN="$origin" \
        COSYWORLD_WEBAUTHN_EXTRA_ORIGINS="$extra_origins" \
        "$orchestrator" &
    else
      env -u COSYWORLD_REQUIRED_HEALTH_URLS \
        COSYWORLD_V2_ADDR="127.0.0.1:$port" \
        COSYWORLD_PROCESS_ID="lonelyforest-$slug" \
        COSYWORLD_V2_SHARD_ID="lonelyforest-$slug" \
        COSYWORLD_CONTENT_REGISTRY_PATH="$registry" \
        COSYWORLD_ENTRY_LOCATION_ID="$entry_location_id" \
        COSYWORLD_V2_SNAPSHOT_PATH="$snapshot_path" \
        COSYWORLD_V2_EVENT_DB_PATH="$event_db_path" \
        COSYWORLD_GENERATED_ASSET_DIR="$generated_asset_dir" \
        COSYWORLD_WEBAUTHN_RP_ID="lonelyforest.com" \
        COSYWORLD_WEBAUTHN_ORIGIN="$origin" \
        COSYWORLD_WEBAUTHN_EXTRA_ORIGINS="$extra_origins" \
        "$orchestrator" &
    fi
    active_child="$!"
    if wait "$active_child"; then
      status=0
    else
      status="$?"
    fi
    active_child=""
    log "$slug exited with status $status; restarting in ${restart_delay}s"
    # A required tenant's process is part of this Fly Machine's readiness.
    # Do not leave nginx serving root health while another required world
    # crash-loops behind its hostname. Terminating the supervisor makes the
    # machine fail its health check and restart as one deploy boundary.
    if [ "$requirement" = "required" ]; then
      log "$slug is required; failing supervisor $supervisor_pid so Fly marks the Machine unhealthy"
      kill -USR1 "$supervisor_pid" 2>/dev/null || true
      exit 1
    fi
    sleep "$restart_delay"
  done
}

start_world() {
  run_world "$@" "$supervisor_pid" "$shutdown_grace_secs" "$shutdown_marker_dir" &
  workers="$workers $!"
  worker_count=$((worker_count + 1))
}

tenant_data_path() {
  case "$1" in
    /data/worldpacks/*) printf '%s/%s\n' "$tenant_data_root" "${1#/data/worldpacks/}" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

monitor_required_tenants() {
  monitor_child_pid=""
  # Invoked indirectly by the signal trap below.
  # shellcheck disable=SC2329
  stop_health_monitor() {
    trap '' TERM INT HUP
    if [ -n "$monitor_child_pid" ]; then
      kill -TERM "$monitor_child_pid" 2>/dev/null || true
      kill -KILL "$monitor_child_pid" 2>/dev/null || true
      wait "$monitor_child_pid" 2>/dev/null || true
    fi
    exit 0
  }
  trap stop_health_monitor TERM INT HUP
  "$health_monitor" "$tenant_config" "$supervisor_pid" "$health_startup_grace_secs" "$health_interval_secs" "$health_failure_threshold" "$health_probe_timeout_secs" &
  monitor_child_pid="$!"
  if wait "$monitor_child_pid"; then
    status=0
  else
    status="$?"
  fi
  monitor_child_pid=""
  # The monitor is a required readiness component. Its own unexpected exit
  # must not leave nginx serving only the root health endpoint indefinitely.
  log "required tenant health monitor exited with status $status; failing supervisor $supervisor_pid"
  kill -USR1 "$supervisor_pid" 2>/dev/null || true
  exit "$status"
}

stop_all() {
  if [ "$shutdown_started" -eq 1 ]; then
    return
  fi
  shutdown_started=1
  trap '' TERM INT HUP USR1
  shutdown_started_at="$(date +%s)"
  log "event=shutdown_started grace_secs=$shutdown_grace_secs worker_count=$worker_count"
  if [ -n "$nginx_pid" ]; then
    kill -TERM "$nginx_pid" 2>/dev/null || true
  fi
  if [ -n "$health_monitor_pid" ]; then
    kill -TERM "$health_monitor_pid" 2>/dev/null || true
  fi
  if [ -n "$nginx_log_pid" ]; then
    kill -TERM "$nginx_log_pid" 2>/dev/null || true
    # tail -F can keep polling after TERM on some shells. It is only a log
    # forwarder, so stop it immediately while nginx and tenants drain.
    kill -KILL "$nginx_log_pid" 2>/dev/null || true
  fi
  for worker in $workers; do
    kill -TERM "$worker" 2>/dev/null || true
  done
  shutdown_watchdog_cancel="$shutdown_marker_dir/.cancel-supervisor"
  (
    trap - TERM INT HUP USR1
    wait_shutdown_grace "$shutdown_watchdog_cancel"
    forced_process_count=0
    if [ -n "$nginx_pid" ] && kill -0 "$nginx_pid" 2>/dev/null; then
      forced_process_count=1
      kill -KILL "$nginx_pid" 2>/dev/null || true
    fi
    if [ "$forced_process_count" -gt 0 ]; then
      printf '%s\n' "$forced_process_count" > "$shutdown_marker_dir/supervisor"
      log "event=shutdown_forced reason=deadline forced_process_count=$forced_process_count"
    fi
  ) &
  shutdown_watchdog_pid="$!"
  if [ -n "$nginx_pid" ]; then
    wait_for_pid_exit "$nginx_pid"
  fi
  if [ -n "$health_monitor_pid" ]; then
    wait_for_pid_exit "$health_monitor_pid"
  fi
  if [ -n "$nginx_log_pid" ]; then
    wait_for_pid_exit "$nginx_log_pid"
  fi
  for worker in $workers; do
    wait_for_pid_exit "$worker"
  done
  : > "$shutdown_watchdog_cancel"
  kill -TERM "$shutdown_watchdog_pid" 2>/dev/null || true
  wait "$shutdown_watchdog_pid" 2>/dev/null || true
  forced_process_count=0
  for marker in "$shutdown_marker_dir"/*; do
    [ -f "$marker" ] || continue
    case "$marker" in
      */supervisor) forced_process_count=$((forced_process_count + $(cat "$marker"))) ;;
      *) forced_process_count=$((forced_process_count + 1)) ;;
    esac
  done
  elapsed_secs="$(($(date +%s) - shutdown_started_at))"
  log "event=shutdown_complete elapsed_secs=$elapsed_secs forced_process_count=$forced_process_count"
}

trap 'stop_all; exit 0' TERM INT HUP
trap 'stop_all; exit 1' USR1

case "$shutdown_grace_secs" in
  ""|*[!0-9]*|0)
    log "COSYWORLD_MULTITENANT_SHUTDOWN_GRACE_SECS must be a positive integer"
    exit 1
    ;;
esac

mkdir -p \
  /tmp/cosyworld-nginx \
  /tmp/cosyworld-nginx/client-body \
  /tmp/cosyworld-nginx/proxy \
  /tmp/cosyworld-nginx/fastcgi \
  /tmp/cosyworld-nginx/uwsgi \
  /tmp/cosyworld-nginx/scgi \
  "$tenant_data_root" \
  "$shutdown_marker_dir"

# tenants.tsv is the committed source of truth for hostname, registry, port,
# and persistence identity. The deploy guard validates every required row
# before Fly replaces this image. Elysium is explicitly optional: a release
# without its registry leaves only 0.lonelyforest.com unavailable (HTTP 503).
if [ ! -r "$tenant_config" ]; then
  log "tenant configuration is unreadable: $tenant_config"
  exit 1
fi
if [ ! -x "$health_monitor" ]; then
  log "required tenant health monitor is not executable: $health_monitor"
  exit 1
fi
# Root readiness follows the same required/optional boundary as the supervisor
# and dedicated health monitor. An optional world may restart independently
# without making every hostname on the Machine fail its public health check.
# These manifest passes do not need the upstream name; it remains a positional
# field so every later column keeps the validated schema.
# shellcheck disable=SC2034
while IFS='|' read -r slug requirement hosts upstream port registry entry_location snapshot_path event_db_path generated_asset_dir extra_origins; do
  case "$slug" in
    ""|\#*) continue ;;
  esac
  [ "$requirement" = "required" ] || continue
  if [ ! -r "$registry" ]; then
    log "required tenant $slug registry is unreadable: $registry"
    exit 1
  fi
  [ "$slug" = "root" ] && continue
  health_url="http://127.0.0.1:$port/health"
  if [ -n "$required_health_urls" ]; then
    required_health_urls="$required_health_urls,$health_url"
  else
    required_health_urls="$health_url"
  fi
done < "$tenant_config"
# shellcheck disable=SC2034
while IFS='|' read -r slug requirement hosts upstream port registry entry_location snapshot_path event_db_path generated_asset_dir extra_origins; do
  case "$slug" in
    ""|\#*) continue ;;
  esac
  case "$requirement" in
    required|optional) ;;
    *) log "tenant $slug has invalid requirement '$requirement'"; exit 1 ;;
  esac
  if [ ! -r "$registry" ]; then
    if [ "$requirement" = "optional" ]; then
      log "optional tenant $slug registry is absent; ${hosts%%,*} will return HTTP 503"
      continue
    fi
    log "required tenant $slug registry is unreadable: $registry"
    exit 1
  fi
  origin="https://${hosts%%,*}"
  snapshot_path="$(tenant_data_path "$snapshot_path")"
  event_db_path="$(tenant_data_path "$event_db_path")"
  generated_asset_dir="$(tenant_data_path "$generated_asset_dir")"
  start_world \
    "$slug" "$port" "$registry" "$entry_location" "$origin" \
    "$snapshot_path" "$event_db_path" "$generated_asset_dir" "$extra_origins" \
    "$requirement"
done < "$tenant_config"

touch /tmp/cosyworld-nginx/error.log /tmp/cosyworld-nginx/access.log
tail -n 0 -F /tmp/cosyworld-nginx/error.log /tmp/cosyworld-nginx/access.log &
nginx_log_pid="$!"
log "nginx access and error logs are streaming to the platform log"

if ! nginx -t -c "$nginx_config"; then
  log "hostname router configuration is invalid"
  stop_all
  exit 1
fi
nginx -c "$nginx_config" -g "daemon off;" &
nginx_pid="$!"
log "hostname router listening on 0.0.0.0:3000"
monitor_required_tenants &
health_monitor_pid="$!"
log "required tenant health monitor started after ${health_startup_grace_secs}s grace; ${health_failure_threshold} consecutive misses at ${health_probe_timeout_secs}s fail the Machine"

if wait "$nginx_pid"; then
  status=0
else
  status="$?"
fi
log "hostname router exited with status $status"
stop_all
exit "$status"
