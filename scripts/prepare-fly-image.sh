#!/usr/bin/env bash
set -euo pipefail
umask 077

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
image_builder="${COSYWORLD_IMAGE_BUILDER:-fly}"
case "$image_builder" in
  fly|runner) ;;
  *) echo 'Choose the fly or runner image builder.' >&2; exit 1 ;;
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
# An explicit registry entry keeps Docker's login in this temporary file.
printf '%s\n' '{"auths":{"registry.fly.io":{}}}' > "$DOCKER_CONFIG/config.json"
flyctl auth docker
authfile="$DOCKER_CONFIG/config.json"
image="registry.fly.io/${app}:deploy-${GITHUB_SHA}"
digest="$(skopeo inspect --no-tags --authfile "$authfile" --format '{{.Digest}}' "docker://${image}" 2>/dev/null || true)"

# A successful push may reach the registry before its manifest can be read.
# Try seven reads with five-second gaps before reporting the final error.
wait_for_image() {
  local attempt value
  for attempt in {1..7}; do
    if value="$(skopeo inspect --no-tags --authfile "$authfile" --format '{{.Digest}}' "docker://${image}" 2>"$credentials/inspect-error")" &&
      [[ "$value" =~ ^sha256:[0-9a-f]{64}$ ]]; then
      printf '%s\n' "$value"
      return 0
    fi
    if [ "$attempt" -eq 7 ]; then
      cat "$credentials/inspect-error" >&2
      echo "Image manifest remained unavailable or invalid after 7 reads: ${image}" >&2
      return 1
    fi
    echo "Waiting for the uploaded image manifest (${attempt}/7): ${image}" >&2
    sleep 5
  done
}

source_login() {
  [ -f "$credentials/source/config.json" ] && return 0
  mkdir -m 700 "$credentials/source"
  printf '%s\n' '{"auths":{"registry.fly.io":{}}}' > "$credentials/source/config.json"
  DOCKER_CONFIG="$credentials/source" FLY_API_TOKEN="$FLY_SOURCE_API_TOKEN" flyctl auth docker
}

# A Lonely Forest-only deploy (a promotion) has no primary build in this run,
# but the .dev train already built this commit's image for the primary app.
# Copy that commit-addressed image instead of compiling it again.
if [ -z "$source_image" ] && [[ "$app" == cosyworld-lonelyforest ]] &&
  [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] && [ -n "${FLY_SOURCE_API_TOKEN:-}" ]; then
  source_login
  train_digest="$(skopeo inspect --no-tags --authfile "$credentials/source/config.json" --format '{{.Digest}}' "docker://registry.fly.io/cosyworld:deploy-${GITHUB_SHA}" 2>/dev/null || true)"
  if [[ "$train_digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    source_image="registry.fly.io/cosyworld@${train_digest}"
    echo "Reusing the primary app's image for ${GITHUB_SHA:0:7}: ${train_digest}"
  fi
fi

if [ -n "$source_image" ]; then
  source_digest="${source_image##*@}"
  if [ "$digest" != "$source_digest" ]; then
    source_login
    skopeo copy --retry-times 3 --all --preserve-digests \
      --src-authfile "$credentials/source/config.json" --dest-authfile "$authfile" \
      "docker://${source_image}" "docker://${image}"
    digest="$(wait_for_image)"
    test "$digest" = "$source_digest"
  fi
elif [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  if [ "$image_builder" = runner ]; then
    bash "$(dirname "${BASH_SOURCE[0]}")/build-release-image.sh" "$image"
  else
    flyctl deploy --remote-only --config "$config" --build-only --push --image-label "deploy-${GITHUB_SHA}"
  fi
  digest="$(wait_for_image)"
fi

[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]
echo "image=registry.fly.io/${app}@${digest}" >> "$GITHUB_OUTPUT"
echo "Prepared ${app} at ${digest}"
