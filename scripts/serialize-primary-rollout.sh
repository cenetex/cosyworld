#!/usr/bin/env bash
set -euo pipefail

# .dev trains (scheduled, or the `dev` dispatch target) and production (v* tag
# or dispatch) deploys use separate concurrency groups, so a train can never
# replace a production run waiting in the queue. Both roll out the primary app, so this keeps that
# work from overlapping:
#
#   dev         Deploy main to .dev, right before its rollout: wait while a
#               production deploy is queued, waiting, or running.
#   production  Before the primary backup and rollout: wait while a .dev run
#               is past its `dev` wait, that is, rolling out or verifying.
#
# Production never waits on a .dev run that is itself waiting, so the two
# cannot deadlock. An unreadable run list continues, as before this guard.
mode="${1:?Use dev or production}"
interval="${COSYWORLD_ROLLOUT_WAIT_INTERVAL:-20}"
limit="${COSYWORLD_ROLLOUT_WAIT_SECS:-1800}"
: "${GH_REPO:?Repository is required}"
[[ "$interval" =~ ^[1-9][0-9]*$ ]]
[[ "$limit" =~ ^[1-9][0-9]*$ ]]
wait_step="Wait for production deploys"

# "<run id> <ref>" for other Deploy runs in the given statuses matching $1.
deploy_runs() {
  local filter="$1" status
  shift
  for status in "$@"; do
    gh api "repos/${GH_REPO}/actions/workflows/deploy.yml/runs?status=${status}&per_page=30" \
      --jq ".workflow_runs[] | select(.id != ${GITHUB_RUN_ID:-0}) | select(${filter}) | \"\\(.id) \\(.head_branch)\"" ||
      return 1
  done
}

# The workflow's run-name marks trains; the run list does not carry inputs.
train='(.event == "schedule" or (.display_title | startswith(".dev train ")))'

production_runs() {
  deploy_runs "(.event == \"workflow_dispatch\" and (${train} | not)) or (.event == \"push\" and (.head_branch | startswith(\"v\")))" \
    queued waiting in_progress
}

dev_rollouts() {
  local runs id branch
  runs="$(deploy_runs "${train} and .head_branch == \"main\"" in_progress)" || return 1
  while read -r id branch; do
    [ -n "$id" ] || continue
    gh api "repos/${GH_REPO}/actions/runs/${id}/jobs" --jq \
      ".jobs[] | select(.name == \"Deploy main to .dev\" and .status == \"in_progress\") | select(any(.steps[]; .name == \"${wait_step}\" and .status == \"completed\")) | \"${id} ${branch}\"" ||
      return 1
  done <<< "$runs"
}

if [ "$mode" = production ]; then
  list=dev_rollouts what=".dev rollout"
elif [ "$mode" != dev ]; then
  echo "Use dev or production." >&2
  exit 1
elif [ "${GITHUB_REF:-}" != refs/heads/main ] ||
  { [ "${GITHUB_EVENT_NAME:-}" != schedule ] && [ "${GITHUB_EVENT_NAME:-}" != workflow_dispatch ]; }; then
  echo "Only .dev trains wait for production deploys."
  exit 0
else
  list=production_runs what="production deploy"
fi

deadline=$((SECONDS + limit))
while found="$("$list" 2>/dev/null)" && [ -n "$found" ]; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "::error::A ${what} is still running after ${limit} seconds: ${found//$'\n'/, }" >&2
    exit 1
  fi
  echo "Waiting for ${what} run(s): ${found//$'\n'/, }"
  sleep "$interval"
done
echo "No ${what} overlaps this run."
