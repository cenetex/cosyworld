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
  # Main pushes keep the release target between runs, so a UI or art change
  # recompiles only what changed. Compile in the Dockerfile's own toolchain
  # image, with the same source directories its build stage copies. See
  # compile-release-binary.sh for why the crate version is held fixed.
  [[ "$target_cache" = /* ]]
  toolchain="$(awk '$1 == "FROM" && $3 == "AS" && $4 == "chef" { print $2; exit }' "$root/Dockerfile")"
  [[ "$toolchain" =~ ^lukemathwalker/cargo-chef:[A-Za-z0-9._-]+$ ]]
  mkdir -p "$target_cache/target" "$target_cache/registry"
  prebuilt="$(mktemp -d)"
  mkdir -p "$prebuilt/app/bin"
  mounts=()
  for path in v2/core-c v2/content v2/content-engine-version.txt v2/card-game \
    v2/media v2/ai-model-rust v2/scripts/build-card-assets.mjs; do
    mounts+=(--mount "type=bind,src=$root/$path,dst=/app/$path,readonly")
  done
  # build.rs runs Node to generate the embedded card asset list. Official
  # Node builds run on the toolchain image's Debian release.
  node_binary="$(realpath "$(command -v node)")"
  mounts+=(--mount "type=bind,src=$node_binary,dst=/usr/local/bin/node,readonly")
  compile() {
    docker run --rm --platform linux/amd64 "${mounts[@]}" \
      --mount "type=bind,src=$root/v2/orchestrator-rust,dst=/src,readonly" \
      --mount "type=bind,src=$root/scripts/compile-release-binary.sh,dst=/usr/local/bin/compile-release-binary,readonly" \
      --mount "type=bind,src=$root/scripts/release-rustc-wrapper.sh,dst=/usr/local/bin/release-rustc-wrapper,readonly" \
      --mount "type=bind,src=$target_cache,dst=/cache" \
      --mount "type=bind,src=$prebuilt/app/bin,dst=/out" \
      --env "CARGO_BUILD_JOBS=$jobs" --env "OWNER=$(id -u):$(id -g)" \
      "$toolchain" sh /usr/local/bin/compile-release-binary
  }
  if ! compile; then
    # A damaged or incompatible saved target must not block a deploy.
    echo "Warm release build failed; retrying from an empty target." >&2
    rm -rf "$target_cache/target"
    mkdir -p "$target_cache/target"
    compile
  fi
  test -s "$prebuilt/app/bin/cosyworld-orchestrator"
  chmod 0755 "$prebuilt/app/bin/cosyworld-orchestrator"
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
