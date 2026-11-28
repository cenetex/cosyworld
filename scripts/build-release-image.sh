#!/usr/bin/env bash
set -euo pipefail

image="${1:?Release image is required}"
[[ "$image" =~ ^registry\.fly\.io/(cosyworld|cosyworld-lonelyforest):deploy-[0-9a-f]{40}$ ]]
jobs="${COSYWORLD_RELEASE_BUILD_JOBS:-4}"
[[ "$jobs" =~ ^[1-4]$ ]]
cache="${image%:*}:build-cache-v1"
builder="cosyworld-release-$$"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target_cache="${COSYWORLD_RELEASE_TARGET_CACHE:-}"
prebuilt=""
# Each invocation owns its builder. Its registry cache survives job cleanup.
trap 'docker buildx rm "$builder" >/dev/null 2>&1 || true; [ -z "$prebuilt" ] || rm -rf "$prebuilt"' EXIT

binary_args=()
if [ -n "$target_cache" ]; then
  prebuilt="$(mktemp -d)"
  bash "$root/scripts/compile-release-server.sh" "$target_cache" "$prebuilt/app/bin"
  binary_args=(--build-arg ORCHESTRATOR_BINARY=orchestrator-prebuilt
    --build-context "orchestrator-prebuilt=$prebuilt")
fi

# With a prebuilt binary the only expensive layer is that binary, which the
# image push already uploads. Exporting it to the registry cache as well sent
# the same 600 MB twice, in parallel. Tags and dispatches still export the
# compile stages their in-image build reuses.
cache_args=(--cache-from "type=registry,ref=$cache")
if [ -z "$prebuilt" ]; then
  cache_args+=(--cache-to "type=registry,ref=$cache,mode=max,image-manifest=true,oci-mediatypes=true")
fi

docker buildx create --name "$builder" --driver docker-container

docker buildx build --builder "$builder" --platform linux/amd64 \
  --build-arg "CARGO_BUILD_JOBS=$jobs" ${binary_args[@]+"${binary_args[@]}"} \
  "${cache_args[@]}" --provenance=false --tag "$image" --push .
