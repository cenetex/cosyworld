# Automated contribution policy

This policy applies to every automated contributor. No repository-specific
model override is required: choose a model with enough context and reasoning
for the issue, but make correctness depend on checked-in evidence and tests,
not on a model name.

## Before editing

1. Read the complete issue and linked specifications. Treat unchecked
   acceptance criteria as required until current evidence proves they are stale
   or contradictory.
2. Inspect `git status` before touching files. The checkout may contain another
   contributor's work; preserve it and use an isolated worktree when needed.
3. Read `AGENTS.md`, `docs/current-game.md`, `CLAUDE.md`, `ENG.md`, and
   the current implementation. Issue line numbers and design assumptions drift.
4. Identify the authoritative path and the evidence that will prove completion.
   Do not use a UI assertion to prove a kernel rule or a unit test to prove
   replay, deployment, or multiplayer behavior.

If the issue's premise is contradicted by current `main`, record the concrete
consumers or invariant and close/rewrite it transparently; do not delete active
behavior merely to satisfy stale wording.

## Tests before a PR

Always run:

```sh
git diff --check
npm run check:version  # package.json, package-lock.json, and both Cargo
                       # manifests and lock files agree
```

Pull requests do not bump the version. A release bumps it once with
`npm run version:bump` (see [release operations](../docs/release.md)).
`npm run check:version` fails when the Rust crate version drifts from
`package.json`, so run it after any manual version edit. The pre-push hook
runs the change budget and `npm run check:version`; run `npm run check` by hand
for the full local gate.

### Change budget

A branch may change at most 400 hand-written lines (added plus deleted) against
its merge base with `main`. `scripts/check-change-budget.mjs` prints the count on
every push and fails above the budget. The pre-push hook and the fast check
both enforce it. Pushes to `main` and
tags are not measured.

Binary files, images, audio, video, fonts, pack content (`v2/content/`,
`v2/card-game/assets/`, `test/fixtures/`), lockfiles, and outputs rebuilt by
tools (`packs.json`, media and image manifests, `card_assets.rs`, released
`engine-v*.js` bundles, snapshots) do not count. The groups and the budget live
in `scripts/change-budget.json`. An art-only or generated-only branch passes.

Over budget, split the work into smaller branches that each land on `main`. For
a rare change that cannot be split, set `COSYWORLD_LARGE_CHANGE=<reason>` when
pushing and add a `Large-Change: <reason>` line to the PR body; both print a
warning.

Then run every row that matches the change:

| Surface | Required checks |
| --- | --- |
| Markdown-only docs | inspect links/commands; `npm run check:version` |
| Card table (`v2/card-game/`) | `npm test`; `npm run play:cards` and play the changed path at desktop and phone width; a new public file joins `public-assets.mjs`; run `npm run v2:card:assets:build` to refresh `media-manifest.json` (Cargo builds the Rust asset module itself) |
| Cross-surface tests (`test/`) | `npm test` |
| Pack/content/compiler | `npm run v2:worldpack` |
| C kernel or ABI | `npm run v2:kernel`; `npm run v2:rust:test` |
| Rust orchestrator | `npm run v2:rust:test`; targeted Rust test while iterating |
| Browser, HTTP, persistence, or multiplayer | `npm run v2:check` |
| Broad V2 or release change | `npm run check:local` and the relevant build |

### Fast check

`fast-check.yml` runs on every pull request and every push to main, in about
five minutes (eight at most). It runs the change budget, version alignment,
the engine-gate warning, eslint, a prettier warning on changed files,
`docs:check`, `npm test`, and two or three browser smokes chosen by changed
paths (`scripts/fast-smokes.json`; a changed smoke script runs itself). Each
smoke serves the static card game; smokes that start the Rust server run only
in the full suite. A new PR run cancels the PR's older run; main runs are
never cancelled. Each job reads its runner label from the `FAST_CHECK_RUNNER`
repository variable (default `ubuntu-latest`), so moving to the Fly runner
(#1565) needs no workflow edit. While a production deploy (a `v*` tag or a
dispatch of `deploy.yml`) is queued or running, the plan job waits, for up to
15 minutes, before the other fast-check jobs ask for runners
(`scripts/yield-to-production-deploy.sh`), so the deploy is not queued behind
pull request checks.

### Landing

- Merge in batches of 2-3 PRs. Wait for the fast check on main to go green
  before merging the next batch.
- If main stays red for more than 20 minutes after diagnosis starts, revert
  the most likely PR and fix it forward on a branch.

### Full suite

