#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$ROOT/.." && pwd)"

load_env_file() {
  local env_file="$1"
  if [ -f "$env_file" ]; then
    set +u
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
    set -u
  fi
}

load_env_file "$PROJECT_ROOT/.env"
load_env_file "$PROJECT_ROOT/.env.local"

HOST="${COSYWORLD_V2_HOST:-127.0.0.1}"
PORT="${COSYWORLD_V2_PORT:-3102}"
BASE_URL="${COSYWORLD_V2_BASE_URL:-http://${HOST}:${PORT}}"
SESSION="${COSYWORLD_V2_SCREEN_SESSION:-cosyworld-v2}"
LOG="${COSYWORLD_V2_LOG:-/tmp/cosyworld-v2-web.log}"
DETACHED_SHELL="${COSYWORLD_V2_DETACHED_SHELL:-$(command -v bash)}"
SMOKE_BINARY="${COSYWORLD_SMOKE_BINARY:-$ROOT/orchestrator-rust/target/debug/cosyworld-orchestrator}"
URL="${BASE_URL}/"

usage() {
  cat <<EOF
Usage: v2/mvp.sh [start|open|check|status|logs|stop|restart]

Commands:
  start    Build and start the game server, then open ${URL}
  open     Open ${URL}
  check    Run kernel, Rust, and JS checks plus the composition, card
           narrative, and production-profile smokes
  status   Print health and listener information
  logs     Tail the server log
  stop     Stop the detached MVP server
  restart  Stop, start, then open the browser

Environment:
  COSYWORLD_V2_HOST / COSYWORLD_V2_PORT
  OPENROUTER_API_KEY / OPENROUTER_CHAT_MODEL
EOF
}

health_check() {
  python3 - "$BASE_URL" <<'PY'
import json
import sys
import urllib.request

try:
    with urllib.request.urlopen(f"{sys.argv[1]}/health", timeout=0.75) as response:
        data = json.loads(response.read().decode("utf-8"))
    raise SystemExit(0 if data.get("ok") else 1)
except Exception:
    raise SystemExit(1)
PY
}

print_meta() {
  python3 - "$BASE_URL" <<'PY'
import json
import sys
import urllib.request

try:
    with urllib.request.urlopen(f"{sys.argv[1]}/meta", timeout=1.0) as response:
        meta = json.loads(response.read().decode("utf-8"))
except Exception as error:
    print(f"meta unavailable: {error}")
    raise SystemExit(0)

features = meta.get("features", {})
world = meta.get("world", {})
ownership = meta.get("linked_avatar_adapter", {})
deployment = meta.get("deployment", {})
print(
    "meta: "
    f"{meta.get('service')} {meta.get('version')} {meta.get('build_profile')} "
    f"game={meta.get('primary_game', 'classic')} "
    f"card_rules={meta.get('card_game', {}).get('shared_rules_version', 'unreported')} "
    f"profile={deployment.get('profile')} "
    f"world={deployment.get('world_id')} "
    f"process={deployment.get('process_id')} "
    f"chat={'server' if features.get('server_authored_chat') else 'unknown'} "
    f"actors={world.get('actor_count')} events={world.get('event_count')} "
    f"wallets={ownership.get('wallet_count')}"
)
PY
}

stop_server() {
  local pids
  pids="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  screen -S "$SESSION" -X quit >/dev/null 2>&1 || true
  if [ -n "$pids" ]; then
    kill $pids >/dev/null 2>&1 || true
    for _ in {1..50}; do
      local alive=""
      for pid in $pids; do
        if kill -0 "$pid" >/dev/null 2>&1; then
          alive=1
          break
        fi
      done
      if [ -z "$alive" ]; then
        break
      fi
      sleep 0.1
    done
  fi
}

wait_ready() {
  for _ in {1..80}; do
    if health_check; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

start_server() {
  stop_server
  if [ -n "${COSYWORLD_SMOKE_BINARY:-}" ]; then
    if [ ! -x "$SMOKE_BINARY" ]; then
      echo "Prebuilt smoke binary is not executable: $SMOKE_BINARY" >&2
      exit 1
    fi
  else
    (
      cd "$ROOT/orchestrator-rust"
      cargo build
    )
  fi
  if ! command -v screen >/dev/null 2>&1; then
    echo "screen is required for detached local MVP serving on this machine." >&2
    exit 1
  fi
  screen -dmS "$SESSION" "$DETACHED_SHELL" -lc "cd '$ROOT/orchestrator-rust' && COSYWORLD_V2_ADDR='${HOST}:${PORT}' COSYWORLD_DISABLE_CTRL_C_SHUTDOWN=1 COSYWORLD_ENABLE_DEV_RESET=1 COSYWORLD_DEV_AVATAR_CHAT_DELAY_MS='${COSYWORLD_DEV_AVATAR_CHAT_DELAY_MS:-450}' COSYWORLD_MODERATION_TOKEN='${COSYWORLD_MODERATION_TOKEN:-dev-moderator-token}' '$SMOKE_BINARY' > '${LOG}' 2>&1"
  if ! wait_ready; then
    echo "CosyWorld v2 did not become ready. Last log lines:" >&2
    tail -60 "$LOG" >&2 || true
    exit 1
  fi
}

open_browser() {
  if command -v open >/dev/null 2>&1; then
    open "$URL"
  else
    echo "$URL"
  fi
}

status() {
  if health_check; then
    echo "healthy: ${BASE_URL}"
  else
    echo "not healthy: ${BASE_URL}"
    return 1
  fi
  print_meta
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN || true
  screen -ls | grep "$SESSION" || true
}

run_kernel_check() {
  bash "$ROOT/scripts/check-kernel.sh"
}

run_worldpack_check() {
  node "$ROOT/scripts/compile-worldpack.mjs" --check
  node "$ROOT/scripts/check-worldpack.mjs"
}

run_ai_model_checks() {
  (
    cd "$ROOT/ai-model-rust"
    cargo fmt --check
    cargo test
    cargo build --target wasm32-unknown-unknown --release
  )
}

run_rust_checks() {
  bash "$ROOT/scripts/check-rust.sh" all
}

run_architecture_checks() {
  bash "$ROOT/scripts/check-main-size.sh"
  bash "$ROOT/scripts/check-rust-lint.sh"
}

run_js_checks() {
  node --check "$ROOT/scripts/smoke-production-profile.mjs"
  node --check "$ROOT/scripts/smoke-standalone-compositions.mjs"
}

run_production_profile_smoke() {
  node "$ROOT/scripts/smoke-production-profile.mjs"
}

run_composition_smoke() {
  node "$ROOT/scripts/smoke-standalone-compositions.mjs"
  node "$ROOT/scripts/smoke-core-ruby-composition.mjs"
}

check_all() {
  run_worldpack_check
  run_kernel_check
  run_ai_model_checks
  run_rust_checks
  run_architecture_checks
  run_js_checks
  run_composition_smoke
  node "$ROOT/scripts/smoke-card-narrative-contract.mjs"
  run_production_profile_smoke
}

cmd="${1:-start}"
case "$cmd" in
  start)
    start_server
    open_browser
    status
    ;;
  restart)
    start_server
    open_browser
    status
    ;;
  open)
    open_browser
    ;;
  check)
    check_all
    ;;
  status)
    status
    ;;
  logs)
    tail -120 "$LOG"
    ;;
  stop)
    stop_server
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
