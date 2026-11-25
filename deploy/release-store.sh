#!/bin/sh
# .dev's releases on the data volume: docs/design/fast-deploys.md#releases-on-the-dev-volume
set -eu

store="${COSYWORLD_RELEASE_STORE:-/data/releases}"
image="${COSYWORLD_IMAGE_ASSETS:-/app/assets}"
binary="${COSYWORLD_SERVER_BINARY:-/app/cosyworld-orchestrator}"
limit="${COSYWORLD_RELEASE_STORE_LIMIT:-75}"

fail() {
  echo "release-store: $*" >&2
  exit 1
}
commit_id() {
  case "$1" in *[!0-9a-f]* | "") return 1 ;; esac
  [ "${#1}" -eq 40 ]
}
stamp() { cat "$binary" "$image/manifest.json" | sha256sum | cut -c1-64; }
link() { readlink "$store/$1" 2>/dev/null || true; }

choose() {
  dir="$image" commit="${COSYWORLD_SOURCE_COMMIT:-}"
  if [ -n "${COSYWORLD_IMAGE_COMMIT:-}" ] && [ "$COSYWORLD_IMAGE_COMMIT" != "$commit" ] && commit_id "$commit"; then
    if [ "$(cat "$store/$commit/ready" 2>/dev/null)" = "$(stamp)" ]; then
      dir="$store/$commit"
    else
      echo "release-store: $commit was not checked on this image; serving the image's assets" >&2
    fi
  fi
  if [ -d "$store" ]; then
    old="$(link current)"
    [ -z "$old" ] || [ "$old" = "$dir" ] || ln -sfn "$old" "$store/previous"
    ln -sfn "$dir" "$store/current"
  fi
  echo "$dir"
}

serving() {
  dir="$(link current)"
  [ -n "$dir" ] && [ -f "$dir/manifest.json" ] || dir="$image"
  case "$dir" in "$store"/*) commit="${dir##*/}" ;; *) commit=image ;; esac
  out="$(mktemp -d)"
  trap 'rm -rf "$out"' EXIT
  printf '%s\n%s\n' "$image" "$commit" > "$out/serving"
  cp "$image/manifest.json" "$out/image.json"
  cp "$dir/manifest.json" "$out/serving.json"
  tar -czf - -C "$out" serving image.json serving.json
}

stage() {
  commit="${1:-}" bytes="${2:-}" built="${3:-}"
  commit_id "$commit" && commit_id "$built" || fail "stage needs a commit and its image's commit"
  case "$bytes" in *[!0-9]* | "") fail "stage needs the archive's size in bytes" ;; esac
  current="$(link current)" previous="$(link previous)"
  [ "$store/$commit" != "$current" ] || fail "$commit is the release .dev serves"
  mkdir -p "$store/objects"
  exec 9< "$store"
  flock -n 9 || fail "another stage is running on $store; try again once it ends"
  set -- $(df -Pk "$store" | tail -n 1)
  [ $((($3 + bytes / 1024) * 100)) -lt $((limit * ($3 + $4))) ] ||
    fail "$bytes more bytes would fill $6 past ${limit}%; extend the volume (flyctl volumes extend)"
  work="$store/incoming"
  rm -rf "$work"
  mkdir -p "$work"
  trap 'rm -rf "$work"' EXIT
  head -c "$bytes" | tar -xzf - -C "$work"
  for object in "$work"/objects/*; do
    [ -f "$object" ] || continue
    sha="${object##*/}"
    [ "$(sha256sum < "$object" | cut -c1-64)" = "$sha" ] || fail "object $sha does not match its name"
    chmod 0444 "$object"
    [ -f "$store/objects/$sha" ] || mv "$object" "$store/objects/$sha"
  done
  while read -r sha key; do
    ln -f "$store/objects/$sha" "$work/tree/$key"
  done < "$work/links"
  COSYWORLD_ASSETS_DIR="$work/tree" "$binary" --check-assets > /dev/null ||
    fail "$commit failed the assets check; .dev keeps serving ${current:-the image}"
  echo "$built" > "$work/tree/image"
  stamp > "$work/tree/ready"
  rm -rf "$store/$commit"
  mv "$work/tree" "$store/$commit"
  for release in "$store"/*; do
    case "$release" in
      "$store/objects" | "$store/current" | "$store/previous" | "$store/$commit" | "$current" | "$previous") ;;
      *) rm -rf "$release" ;;
    esac
  done
  find "$store/objects" -type f -links 1 -delete
  echo "staged $commit"
}

case "${1:-}" in
  choose) choose ;;
  serving) serving ;;
  stage) stage "${2:-}" "${3:-}" "${4:-}" ;;
  *) fail "use choose, serving or stage <commit> <bytes> <image commit>" ;;
esac
