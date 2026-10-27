#!/usr/bin/env bash
set -euo pipefail

# Reuse a commit image, or copy the primary build with each app's own token.
app="${1:?Fly app is required}"
config="${2:?Fly config is required}"
: "${FLY_API_TOKEN:?Fly token is required}"
: "${GITHUB_OUTPUT:?Output file is required}"
[[ "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]]
case "$app:$config" in
  cosyworld:fly.toml|cosyworld-lonelyforest:fly.lonelyforest.toml) ;;
  *) echo 'Use a supported app and its matching config.' >&2; exit 1 ;;
esac
source_image="${SOURCE_IMAGE:-}"
if [ -n "$source_image" ]; then
  [[ "$app" == cosyworld-lonelyforest ]]
  [[ "$source_image" =~ ^registry\.fly\.io/cosyworld@sha256:[0-9a-f]{64}$ ]]
  : "${FLY_SOURCE_API_TOKEN:?Source app token is required}"
fi

# Docker is used by flyctl to normalize scoped tokens. Keep both logins local
# to this job and remove their credential files when the script exits.
command -v docker >/dev/null
credentials="$(mktemp -d)"
trap 'rm -rf "$credentials"' EXIT
export DOCKER_CONFIG="$credentials/destination"
mkdir -m 700 "$DOCKER_CONFIG"
flyctl auth docker
authfile="$DOCKER_CONFIG/config.json"
image="registry.fly.io/${app}:deploy-${GITHUB_SHA}"
digest="$(skopeo inspect --authfile "$authfile" --format '{{.Digest}}' "docker://${image}" 2>/dev/null || true)"

if [ -n "$source_image" ]; then
  source_digest="${source_image##*@}"
  if [ "$digest" != "$source_digest" ]; then
    mkdir -m 700 "$credentials/source"
    DOCKER_CONFIG="$credentials/source" FLY_API_TOKEN="$FLY_SOURCE_API_TOKEN" flyctl auth docker
    skopeo copy --retry-times 3 --all --preserve-digests \
      --src-authfile "$credentials/source/config.json" --dest-authfile "$authfile" \
      "docker://${source_image}" "docker://${image}"
    digest="$(skopeo inspect --authfile "$authfile" --format '{{.Digest}}' "docker://${image}")"
    test "$digest" = "$source_digest"
  fi
elif [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  flyctl deploy --remote-only --config "$config" --build-only --push --image-label "deploy-${GITHUB_SHA}"
  digest="$(skopeo inspect --authfile "$authfile" --format '{{.Digest}}' "docker://${image}")"
fi

[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]
echo "image=registry.fly.io/${app}@${digest}" >> "$GITHUB_OUTPUT"
echo "Prepared ${app} at ${digest}"
