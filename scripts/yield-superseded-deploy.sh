#!/usr/bin/env bash
set -euo pipefail

# Main-push deploys only. When main has moved past this run's commit, cancel
# the run so the newer one, waiting in the deploy concurrency group, starts
# now. That run compares with the commit .dev actually runs, so it deploys
# this commit's changes too. Tag and dispatch runs never yield here.
#
#   check  yield now if main has moved (or a watcher already yielded)
#   watch  check every COSYWORLD_YIELD_INTERVAL seconds until killed
#
# The rollout step runs only after a final `check`, and a watcher writes its
# marker before it asks GitHub to cancel, so a cancel never lands mid-rollout.
mode="${1:?Use check or watch}"
interval="${COSYWORLD_YIELD_INTERVAL:-15}"
wait_secs="${COSYWORLD_YIELD_WAIT_SECS:-300}"
: "${GH_REPO:?Repository is required}"
: "${GITHUB_RUN_ID:?Run id is required}"
: "${RUNNER_TEMP:?Runner temp directory is required}"
[[ "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]]
[[ "$interval" =~ ^[1-9][0-9]*$ ]]
[[ "$wait_secs" =~ ^[1-9][0-9]*$ ]]

if [ "${GITHUB_EVENT_NAME:-}" != push ] || [ "${GITHUB_REF:-}" != refs/heads/main ]; then
  echo "Only main-push deploys yield to newer commits."
  exit 0
fi

marker="$RUNNER_TEMP/cosyworld-deploy-yielded"
main_sha=""

# An unreadable ref keeps the deploy going rather than cancelling it.
superseded() {
  main_sha="$(gh api "repos/${GH_REPO}/git/ref/heads/main" --jq .object.sha 2>/dev/null)" || return 1
  [[ "$main_sha" =~ ^[0-9a-f]{40}$ ]] && [ "$main_sha" != "$GITHUB_SHA" ]
}

yield_run() {
  : > "$marker"
  echo "::warning::Superseded: main advanced to ${1}; cancelling this run so the newer commit deploys."
  gh run cancel "$GITHUB_RUN_ID" --repo "$GH_REPO" || true
  # Hold this step until the cancellation stops the job.
  local deadline=$((SECONDS + wait_secs))
  while [ "$SECONDS" -lt "$deadline" ]; do
    sleep 1
  done
  echo "This superseded run was not cancelled within ${wait_secs} seconds." >&2
  exit 1
}

case "$mode" in
  check)
    if [ -e "$marker" ]; then
      yield_run "a newer commit"
    fi
    if superseded; then
      yield_run "${main_sha:0:7}"
    fi
    echo "This run owns main at ${GITHUB_SHA:0:7}."
    ;;
  watch)
    while sleep "$interval"; do
      if superseded; then
        yield_run "${main_sha:0:7}"
      fi
    done
    ;;
  *)
    echo "Use check or watch." >&2
    exit 1
    ;;
esac
