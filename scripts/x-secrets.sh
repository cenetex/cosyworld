#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"

echo "This saves four X secrets to GitHub Actions for $repo."
echo "What you type is hidden and is not written to disk or shown again."
echo

declare -a names=(X_API_KEY X_API_SECRET X_ACCESS_TOKEN X_ACCESS_TOKEN_SECRET)
declare -a labels=("API key (consumer key)" "API key secret (consumer secret)" "Access token" "Access token secret")

for index in "${!names[@]}"; do
  value=""
  while [ -z "$value" ]; do
    read -r -s -p "${labels[$index]}: " value
    echo
  done
  export "${names[$index]}=$value"
done

echo
echo "Checking the keys with X..."
if ! node scripts/x-post.mjs --whoami; then
  echo "X refused these keys. Nothing was saved."
  exit 1
fi

read -r -p "Save them to $repo? [y/N] " answer
if [ "$answer" != "y" ] && [ "$answer" != "Y" ]; then
  echo "Nothing was saved."
  exit 0
fi

for name in "${names[@]}"; do
  printf '%s' "${!name}" | gh secret set "$name" --repo "$repo"
done
echo "Saved. The campaign stays off until the X_CAMPAIGN variable is set to on."
