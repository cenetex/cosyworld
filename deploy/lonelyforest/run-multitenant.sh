#!/bin/sh
set -eu

orchestrator="${COSYWORLD_ORCHESTRATOR_BINARY:-/app/cosyworld-orchestrator}"
nginx_config="${COSYWORLD_MULTITENANT_NGINX_CONFIG:-/app/deploy/lonelyforest/nginx.conf}"
tenant_data_root="${COSYWORLD_MULTITENANT_DATA_ROOT:-/data/worldpacks}"
restart_delay="${COSYWORLD_MULTITENANT_RESTART_DELAY_SECS:-2}"
workers=""
nginx_pid=""
elysium_registry="/app/v2/content/elysium-only/registry.json"
required_health_urls="http://127.0.0.1:3107/health,http://127.0.0.1:3189/health,http://127.0.0.1:3180/health"

if [ -r "$elysium_registry" ]; then
  required_health_urls="$required_health_urls,http://127.0.0.1:3101/health"
fi

log() {
  printf '[lonelyforest-multitenant] %s\n' "$*"
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
  active_child=""

  # Invoked indirectly by the signal trap below.
  # shellcheck disable=SC2329
  stop_world() {
    if [ -n "$active_child" ]; then
      kill -TERM "$active_child" 2>/dev/null || true
      wait "$active_child" 2>/dev/null || true
    fi
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
      env \
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
    sleep "$restart_delay"
  done
}

start_world() {
  run_world "$@" &
  workers="$workers $!"
}

stop_all() {
  trap - TERM INT HUP
  if [ -n "$nginx_pid" ]; then
    kill -TERM "$nginx_pid" 2>/dev/null || true
  fi
  for worker in $workers; do
    kill -TERM "$worker" 2>/dev/null || true
  done
  if [ -n "$nginx_pid" ]; then
    wait "$nginx_pid" 2>/dev/null || true
  fi
  for worker in $workers; do
    wait "$worker" 2>/dev/null || true
  done
}

trap 'stop_all; exit 0' TERM INT HUP

mkdir -p \
  /tmp/cosyworld-nginx/client-body \
  /tmp/cosyworld-nginx/proxy \
  "$tenant_data_root"

# Preserve the established Lonely Forest journal paths exactly. The new
# worldpack processes receive their own directories on the same volume.
start_world \
  "root" \
  "3100" \
  "/app/v2/content/official/registry.json" \
  "-" \
  "https://lonelyforest.com" \
  "/data/cosyworld-v2-snapshot.json" \
  "/data/cosyworld-v2-events.sqlite" \
  "/data/generated" \
  "https://www.lonelyforest.com"

start_world \
  "7" \
  "3107" \
  "/app/v2/content/bethlehem/registry.json" \
  "700" \
  "https://7.lonelyforest.com" \
  "$tenant_data_root/7/snapshot.json" \
  "$tenant_data_root/7/events.sqlite" \
  "$tenant_data_root/7/generated" \
  ""

start_world \
  "89" \
  "3189" \
  "/app/v2/content/project89/registry.json" \
  "8900" \
  "https://89.lonelyforest.com" \
  "$tenant_data_root/89/snapshot.json" \
  "$tenant_data_root/89/events.sqlite" \
  "$tenant_data_root/89/generated" \
  ""

start_world \
  "lantern" \
  "3180" \
  "/app/v2/content/lantern-keeper/registry.json" \
  "800" \
  "https://lantern.lonelyforest.com" \
  "$tenant_data_root/lantern/snapshot.json" \
  "$tenant_data_root/lantern/events.sqlite" \
  "$tenant_data_root/lantern/generated" \
  ""

if [ -r "$elysium_registry" ]; then
  start_world \
    "0" \
    "3101" \
    "$elysium_registry" \
    "652000" \
    "https://0.lonelyforest.com" \
    "$tenant_data_root/0/snapshot.json" \
    "$tenant_data_root/0/events.sqlite" \
    "$tenant_data_root/0/generated" \
    ""
else
  log "Elysium registry is absent; 0.lonelyforest.com will return HTTP 503"
fi

if ! nginx -t -c "$nginx_config"; then
  log "hostname router configuration is invalid"
  stop_all
  exit 1
fi
nginx -c "$nginx_config" -g "daemon off;" &
nginx_pid="$!"
log "hostname router listening on 0.0.0.0:3000"

if wait "$nginx_pid"; then
  status=0
else
  status="$?"
fi
log "hostname router exited with status $status"
stop_all
exit "$status"
