#!/usr/bin/env bash
set -euo pipefail

# Stage $GITHUB_SHA on .dev's volume (docs/design/fast-deploys.md); prints unchanged=.
: "${MACHINE:?The machine .dev serves from is required}"
: "${IMAGE_COMMIT:?The commit the image .dev runs was built from is required}"
[[ "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]]
work="${RUNNER_TEMP:?}/dev-release"
rm -rf "$work"
mkdir -p "$work/serving"
on_dev() {
  timeout 300 flyctl ssh console --quiet --app cosyworld --machine "$MACHINE" --command "$1"
}
fetch() { git fetch --quiet --no-tags --depth=1 --filter=blob:none origin "$1"; }

fetch "$IMAGE_COMMIT"
node scripts/dev-release.mjs image-input "$IMAGE_COMMIT" "$GITHUB_SHA" > "$work/path"
if ! grep -qx image=false "$work/path"; then
  echo "::error::.dev's image changed since the plan: $(sed -n 's/^reason=//p' "$work/path"). The next push deploys." >&2
  exit 1
fi
on_dev "sh /app/release-store.sh serving" | tar -xzf - -C "$work/serving"
served="$(sed -n 2p "$work/serving/serving")"
[ "$served" != image ] || served="$IMAGE_COMMIT"
fetch "$served" || served=""
node scripts/dev-release.mjs materialize "$work/serving" "$served" >&2
node v2/scripts/build-card-assets.mjs --known "$work/serving/serving.json" --manifest "$work/manifest.json" >&2
node scripts/dev-release.mjs pack "$work/serving" "$work/manifest.json" "$work/release.tgz" | tee "$work/pack" >&2
if grep -qx unchanged=true "$work/pack" && [ -n "$served" ] && git diff --quiet "$served" HEAD -- fly.toml; then
  echo "::notice::.dev already serves these files and this config (${served:0:7}); nothing to roll out." >&2
  echo "unchanged=true"
  exit 0
fi
bytes="$(sed -n 's/^bytes=//p' "$work/pack")"
on_dev "sh /app/release-store.sh stage $GITHUB_SHA $bytes $IMAGE_COMMIT" < "$work/release.tgz" | tee "$work/stage" >&2
grep -q "^staged $GITHUB_SHA" "$work/stage"
echo "unchanged=false"
