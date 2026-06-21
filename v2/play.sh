#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST="${COSYWORLD_V2_HOST:-127.0.0.1}"
PORT="${COSYWORLD_V2_PORT:-3102}"
BASE_URL="${COSYWORLD_V2_BASE_URL:-http://${HOST}:${PORT}}"
SERVER_PID=""

health_check() {
  python3 - "$BASE_URL" <<'PY'
import json
import sys
import urllib.request

try:
    with urllib.request.urlopen(f"{sys.argv[1]}/health", timeout=0.5) as response:
        data = json.loads(response.read().decode("utf-8"))
    raise SystemExit(0 if data.get("ok") else 1)
except Exception:
    raise SystemExit(1)
PY
}

cleanup() {
  if [[ -n "${SERVER_PID}" ]]; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    wait "${SERVER_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if ! health_check; then
  echo "Starting CosyWorld v2 server on ${HOST}:${PORT}..."
  (
    cd "${ROOT}/orchestrator-rust"
    COSYWORLD_V2_ADDR="${HOST}:${PORT}" cargo run
  ) >/tmp/cosyworld-v2-play.log 2>&1 &
  SERVER_PID="$!"

  for _ in {1..80}; do
    if health_check; then
      break
    fi
    sleep 0.25
  done

  if ! health_check; then
    echo "Server did not become ready. Last log lines:"
    tail -40 /tmp/cosyworld-v2-play.log || true
    exit 1
  fi
fi

python3 "${ROOT}/cli/cosy_cli.py" --base-url "${BASE_URL}" "$@"
