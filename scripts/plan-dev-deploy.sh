#!/usr/bin/env bash
set -euo pipefail

# Decide whether this .dev run builds and rolls out, as GitHub output lines.
# $1 is the commit .dev last rolled out (scripts/last-dev-rollout.mjs), or
# empty. A commit .dev contains, a rerun after main moved, a run whose newer
# main head has a live .dev run, and a scheduled run for a commit a push run
# took deploy nothing, so they never cancel a newer build. Everything else
# goes to the impact check.
: "${GH_REPO:?Repository is required}"
[[ "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]]
base="${1:-}"
here="$(dirname "${BASH_SOURCE[0]}")"
echo "base=$base"
skip() {
  echo "[dev-plan] $1" >&2
  printf 'deploy=false\nreason=%s\n' "$1"
  exit 0
}

if [ "${GITHUB_EVENT_NAME:-}" = schedule ]; then
  pushed="$(gh api "repos/${GH_REPO}/actions/workflows/deploy.yml/runs?head_sha=${GITHUB_SHA}&event=push" \
    --jq '[.workflow_runs[] | select(.conclusion != "cancelled")] | length' || echo 0)"
  [ "${pushed:-0}" = 0 ] || skip "the push run for ${GITHUB_SHA:0:7} deploys it"
fi
main="$(gh api "repos/${GH_REPO}/commits/main" --jq .sha || true)"
if [ "${GITHUB_RUN_ATTEMPT:-1}" != 1 ]; then
  [ "$main" = "$GITHUB_SHA" ] || skip "main moved past ${GITHUB_SHA:0:7}; a rerun deploys only main's head"
elif [[ "$main" =~ ^[0-9a-f]{40}$ ]] && [ "$main" != "$GITHUB_SHA" ]; then
  live="$(gh api "repos/${GH_REPO}/actions/workflows/deploy.yml/runs?head_sha=${main}&branch=main" \
    --jq '[.workflow_runs[] | select((.display_title | startswith(".dev train ")) and (.status != "completed" or .conclusion == "success"))] | length' || echo 0)"
  [ "${live:-0}" = 0 ] || skip "the .dev run for main's head ${main:0:7} deploys it"
fi
if [ -n "$base" ]; then
  echo "[dev-plan] The primary app last rolled out ${base:0:7}." >&2
  case "$(gh api "repos/${GH_REPO}/compare/${base}...${GITHUB_SHA}" --jq .status || true)" in
    identical | behind) skip ".dev already runs ${base:0:7}, which contains ${GITHUB_SHA:0:7}" ;;
  esac
  git fetch --quiet --no-tags --depth=1 origin "$base" || true
fi
node "$here/check-deployment-impact.mjs" "$base" "$GITHUB_SHA"
