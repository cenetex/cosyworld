#!/usr/bin/env bash
set -euo pipefail

# Print a Markdown summary of one .dev train: the commit it deploys and the
# pull requests merged since the commit .dev last rolled out ($BASE). The
# deploy workflow appends it to the run summary, so each drop is labelled.
# An unreadable comparison still prints the commit.
: "${GH_REPO:?Repository is required}"
[[ "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]]
base="${BASE:-}"
deploy="${DEPLOY:-}"

echo "## .dev train ${GITHUB_SHA:0:7}"
echo
if [ -z "$base" ]; then
  echo "No earlier rollout found; this train deploys main at ${GITHUB_SHA:0:7}."
  exit 0
fi
if [ "$base" = "$GITHUB_SHA" ]; then
  echo ".dev already runs ${GITHUB_SHA:0:7}; main has not moved. Nothing to deploy."
  exit 0
fi
if [ "$deploy" != true ]; then
  echo "Main moved from ${base:0:7}, but only docs, tests, or tooling changed. Nothing to deploy."
fi
echo "Changes since ${base:0:7}:"
echo
# Merge commits name their pull request on the first line and its title on
# the third; squash merges end their first line in "(#N)".
if ! gh api "repos/${GH_REPO}/compare/${base}...${GITHUB_SHA}" --jq '
  .commits[].commit.message | split("\n") |
  if (.[0] | test("^Merge pull request #[0-9]+ ")) then
    "- #\(.[0] | capture("#(?<n>[0-9]+)").n) \(.[2] // "")"
  elif (.[0] | test(" \\(#[0-9]+\\)$")) then
    "- #\(.[0] | capture("\\(#(?<n>[0-9]+)\\)$").n) \(.[0] | sub(" \\(#[0-9]+\\)$"; ""))"
  else empty end' 2>/dev/null; then
  echo "- (could not read the comparison)"
fi
