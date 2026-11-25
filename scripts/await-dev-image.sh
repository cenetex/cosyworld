#!/usr/bin/env bash
set -euo pipefail

# Wait while a .dev run still builds this commit's image, so production
# promotes it; an unreadable run list or the time limit ends the wait.
: "${GH_REPO:?Repository is required}"
[[ "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]]
interval="${COSYWORLD_DEV_IMAGE_WAIT_INTERVAL:-15}"
limit="${COSYWORLD_DEV_IMAGE_WAIT_SECS:-900}"
[[ "$interval" =~ ^[1-9][0-9]*$ ]]
[[ "$limit" =~ ^[1-9][0-9]*$ ]]

building() {
  local ids id
  ids="$(gh api "repos/${GH_REPO}/actions/workflows/deploy.yml/runs?head_sha=${GITHUB_SHA}&per_page=20" \
    --jq '.workflow_runs[] | select(.status != "completed" and (.display_title | startswith(".dev train "))) | .id')" || return 1
  for id in $ids; do
    gh api "repos/${GH_REPO}/actions/runs/${id}/jobs?per_page=100" \
      --jq "if any(.jobs[]; .name == \"Build the .dev image\" and .status == \"completed\") then empty else \"${id}\" end" || return 1
  done
}

deadline=$((SECONDS + limit))
while found="$(building 2>/dev/null)" && [ -n "$found" ]; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "::warning::.dev is still building ${GITHUB_SHA:0:7} after ${limit} seconds; building it here."
    exit 0
  fi
  echo "Waiting for .dev run(s) building ${GITHUB_SHA:0:7}: ${found//$'\n'/, }"
  sleep "$interval"
done
echo "No .dev run is building ${GITHUB_SHA:0:7}."