The full suite (`ci.yml`, about 12 minutes on idle runners) runs only by hand
(`gh workflow run ci.yml --ref main`) and does not block a release: tag the
commit `.dev` serves as in [release operations](../docs/release.md#cutting-a-release),
and file failures as issues. Do not run it after batches.
`image-build.yml`, `local-desktop.yml`, and `pages.yml` also run only by
dispatch. `deploy.yml` deploys .dev from a scheduled train every 30 minutes
(not per merge) and runs the production gates on tags.

`.dev` is members-only. Scripts that play it sign in as `agent-test` with
`devPasskeySession(page)` from `v2/scripts/dev-test-passkey.mjs`; see
[agent test passkey](../docs/release.md#agent-test-passkey).

The full suite is the final cross-platform authority. It uses Node 24 and stable Rust
for lint, tests, content, kernel, Rust builds, browser and composition smokes,
and guide checks. Browser journeys run in parallel shards from one shared
debug binary. `scripts/plan-browser-shards.mjs` packs the measured checks in
`scripts/browser-shards.json` into shards of about six minutes; add a new
journey there with its duration, and split a long journey by width with
`smokeWidths` from `v2/scripts/card-browser-helpers.mjs`. Each run takes about
20 runners, so runs dispatched together queue for GitHub's concurrency limit. No full-suite run is cancelled. Known flaky tests listed in `QUARANTINED_TESTS` in
`v2/scripts/check-rust.sh` run in the non-blocking `Quarantined Rust tests`
job; each has an issue and a fix-by date. Main saves one Cargo cache per UTC day, right after
compiling. A local suite
that opens ephemeral HTTP listeners may fail inside a restricted sandbox with
`listen EPERM`; rerun it where loopback binding is permitted rather than
changing application behavior.

Rust build output grows fast. Each orchestrator debug build is about 5 GB
(the binary embeds the card assets), Cargo keeps every old build, and each
worktree has its own `target/`. Share one target
dir across worktrees and prune it now and then:

```sh
export CARGO_TARGET_DIR=~/.cache/cargo-target/cosyworld
cargo install cargo-sweep && cargo sweep --time 3   # drop builds older than 3 days
```

## Shared rules engine changes

Engine changes are deliberate and batched; build features as pack data when
possible. A PR that touches a module in the shared bundle's import graph, a
`card_shared/engine-v*.js` bundle, or the released-rules wiring needs the
`engine` label and a design note under `docs/design/`. The fast check's
engine-gate step (`v2/scripts/engine-gate.mjs`) lists the bundle's modules and warns
when either is missing; it will block once content versioning lands.

## PR contract

- Use an imperative, outcome-oriented title, for example
  `Preserve room state across journal replay`.
- Keep one coherent behavior or extraction per PR. Split unrelated deployment,
  content, and feature changes.
- Push early. Push a draft PR from your first commit and keep pushing work in
  progress, so an agent that stops never strands work on a local branch. Do
  not keep long-lived local branches.
- Many PRs may be open at once; they merge one at a time, and each rebases
  when main moves. Do not stack PRs on other PR branches. Put dependent changes
  in the same PR, or open the second after the first merges.
- The body must contain:
  - `## Summary` with the user-visible or architectural outcome;
  - `Closes #<issue>` for work that fully satisfies an issue;
  - `## Validation` listing exact commands and observed results;
  - migration, generated-file, deployment, or compatibility notes when relevant;
  - a short review checklist confirming tests and generated artifacts.
- Merge when local targeted tests and the PR's fast check pass and the change
  is reviewed, following the landing rules above. The deploy workflow runs its
  own gates, so a red main keeps .dev on the last good build.
- Leave the release version alone; only a release PR runs `npm run version:bump`.

## Known traps

- Build gameplay in the shipping modules under `v2/`. Use the card-game guide
  for the browser model, forest data, save upgrades, and public assets.
- `v2/orchestrator-rust/src/main.rs` is very large. Use exact searches and narrow
  reads; do not mix opportunistic refactoring into a feature fix.
- `v2/content/official/**` is compiled output. Editing it without the owning
  source pack produces a stale lock/bundle failure.
- A changed official pack set changes bundle identity. Old snapshots and action
  journals must not be silently loaded under the new identity.
- Journal replay is more authoritative than snapshots. Snapshot-only tests do
  not prove persistence.
- Browser/query wallet claims are development conveniences unless the explicit
  debug flag is enabled. Production access comes from protected feeds and
  signed sessions.
- Dialogue inference fails visibly and without substitute speech. Deterministic
  fallback is allowed only for explicitly designed non-dialogue content/media.
- Generated visual baselines use an intentional update flag. Never accept
  unrelated baseline churn.
- Full V2 smoke checks start local processes and use fixed runtime files; stop
  stale instances before diagnosing product failures.
- Pushes to `main` deploy only the primary Fly app, as soon as its image is
  built, without the production gate or a primary backup.
  Release tags deploy both the primary and Lonely Forest Fly apps, then create
  a GitHub release. AWS retains DNS, static-site, and rollback infrastructure;
  feature branches never target production.

## Files requiring special handling

Do not edit or commit these directly:

- `.env`, `.env.*`, keys, wallet files, bearer tokens, logs, or runtime SQLite
  and snapshot data;
- `v2/content/official/**` except as output from the worldpack compiler;
- released shared rules `v2/orchestrator-rust/src/card_shared/engine-v*.js`
  and their version wiring. After rebasing a branch that changes rule modules,
  run `npm run v2:card:shared:next`; it restores main's live rules and claims
  the next version once. To land a prepared branch, `npm run land -- <branch>`
  applies its own work onto main at main's version, regenerates the rules
  bundle and asset manifest, and commits; it stops only on a conflict in the branch's work;
- `v2/worlds/official/pack.lock.json` except through the lock command;
- `package-lock.json` except through an intentional dependency/version update;
- build outputs such as `target/`, `dist/`, coverage, generated runtime assets,
  or `.runtime/`.

Treat these as review-sensitive rather than forbidden:

- `v2/core-c/include/cosy_kernel.h` and journal action codes, because ABI or
  replay changes can invalidate history;
- production profiles, workflows, `Dockerfile`, and `fly.toml`, because a merge
  to `main` deploys to Fly;
- authored IDs, entitlement authorities, attributions, and pack dependencies,
  because they are persisted or externally meaningful.

## Completion checklist

- Every acceptance criterion has direct evidence.
- Authority, authorization, idempotency, and replay paths were reviewed.
- New state survives restart; new rules have authoritative tests.
- Generated artifacts match their source and contain no unrelated churn.
- Public copy passes the writing-register checks.
- No secret or local runtime file appears in the diff.
- The PR is validated, linked to its issue, and ready to merge.
