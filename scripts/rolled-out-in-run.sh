#!/usr/bin/env bash
# Exit 0 when any attempt of this workflow run finished the named rollout
# step successfully. `gh run rerun --failed` drops the outputs of jobs an
# earlier attempt ran, so the release and .dev restore read each attempt's
# step results instead. A superseded rollout skips the step: no match.
#
# Usage: scripts/rolled-out-in-run.sh "<job name>" "<step name>"
# Needs GH_TOKEN, GH_REPO, GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT.
set -euo pipefail

job="$1"
step="$2"
for attempt in $(seq "${GITHUB_RUN_ATTEMPT:-1}" -1 1); do
  found="$(gh api --paginate \
    "repos/${GH_REPO}/actions/runs/${GITHUB_RUN_ID}/attempts/${attempt}/jobs?per_page=100" \
    --jq ".jobs[] | select(.name == \"${job}\") | .steps[]? | select(.name == \"${step}\" and .conclusion == \"success\") | .name")"
  if [ -n "$found" ]; then
    echo "Attempt ${attempt} ran '${step}' in '${job}'."
    exit 0
  fi
done
echo "No attempt of this run finished '${step}' in '${job}'."
exit 1
