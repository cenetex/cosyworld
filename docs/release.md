# Release Process

Deployments are handled by `.github/workflows/deploy.yml`.

## Continuous deploys

Pushes to `main` deploy only the primary `cosyworld` Fly app, as soon as its
image is built, without the production gate or a primary backup; bugs on `.dev` are fixed
forward. Every main push also runs the fast check (`fast-check.yml`). The
full suite (`ci.yml`) runs only by hand and does not block a release (see
[Cutting a Release](#cutting-a-release)). Tags matching `v*` rerun the production gate, deploy both
the primary app and `cosyworld-lonelyforest` from the tagged commit, and create
a GitHub release only after both deployments succeed.

The primary app is also `.dev`. When main has moved past the tagged commit,
the tag rollout would leave `.dev` on that older commit, so the
`Return .dev to the main commit it ran` job then rolls `.dev` forward to the
newer commit it ran before the tag, from that commit's existing
`deploy-<sha>` image, and runs the same readiness and card-game smokes.

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
4. Waits while a production deploy is queued or running, checks ownership
   once more, then rolls out and verifies `.dev`. Nothing cancels a run
   after this point.

Main runs and production runs (tags and dispatches) queue in separate
concurrency groups. GitHub keeps one pending run per group, so when they
shared one, a main push replaced a waiting tag deploy (v1.2.107, run
41266788580). Both roll out the primary app, so
`scripts/serialize-primary-rollout.sh` keeps them apart: a `.dev` run waits
before its rollout while any production run is active, and the production
backup and rollout wait for a `.dev` run already past that point. Production
never waits on a waiting `.dev` run, so neither can deadlock. A main run is
still replaced only by a later main push, which reports for it (#1044).

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

## Production promotion

Lonely Forest (production) follows `.dev` by about one train.
`.github/workflows/promote.yml` runs at `:22` and `:52`, between `.dev`
trains, and `scripts/promote-train.mjs` picks what to promote:

- the newest `.dev` train (a `Deploy main to .dev` job) that rolled out and
  passed its readiness and card-game smokes on `cosyworld.fly.dev`;
- that stayed live on `.dev` for `COSYWORLD_PROMOTE_SOAK_MINUTES` (repository
  variable, default 20), until the next train replaced it or until now;
- only when the newest train also passed: a failing train holds promotion
  until a newer train passes;
- only when it is ahead of the commit Lonely Forest's `/meta` reports, so a
  train deploys to production at most once and never rolls a release back;
- never a commit whose production run already failed, and never while
  another production run is queued or running.

The primary app is `.dev`, so it already runs every train; promotion deploys
only Lonely Forest. It creates a `promote/<sha>` branch at the train's commit
and dispatches `deploy.yml` with `target=lonelyforest` on it. That run keeps
every production gate: the Node, Rust (`check-rust.sh test`, #1743), and lint
gates, worldpack compatibility, volume space, and the Lonely Forest backup. A
failed gate stops the deploy and opens the usual tracking issue. Each
promotion clears the earlier `promote/*` branches.

Promotion needs no new secret. The workflow's `GITHUB_TOKEN` creates the
branch (`contents: write`) and dispatches the deploy (`actions: write`);
GitHub lets `GITHUB_TOKEN` start `workflow_dispatch` runs, unlike pushes and
tags. If a branch ruleset ever blocks creating `promote/*`, exempt that
pattern for GitHub Actions.

Promotions are not versioned releases. Lonely Forest's `/meta` then reports
the last released `version` and the promoted `commit`, and no GitHub release
is created. Versioned releases still come from tags.

Owner controls:

- **Pause:** `gh variable set COSYWORLD_HOLD_PRODUCTION --body on`; delete
  the variable to resume. A manual run still promotes while paused.
- **Promote now:** `gh workflow run promote.yml --ref main` promotes the
  newest passing train without the soak (`-f now=false` keeps it;
  `-f dry_run=true` only reports).
- **Tag it from `.dev`:** a versioned release works as before; see
  [Cutting a Release](#cutting-a-release).

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
