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
3. **Production.** Lonely Forest changes only on a release tag. When the
   owner says "tag it from `.dev`", release the commit the last train
   shipped ([Cutting a Release](#cutting-a-release)). Nothing promotes a
   train to production on a schedule
   ([Production releases](#production-releases)).

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
minutes) runs on each pull request and each main push, including the core
browser smokes (the `core` list in `scripts/fast-smokes.json`, each in its own
parallel job, ahead of up to three chosen by changed paths) and
`cargo fmt --check` for the Rust orchestrator. A pull request that
touches Rust inputs (the crate, the C kernel, or a file the crate reads, such
as `v2/card-game/senses.json`) also runs the focused Rust tests of the modules
involved; clippy and the full Rust suite stay on the .dev train's Rust gate and
on tags. The full suite
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
The restore step's name records the exact commit it returned to. Later trains
and tags read that SHA and the successful step's completion time, including
earlier run attempts. This keeps a second tag's return pointed at the train
that `.dev` actually ran. Older restore steps use the earlier rollout record
that selected their commit.
Until it does, `.dev` runs the tag's older rules, so a world already on main's
newer rules answers "updating" and its players wait, untouched, until the
return lands ([shared worlds](../v2/docs/card-table/shared-worlds.md)).

`Create GitHub release` and the `.dev` return run on a tag even though
`Deploy main to .dev` is always skipped there (an implicit `success()` skipped
both on 1.2.116 and 1.2.117). Each decides whether the tag rolled out from
the rollout job's `deployed` output or, when `gh run rerun --failed` dropped
it, from `scripts/rolled-out-in-run.sh`, which looks for a successful rollout
step in any attempt of the run. A superseded rollout skips that step, so it
gets neither. If a release is still missing after a tag's rollouts, create
it with `gh release create vX.Y.Z --generate-notes --verify-tag`.

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
5. After a successful rollout, runs the production gates on the train's
   commit: the **Production Node and content gate**, the **Production Rust
   gate**, and **Production Rust architecture and lint**. Tests run after
   `.dev` deploys and before production: `.dev` does not wait for them and
   their result does not change it, but a release that only bumps that
   train's version reuses its passed Rust gate instead of running it again
   (about 5 to 8 minutes). The run stays open while
   they run, so a manual `dev` dispatch meanwhile waits up to about 8
   minutes for them.

A train deploys the commit it started on even if main moves meanwhile; the
next train takes the rest.

Trains queue in one concurrency group; each production run (a tag or a
production dispatch) has a group of its own, and production runs order
themselves ([Superseding production deploys](#superseding-production-deploys)).
GitHub keeps one pending run per group, so when trains and production shared
one, a main push replaced a waiting tag deploy (v1.2.107, run 41266788580).
Both roll out the primary app, so
`scripts/serialize-primary-rollout.sh` keeps them apart: a train waits before
its rollout while any production run is active, and the production backup
and rollout wait for a train already past that point. Production never waits
on a waiting train, so neither can deadlock. The workflow's `run-name` starts
with `.dev train`, which is how that script tells a `dev` dispatch from a
production one. A pending train is replaced only by a later train, which
reports for it (#1044).

## Deploy timings

`npm run deploy:timings` (`scripts/deploy-timings.mjs`, needs an
authenticated `gh`) reads recent Deploy runs (`--limit 30` by default) and
prints, for tags, promotions, dispatches, and `.dev` trains, the p50 and p90
wall time, the wait before the first job started, how often the Production
Rust gate reused a CI run, how often the image was reused rather than built
(an image step under two minutes), and each run's critical path. Every
Deploy run adds the same one-line summary for itself to its run summary
(`Report production deployment outcome`). Pick speedups from its numbers,
and put before and after numbers in the pull request.

## Superseding production deploys

A production run is about 12 minutes, most of it gates. When production runs
shared one queue, a newer release waited for the whole older run and then
deployed over it: v1.2.114 (run 41341888137) waited 11 minutes behind an
older promotion (run 41341734000). Now every production run starts at once,
and `scripts/supersede-production-deploy.mjs` orders them:

- **Which run wins.** The later run supersedes the earlier one, so the
  owner's last tag or dispatch is what ships. A dispatch from a `promote/*`
  branch (left from the retired scheduled promotion) is the exception: it
  never supersedes a run whose commit it does not contain, so a tag always
  beats it. The run name ends
  with its target (`Deploy v1.2.114 to both`); a run supersedes another only
  for the apps it deploys.
- **At the start** (`Confirm committed release still owns production`), a run
  cancels each older run it supersedes and covers whose Fly rollout jobs have
  not started, that is, one still in its gates, image build, guards, or
  backup. All of those are safe to stop: they do not touch the running apps,
  and an interrupted snapshot is recoverable. A run that an active run
  already supersedes stops itself before its gates.
- **Before each rollout** (`Yield to a newer production deploy`, the step
  right before `flyctl deploy`), a run skips the rollout and its smokes when
  a newer run that may still deploy that app exists, or already deployed it.
  Otherwise it waits while an older run is rolling out that app (for a tag's
  primary app, until its `.dev` restore finishes), then deploys.
- **Before each backup**, a run waits for any other rollout of that app, so
  the snapshot follows it.

Nothing cancels a job that has started a rollout or a `.dev` restore: a run
whose rollout job is queued or running is never cancelled, and the newer run
waits for just that job, about three minutes. The rollout claim and the
start check read the same run list, so two runs cannot both deploy one app
at once: the older run's claim sees the newer run and yields, and a newer
run created after the older claim passed sees the older rollout job running
and waits. A run skipped this way reports success but deploys nothing; a
superseded tag gets no GitHub release, and its tracking issues stay open.

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

`.dev` is for existing passkey holders. `fly.toml` sets
`COSYWORLD_PASSKEYS = "members"`, so the primary app refuses new passkey
sign-ups ("Sign-ups are closed on this test server.") and answers 401 to every
play, text, and shared-world request without a passkey session. The page,
static files, `/health`, `/meta`, `/auth/*` sign-in, moderation, and internal
process calls stay public, so the deploy smokes still pass. Signed out, the
table shows a sign-in lock with a link to lonelyforest.com. Existing passkeys
sign in normally, and a signed-in passkey may add another. The setting takes
effect on the next `.dev` deploy. Lonely Forest leaves it unset, which means
`open` (no change); any other value stops startup.

### Agent test passkey

Agents and CI smokes sign in to `.dev` as the dedicated `agent-test` account,
an ordinary player account with no operator rights. The Fly secret
`COSYWORLD_DEV_TEST_PASSKEY` holds only the public half: a credential id and a
P-256 public key. At startup the server creates `agent-test` and installs
that one passkey, logging each change and each `agent-test` sign-in. The server
refuses to start with the secret set unless `COSYWORLD_PASSKEYS=members`, so
Lonely Forest can never take it. Unsetting the secret removes the passkey and
revokes the account's sessions on the next boot; replacing it retires the old
key the same way.

The private key lives only in `~/.config/cosyworld/dev-test-passkey.json`
(mode 600) and the GitHub Actions secret `COSYWORLD_DEV_TEST_PASSKEY_SECRET`.
Never commit it. In a Playwright script:

```js
import { devPasskeySession } from "./dev-test-passkey.mjs";
const { cookie } = await devPasskeySession(page); // signed in as agent-test
```

The helper adds a Chrome DevTools virtual authenticator holding the credential
and signs in through the table's own passkey code. It reads
`COSYWORLD_DEV_TEST_PASSKEY_SECRET`, then `COSYWORLD_DEV_TEST_PASSKEY_FILE`,
then the default file, and targets `COSYWORLD_DEV_URL` or `.dev`. The returned
`cookie` serves plain HTTP checks. `node v2/scripts/dev-test-passkey.mjs check`
confirms that sign-in works and a members-only endpoint answers.

To rotate the key, run `node v2/scripts/dev-test-passkey.mjs generate --force`
and set both secrets with the commands it prints:

```sh
fly secrets set --app cosyworld COSYWORLD_DEV_TEST_PASSKEY='<printed JSON>'
gh secret set COSYWORLD_DEV_TEST_PASSKEY_SECRET --repo cenetex/cosyworld \
  < ~/.config/cosyworld/dev-test-passkey.json
```

### Signing key

The story service signs the dialogue lines, thoughts, personas and dreams it
writes, and checks them when a browser sends them back
([signed envelopes](design/signed-envelopes.md#keys)). No secret is needed:
on first start each app makes its key and keeps it in the `signing_keys`
table of its event database on `/data`. Each app runs one machine with one
volume, so that is the only copy, and the Fly volume snapshots that back up
the journal back up the key too. `/.well-known/cosyworld-signing-keys.json`
shows the current `kid`.

- **Rotate:** deploy once with `COSYWORLD_SIGNING_KEY_ROTATE=<new kid>` (for
  example staged with `fly secrets set --stage … -a <app>`). Old keys keep
  verifying.
- **Override:** `COSYWORLD_SIGNING_KEY=<kid>:<seed>` signs instead of the
  stored key. Use it only for recovery onto a fresh volume or for an app that
  runs several machines with separate volumes.

### Setting Fly secrets

`fly secrets set` makes a release at once. If it starts while a Deploy run
is rolling out the same app, it waits for the machine lease and then writes
back the machine config it read earlier, which restores the previous image
after `flyctl deploy` has reported success. On 2026-11-02 this left `.dev`
on 0456b60d9 for two trains. The `.dev` rollout now checks that its machines
kept the train's commit (`scripts/fly-machines-serve-commit.mjs`) and rolls
out again when they did not. Set secrets when
`gh run list --workflow deploy.yml --status in_progress` is empty, or add
`--stage` so the next rollout applies them.

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
   green **Rust build and tests** job, or a green **Production Rust gate**
   from the `.dev` train, on that commit, or on a branch head
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
   The Rust gate and lint reuse passed checks (a CI run, or a `.dev`
   train's gate jobs) on the tag commit, or on its first parent when the tag
   commit changes only version lines in the version files
   (`scripts/await-ci-rust.mjs`), waiting while those run. They run the
   checks themselves, at once, when none exist, and again when they failed.
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

## Production releases

Lonely Forest (production) deploys only from a version tag (`vX.Y.Z`, see
[Cutting a Release](#cutting-a-release)). The owner decided on 2026-11-04
that only tagged versions reach production, so the scheduled promotion of
soaked `.dev` trains (`promote.yml` and `scripts/promote-train.mjs`, run at
`:22` and `:52`) was removed. `.dev` keeps its own train schedule.

A tag run keeps every production gate: the Node, Rust (`check-rust.sh test`,
#1743), and lint gates, worldpack compatibility, volume space, and the
Lonely Forest backup. A failed gate stops the deploy and opens the usual
tracking issue. When the tagged commit is one a `.dev` train already ran,
the tag reuses that train's passed Rust gate and lint. A tag pushed while an
older production run is still in its gates supersedes it
([Superseding production deploys](#superseding-production-deploys)).

Lonely Forest's `/meta` reports the tag's `version` and `commit`, and the
tag run creates the GitHub release.

A manual production dispatch (`gh workflow run deploy.yml -f
target=lonelyforest`) still exists, with the same gates, for the owner's
word or a recovery. It is not a versioned release, and nothing runs it on a
schedule.

## Upgrade and recovery

Keep the existing SQLite and generated-asset volumes attached during an upgrade.
The event database also holds the dialogue signing keys (`signing_keys`).
Restoring a volume snapshot restores them, so remembered words signed before
the snapshot still verify. A recovery onto a fresh volume makes a new key, and
words signed by the old one drop out of context; to keep them, restore the
database or set the old key as `COSYWORLD_SIGNING_KEY`.
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

Shared rules v88 added the `reflect` journal op
([shared worlds](../v2/docs/card-table/shared-worlds.md#learning-and-private-reflection)).
A build from before v88 cannot replay it, so a rollback past v88 leaves any
world that journaled a reflection unable to load until a v88 build returns.
This rollback limit is accepted. Roll forward instead.

## Lonely Forest operations

Provisioning, data authority, DNS cutover, and rollback are documented in
[`deployment/lonelyforest-fly.md`](deployment/lonelyforest-fly.md).
