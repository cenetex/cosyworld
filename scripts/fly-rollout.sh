#!/usr/bin/env bash
set -uo pipefail

# `flyctl deploy "$@"`, failing once a machine misses its wait: flyctl's own
# retries turned one stuck machine into five 5-minute waits on 2026-11-24.
wait="${COSYWORLD_FLY_WAIT_TIMEOUT:-3m}"
[[ "$wait" =~ ^[1-9][0-9]*m$ ]] || { echo "Unreadable wait: $wait" >&2; exit 2; }
flyctl deploy "$@" --wait-timeout "$wait" --deploy-retries 0 && exit 0
status=$?
echo "::error title=Fly rollout::flyctl deploy failed (exit ${status}). A machine that has not reached a good state within ${wait} fails here instead of retrying; run \`fly status\` and \`fly machine list\` for the app before deploying again." >&2
exit "$status"
