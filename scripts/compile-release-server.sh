#!/usr/bin/env bash
set -euo pipefail

# Compile the release server with a saved target, in the Dockerfile's toolchain
# so it runs on the image. compile-release-binary.sh holds the crate version.
target_cache="${1:?A saved target directory is required}"
out="${2:?An output directory is required}"
[[ "$target_cache" = /* ]]
jobs="${COSYWORLD_RELEASE_BUILD_JOBS:-4}"
[[ "$jobs" =~ ^[1-4]$ ]]
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
toolchain="$(awk '$1 == "FROM" && $3 == "AS" && $4 == "chef" { print $2; exit }' "$root/Dockerfile")"
[[ "$toolchain" =~ ^lukemathwalker/cargo-chef:[A-Za-z0-9._-]+$ ]]
mkdir -p "$target_cache/target" "$target_cache/registry" "$out"
compile() {
  docker run --rm --platform linux/amd64 \
    --mount "type=bind,src=$root/v2/ai-model-rust,dst=/app/v2/ai-model-rust,readonly" \
    --mount "type=bind,src=$root/v2/rules-rust,dst=/app/v2/rules-rust,readonly" \
    --mount "type=bind,src=$root/v2/orchestrator-rust,dst=/src,readonly" \
    --mount "type=bind,src=$root/scripts/compile-release-binary.sh,dst=/usr/local/bin/compile-release-binary,readonly" \
    --mount "type=bind,src=$root/scripts/release-rustc-wrapper.sh,dst=/usr/local/bin/release-rustc-wrapper,readonly" \
    --mount "type=bind,src=$target_cache,dst=/cache" \
    --mount "type=bind,src=$out,dst=/out" \
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
test -s "$out/cosyworld-orchestrator"
chmod 0755 "$out/cosyworld-orchestrator"
