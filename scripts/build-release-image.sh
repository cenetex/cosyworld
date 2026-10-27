#!/usr/bin/env bash
set -euo pipefail

image="${1:?Release image is required}"
[[ "$image" =~ ^registry\.fly\.io/(cosyworld|cosyworld-lonelyforest):deploy-[0-9a-f]{40}$ ]]
jobs="${COSYWORLD_RELEASE_BUILD_JOBS:-4}"
[[ "$jobs" =~ ^[1-4]$ ]]
cache="${image%:*}:build-cache-v1"
builder="cosyworld-release-$$"
# Each invocation owns its builder. Its registry cache survives job cleanup.
trap 'docker buildx rm "$builder" >/dev/null 2>&1 || true' EXIT
docker buildx create --name "$builder" --driver docker-container

docker buildx build --builder "$builder" --platform linux/amd64 \
  --build-arg "CARGO_BUILD_JOBS=$jobs" \
  --cache-from "type=registry,ref=$cache" \
  --cache-to "type=registry,ref=$cache,mode=max,image-manifest=true,oci-mediatypes=true" \
  --provenance=false --tag "$image" --push .
