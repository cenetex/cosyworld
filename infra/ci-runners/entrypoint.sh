#!/usr/bin/env bash
# Runs one just-in-time GitHub runner, then exits so the machine stops.
set -euo pipefail

IDLE_LIMIT_SECS="${RUNNER_IDLE_LIMIT_SECS:-600}"
CACHE_LIMIT_PCT="${RUNNER_CACHE_LIMIT_PCT:-85}"
RUNNER_HOME=/home/runner

if [ -z "${RUNNER_JITCONFIG:-}" ]; then
  echo "No RUNNER_JITCONFIG; nothing to run. Stopping."
  exit 0
fi

mkdir -p /cache
chown runner:runner /cache
used_pct="$(df --output=pcent /cache | tail -1 | tr -dc '0-9')"
if [ "${used_pct:-0}" -ge "$CACHE_LIMIT_PCT" ]; then
  echo "Cache volume ${used_pct}% full; clearing the shared Cargo target."
  rm -rf /cache/target
fi

jit="$RUNNER_JITCONFIG"
unset RUNNER_JITCONFIG
cd "$RUNNER_HOME"
sudo -E -u runner ./run.sh --jitconfig "$jit" &
runner_pid=$!

# A runner whose job was cancelled before pickup would idle forever.
(
  sleep "$IDLE_LIMIT_SECS"
  if ! compgen -G "$RUNNER_HOME/_diag/Worker_*.log" >/dev/null; then
    echo "No job within ${IDLE_LIMIT_SECS}s; stopping the runner."
    kill -TERM "$runner_pid" 2>/dev/null || true
  fi
) &

status=0
wait "$runner_pid" || status=$?
echo "Runner exited with status ${status}."
exit "$status"
