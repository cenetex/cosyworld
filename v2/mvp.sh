#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST="${COSYWORLD_V2_HOST:-127.0.0.1}"
PORT="${COSYWORLD_V2_PORT:-3102}"
BASE_URL="${COSYWORLD_V2_BASE_URL:-http://${HOST}:${PORT}}"
WALLET="${COSYWORLD_MVP_WALLET:-dev-wallet}"
SIGNED_SMOKE_WALLET="${COSYWORLD_SIGNED_SMOKE_WALLET:-DcfmEZ6tw7BGJo1a7TozkCoGJZNFJxCBJS5axj7oy4ES}"
DEFAULT_CARDS="{\"wallets\":[{\"walletAddress\":\"${WALLET}\",\"cardIds\":[\"cosy-rain-soft-garden\",\"cosy-moonlit-trail\",\"location-science-lab\"]},{\"walletAddress\":\"rati-wallet\",\"cardIds\":[\"rati\",\"location-science-lab\"]},{\"walletAddress\":\"library-wallet\",\"cardIds\":[\"location-library\"]},{\"walletAddress\":\"${SIGNED_SMOKE_WALLET}\",\"cardIds\":[\"location-library\"],\"boxes\":[\"box-smoke-1\"]}]}"
CARDS="${COSYWORLD_RUBY_HIGH_WALLET_CARDS:-$DEFAULT_CARDS}"
SESSION="${COSYWORLD_V2_SCREEN_SESSION:-cosyworld-v2}"
LOG="${COSYWORLD_V2_LOG:-/tmp/cosyworld-v2-web.log}"
URL="${BASE_URL}/?wallet=${WALLET}"

usage() {
  cat <<EOF
Usage: v2/mvp.sh [start|open|smoke|check|status|logs|stop|restart]

Commands:
  start    Build and start the browser MVP server, then open ${URL}
  open     Open ${URL}
  smoke    Run the browser MVP smoke against ${BASE_URL}
  check    Run kernel/Rust/JS/CLI checks, production-profile smoke, browser smoke, and print status
  status   Print health and listener information
  logs     Tail the server log
  stop     Stop the detached MVP server
  restart  Stop, start, then open the browser

Environment:
  COSYWORLD_V2_HOST / COSYWORLD_V2_PORT
  COSYWORLD_MVP_WALLET
  COSYWORLD_SIGNED_SMOKE_WALLET
  COSYWORLD_RUBY_HIGH_WALLET_CARDS
  COSYWORLD_BOX_BURN_SOLANA_RPC_URL
  COSYWORLD_BOX_CORE_COLLECTION_ADDRESS
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
ownership = meta.get("ownership_feed", {})
deployment = meta.get("deployment", {})
print(
    "meta: "
    f"{meta.get('service')} {meta.get('version')} {meta.get('build_profile')} "
    f"profile={deployment.get('profile')} "
    f"chat={'server' if features.get('server_authored_chat') else 'unknown'} "
    f"client_speech={'on' if features.get('client_authored_speech') else 'off'} "
    f"actors={world.get('actor_count')} events={world.get('event_count')} "
    f"wallets={ownership.get('wallet_count')}"
)
PY
}

stop_server() {
  screen -S "$SESSION" -X quit >/dev/null 2>&1 || true
  local pids
  pids="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    kill $pids >/dev/null 2>&1 || true
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
  (
    cd "$ROOT/orchestrator-rust"
    cargo build
  )
  if ! command -v screen >/dev/null 2>&1; then
    echo "screen is required for detached local MVP serving on this machine." >&2
    exit 1
  fi
  screen -dmS "$SESSION" /bin/zsh -lc "cd '$ROOT/orchestrator-rust' && COSYWORLD_V2_ADDR='${HOST}:${PORT}' COSYWORLD_DISABLE_CTRL_C_SHUTDOWN=1 COSYWORLD_ENABLE_DEV_RESET=1 COSYWORLD_DEV_ALLOW_UNSIGNED_WALLET=1 COSYWORLD_DEV_AVATAR_CHAT_DELAY_MS='${COSYWORLD_DEV_AVATAR_CHAT_DELAY_MS:-450}' COSYWORLD_MODERATION_TOKEN='${COSYWORLD_MODERATION_TOKEN:-dev-moderator-token}' COSYWORLD_RUBY_HIGH_WALLET_CARDS='${CARDS}' ./target/debug/cosyworld-orchestrator > '${LOG}' 2>&1"
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
  cc -std=c11 -Wall -Wextra \
    -I "$ROOT/core-c/include" \
    "$ROOT/core-c/src/cosy_kernel.c" \
    "$ROOT/core-c/tests/test_kernel.c" \
    -o /tmp/cosy_kernel_test
  /tmp/cosy_kernel_test
}

run_rust_checks() {
  (
    cd "$ROOT/orchestrator-rust"
    cargo fmt --check
    cargo test
    cargo build
  )
}

run_js_checks() {
  node --check "$ROOT/scripts/smoke-browser.mjs"
  node --check "$ROOT/scripts/smoke-production-profile.mjs"
}

run_cli_checks() {
  python3 -m py_compile "$ROOT/cli/cosy_cli.py"
}

run_smoke() {
  COSYWORLD_SMOKE_URL="${BASE_URL}/?wallet=${WALLET}&reset=1" node "$ROOT/scripts/smoke-browser.mjs"
}

run_production_profile_smoke() {
  node "$ROOT/scripts/smoke-production-profile.mjs"
}

run_cli_smoke() {
  local output
  output="$(printf '\nq' | python3 "$ROOT/cli/cosy_cli.py" --base-url "$BASE_URL")"
  grep -q "\\[Enter\\]" <<<"$output"
  grep -q "Let your avatar speak" <<<"$output"
  if grep -q "Action failed" <<<"$output"; then
    echo "$output" >&2
    return 1
  fi
}

check_all() {
  run_kernel_check
  run_rust_checks
  run_js_checks
  run_cli_checks
  run_production_profile_smoke
  start_server
  run_smoke
  run_cli_smoke
  status
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
  smoke)
    run_smoke
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
