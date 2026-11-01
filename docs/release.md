# Release Process

Deployments are handled by `.github/workflows/deploy.yml`.

## Continuous deploys

Pushes to `main` deploy only the primary `cosyworld` Fly app, as soon as its
image is built, without the production gate or a primary backup; bugs on `.dev` are fixed
forward. Every main push also runs the fast check (`fast-check.yml`). The
full suite (`ci.yml`) runs only by hand before a release: run
`gh workflow run ci.yml --ref main` on the commit to be tagged, and tag it
only when that run is green. Tags matching `v*` rerun the production gate, deploy both
the primary app and `cosyworld-lonelyforest` from the tagged commit, and create
a GitHub release only after both deployments succeed.

A main push runs one job, `Deploy main to .dev`, so it waits for one runner
rather than five in a row. The job:

1. Yields if main has already moved past its commit.
2. Compares the commit with the one the primary app last rolled out, read
   from earlier Deploy runs (`scripts/last-dev-rollout.mjs`), and stops when
   only docs, tests, tooling, or release versions changed. Comparing with the
   live commit, not the previous push, means a docs-only commit still deploys
   a code commit whose run was superseded.
3. Builds the image while a watcher checks main every 15 seconds. When main
   moves, the run cancels itself (`scripts/yield-superseded-deploy.sh`) and
   the newer run, waiting in the deploy concurrency group, starts at once.
   Only main-push runs yield; tag and dispatch runs never do.
4. Checks ownership once more, then rolls out and verifies `.dev`. Nothing
   cancels a run after this point.

The image job compiles the release binary on the runner, in the Dockerfile's own
`cargo-chef` toolchain image, with a release target restored from the GitHub
Actions cache. The image takes that binary through the `orchestrator-prebuilt`
build context, so a UI or art change recompiles the crate incrementally rather
than from scratch. Cargo folds the crate version into the crate's identity and
each release bumps it, so this build fixes the manifest version at `0.0.0` and
passes the real version to the compiler through
`scripts/release-rustc-wrapper.sh`; `/meta` still reports the real version.
The first deploy of each UTC day saves the target again, after `.dev` is live.
A failed warm build retries once from an empty target. Tags and dispatches
skip this cache and compile inside the Dockerfile as before, unless an image
for that commit already exists; only those builds write the registry build
cache, so a main push no longer replaces their dependency layers.

The repository keeps 10 GB of Actions caches and evicts the least recently
used. The release target is about 2.3 GB, the CI Cargo cache about 2 GB, and
the Mac app cache reached 6 GB before it left out the app bundle and the
game crate. Each of the three saves at most once per UTC
day, from main only; saving the Mac cache for every commit and pull request
evicted the release target within minutes of each save.

The workflow requires these app-scoped GitHub secrets:

- `FLY_API_TOKEN` for the primary app
- `FLY_LONELYFOREST_API_TOKEN` for Lonely Forest

The workflow deploys `fly.toml` to the primary app and
`fly.lonelyforest.toml` to Lonely Forest in separate jobs. The two apps run the
same committed release with independent volumes and WebAuthn relying-party
domains.

## Volume headroom

Both Fly data volumes extend automatically at 80% usage in 1 GB increments,
up to a 5 GB ceiling. The deploy workflow still refuses to deploy at 85% so a
failed or exhausted auto-extension cannot be hidden by a release.

`.github/workflows/volume-headroom.yml` checks both volumes every 15 minutes
and fails its app-specific job at 70% usage. Operators should subscribe to
GitHub Actions failure notifications for the `Volume headroom` workflow. A
failure at 70% is an alert to inspect SQLite and generated-asset growth before
the 80% automatic extension is needed; reaching the 5 GB limit requires a
retention or capacity decision rather than another automatic increase.

## Lonely Forest infrastructure

Application releases no longer build ECR images or update ECS. AWS remains the
authority for the `lonelyforest.com` Route 53 zone and the static
`lonelyforestlibrary.com` S3/CloudFront site. Its dormant ECS/EFS/ALB resources
are kept only for the documented rollback window.

The Terraform state remains stored in:

- S3 bucket: `cosyworld-lonely-forest-terraform-state-022118847419`
- Key: `lonely-forest/terraform.tfstate`
- Lock table: `cosyworld-lonely-forest-terraform-locks`

## Versions

Pull requests do not bump the version. Main and `.dev` keep the last released
version between releases; each deploy sets `COSYWORLD_SOURCE_COMMIT`, and
`/meta.commit` reports its first 12 characters, so `/meta` shows a `.dev` build
as `version` plus `commit`. `npm run check:version` (CI, pre-commit, pre-push)
checks only that `package.json`, `package-lock.json`, both Cargo manifests and
lock files, and the desktop config agree.

Journal replay, saves, released rules bundles (`engine-vN.js` and their
hashes), worldpack bundle hashes, and the card asset manifest do not read the
package version. It appears only in `/meta.version`, the
`x-cosyworld-card-version` and media headers, activation metrics
`release_version`, and the Mac app name.

## Cutting a Release

Bump the version once, in a small release PR:

```sh
git switch -c claude/release-X.Y.Z origin/main
npm run version:bump          # patch; or `npm run version:bump -- X.Y.Z`
npm run check:version
git commit -am "Release X.Y.Z"
```

Merge it after its fast check passes, run the full suite on the merge commit
(`gh workflow run ci.yml --ref main`), and tag that commit with `vX.Y.Z` as
below only after the full run is green.
The tag run's `/meta` check requires the deployed version to equal
`package.json` at the tag, which holds because the release PR bumped it.

The Mac shell and game helper share this version. `npm run version:bump` updates
the package and both Cargo manifests and lock files. The **Local desktop app** workflow builds the same
commit on `main` and release tags. Its package check verifies the app version,
shared rules, voice references, and public game files against the web source.
Use the version and source commit in its download manifest to select the app
for that release. The source asset hash appears in both services at
`/meta.card_game.assets_sha256`.

`v2/content-engine-version.txt` is a separate compatibility contract; change it
only when pack engine compatibility actually changes.
For a major or otherwise high-risk release, deploy an immutable release candidate
from the exact commit first:

```sh
git tag vX.Y.Z-rc.1
git push origin vX.Y.Z-rc.1
```

Wait for the production gate, both deploy jobs, live `/meta` checks, and the
candidate GitHub release to succeed. Observe the candidate in production before
promoting that same commit. Do not rebuild or amend it between candidate and
promotion.

Promote the observed commit with the final version tag:

```sh
git tag vX.Y.Z
git push origin vX.Y.Z
```

The workflow deploys both Fly apps, then creates GitHub release notes.

## Upgrade and recovery

Keep the existing SQLite and generated-asset volumes attached during an upgrade.
The runtime restores the latest accepted checkpoint, replays the retained journal
suffix, and refuses incompatible world-pack or generated-descendant state rather
than silently replacing it. A normal release must report zero checkpoint
rejections in `/meta` after deployment.

Recovery captures are compatibility evidence for an exact live bundle and
tenant, not generic seed data. Use a capture only through the guarded workflow
input documented in [`deployment/07-deployment.md`](deployment/07-deployment.md),
and verify the resulting bundle hash and journal cursor before cutting the next
tag. Prefer a forward fix over rolling an active persistent world back across a
schema or world-pack boundary.

## Lonely Forest operations

Provisioning, data authority, DNS cutover, and rollback are documented in
[`deployment/lonelyforest-fly.md`](deployment/lonelyforest-fly.md).
