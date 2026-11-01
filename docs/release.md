# Release Process

Deployments are handled by `.github/workflows/deploy.yml`.

## Delivery schedule

Merges are expected all day, so `.dev` and production change on a schedule
rather than once per merge:

1. **Merge windows.** Pull requests merge to main whenever they are reviewed
   and their fast check is green. A merge deploys nothing by itself. The
   lander should land a batch shortly before a train leaves (at `:07` and
   `:37` past the hour) so the batch ships together and the next window
   starts clean.
2. **`.dev` train, every 30 minutes.** The scheduled `Deploy` run deploys
   main's head to `.dev` only when main has moved since `.dev`'s last
   rollout, and only when production inputs changed. Its run summary names
   the train's commit and lists the pull requests it carries, so each drop
   is labelled.
3. **Production.** When the owner says "tag it from `.dev`", release the
   commit the last train shipped ([Cutting a Release](#cutting-a-release)).
   Automatic promotion of the previous train is planned separately.

Owner controls:

- **Deploy `.dev` now:** `gh workflow run deploy.yml --ref main -f target=dev`
  runs a train at once, for an urgent fix.
- **Pause the train:** set the `COSYWORLD_DEV_TRAIN` repository variable to
  `off` (`gh variable set COSYWORLD_DEV_TRAIN --body off`); delete it to
  resume. The `dev` dispatch still works while paused.
- **Change the cadence:** edit the `schedule` cron line in
  `.github/workflows/deploy.yml`. GitHub can start scheduled runs several
  minutes late, so keep the interval at 15 minutes or more.

CI follows the same budget. The fast check (`fast-check.yml`, about five
minutes) runs on each pull request and each main push. The full suite
(`ci.yml`) runs only by hand; run it on a train's commit, not per pull
request, when a release needs it.

## .dev trains

A train runs one job, `Deploy main to .dev`, without the production gate or a
primary backup; bugs on `.dev` are fixed forward. Tags matching `v*` rerun the
production gate, deploy both the primary app and `cosyworld-lonelyforest`
from the tagged commit, and create a GitHub release only after both
deployments succeed.

The primary app is also `.dev`. When main has moved past the tagged commit,
the tag rollout would leave `.dev` on that older commit, so the
`Return .dev to the main commit it ran` job then rolls `.dev` back to the
last train's commit, from that commit's existing `deploy-<sha>` image, and
runs the same readiness and card-game smokes. It deploys nothing new.

The train job:

1. Compares main's head with the commit the primary app last rolled out,
   read from earlier Deploy runs (`scripts/last-dev-rollout.mjs`), and stops
   when main has not moved or only docs, tests, tooling, or release versions
   changed.
2. Writes the train summary (`scripts/dev-train-summary.sh`).
3. Builds the image, or reuses the `deploy-<sha>` image when that commit
   already has one, so a rerun skips the build.
4. Waits while a production deploy is queued or running, then rolls out and
   verifies `.dev`.

A train deploys the commit it started on even if main moves meanwhile; the
next train takes the rest.

Trains and production runs (tags and production dispatches) queue in
separate concurrency groups. GitHub keeps one pending run per group, so when
they shared one, a main push replaced a waiting tag deploy (v1.2.107, run
41266788580). Both roll out the primary app, so
`scripts/serialize-primary-rollout.sh` keeps them apart: a train waits before
its rollout while any production run is active, and the production backup
and rollout wait for a train already past that point. Production never waits
on a waiting train, so neither can deadlock. The workflow's `run-name` starts
with `.dev train`, which is how that script tells a `dev` dispatch from a
production one. A pending train is replaced only by a later train, which
reports for it (#1044).

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
cache, so a train no longer replaces their dependency layers.

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

Broken tests do not block `.dev`. When the owner says "tag it from .dev",
release the exact commit `.dev` serves, without waiting for the full suite.
The deploy workflow's own production gates (Node, Rust, worldpack
compatibility, volume space, backups) still run on the tag. File any
full-suite failure as an issue and fix it in parallel.

1. Read the commit `.dev` serves:
   `curl -s https://cosyworld.fly.dev/meta | jq -r .commit`, then
   `git fetch origin && git rev-parse <commit>`.
2. Confirm the tag run's **Production Rust gate** will pass. It runs
   `bash v2/scripts/check-rust.sh test`, the same command as CI's **Rust
   build and tests** job; pull request fast checks do not run it. Find a
   green **Rust build and tests** job on that commit, or on a branch head
   whose tree differs from it only in version files
   (`git diff --stat <head> <commit>`). If none exists, run
   `gh workflow run ci.yml --ref main` and wait for its Rust jobs. Fix any
   failure before bumping (1.2.109's tag run failed here).
3. Bump the version in a small release PR on that commit. When main has not
   moved past it, branch from `origin/main`; otherwise branch from the
   `.dev` commit itself:

   ```sh
   git switch -c claude/release-X.Y.Z <dev-commit>
   npm run version:bump          # patch; or `npm run version:bump -- X.Y.Z`
   npm run check:version
   git commit -am "Release X.Y.Z"
   git push -u origin HEAD && gh pr create --fill
   ```

4. Merge after the fast check passes. Tag the merge commit:
   `git tag vX.Y.Z <merge-commit> && git push origin vX.Y.Z`. When main
   moved, tag the bump commit on the release branch instead, which sits
   directly on the tested commit (1.2.106 shipped this way), then merge the
   PR so main carries the version.
5. Watch: `gh run watch "$(gh run list --workflow deploy.yml --branch vX.Y.Z --limit 1 --json databaseId --jq '.[0].databaseId')"`.
   The Rust gate reuses a CI run on the tag commit when one exists and runs
   its checks itself, at once, when none does.
6. Smoke: both `/meta` endpoints report `X.Y.Z` and the tag commit, and the
   GitHub release exists.

The tag run's `/meta` check requires the deployed version to equal
`package.json` at the tag, which holds because the release PR bumped it.

A one-click `release` dispatch is a follow-up, not built. A tag pushed with
`GITHUB_TOKEN` starts no workflow, so it would have to dispatch `deploy.yml`
at the tag itself, and the version bump still has to reach main through a
PR. The `Release image` workflow only builds and smoke-tests an image; it
never tags.

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
