#!/usr/bin/env bash
set -euo pipefail

# Decide whether this .dev run builds and rolls out, as GitHub output lines.
# $1 is the commit .dev last rolled out (scripts/last-dev-rollout.mjs), or
# empty. A run whose commit .dev already contains, and a rerun after main
# moved, deploy nothing, so they never cancel a newer build. Everything else
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

if [ "${GITHUB_RUN_ATTEMPT:-1}" != 1 ]; then
  main="$(gh api "repos/${GH_REPO}/commits/main" --jq .sha || true)"
  [ "$main" = "$GITHUB_SHA" ] || skip "main moved past ${GITHUB_SHA:0:7}; a rerun deploys only main's head"
fi
if [ -n "$base" ]; then
  echo "[dev-plan] The primary app last rolled out ${base:0:7}." >&2
  case "$(gh api "repos/${GH_REPO}/compare/${base}...${GITHUB_SHA}" --jq .status || true)" in
    identical | behind) skip ".dev already runs ${base:0:7}, which contains ${GITHUB_SHA:0:7}" ;;
  esac
  git fetch --quiet --no-tags --depth=1 origin "$base" || true
fi
node "$here/check-deployment-impact.mjs" "$base" "$GITHUB_SHA"
