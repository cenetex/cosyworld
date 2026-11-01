#!/usr/bin/env bash
set -euo pipefail

# Fast check only. GitHub has no job priority, so while a production deploy
# (a v* tag push or a dispatch of deploy.yml) is queued or running, hold this
# one job instead of starting the fast check's other runners. The checks
# still run afterwards; this never skips them. Main-push .dev deploys do not
# hold anything. An unreadable run list continues at once.
: "${GH_REPO:?Repository is required}"
interval="${COSYWORLD_DEPLOY_YIELD_INTERVAL:-20}"
limit="${COSYWORLD_DEPLOY_YIELD_SECS:-900}"
[[ "$interval" =~ ^[1-9][0-9]*$ ]]
[[ "$limit" =~ ^[1-9][0-9]*$ ]]

production_deploys() {
  local status
  for status in queued in_progress; do
    gh api "repos/${GH_REPO}/actions/workflows/deploy.yml/runs?status=${status}&per_page=20" \
      --jq '.workflow_runs[] | select(.event == "workflow_dispatch" or (.event == "push" and (.head_branch | startswith("v")))) | "\(.id) \(.head_branch)"'
  done
}

deadline=$((SECONDS + limit))
while runs="$(production_deploys 2>/dev/null)" && [ -n "$runs" ]; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "::warning::A production deploy is still running after ${limit} seconds; starting the fast check anyway."
    exit 0
  fi
  echo "Waiting for production deploy run(s) to finish: ${runs//$'\n'/, }"
  sleep "$interval"
done
echo "No production deploy is waiting for runners."
