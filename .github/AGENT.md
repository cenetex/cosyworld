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
npm run version:bump   # bumps package.json, package-lock.json, and the
                       # orchestrator Cargo.toml/Cargo.lock together; CI's
                       # check:version then accepts the PR
```

`npm run check:version` also fails early when the Rust crate version drifts
from `package.json`, so run it after any manual version edit. The pre-push hook
runs only `npm run check:version`; run `npm run check` by hand for the full
local gate.

Then run every row that matches the change:

| Surface | Required checks |
| --- | --- |
| Markdown-only docs | inspect links/commands; `npm run check:version` |
| Card table (`v2/card-game/`) | `npm test`; `npm run play:cards` and play the changed path at desktop and phone width; a new public file joins `public-assets.mjs`; run `npm run v2:card:assets:build` and commit the generated Rust asset module |
| Cross-surface tests (`test/`) | `npm test` |
| Pack/content/compiler | `npm run v2:worldpack` |
| C kernel or ABI | `npm run v2:kernel`; `npm run v2:rust:test` |
| Rust orchestrator | `npm run v2:rust:test`; targeted Rust test while iterating |
| Browser, HTTP, persistence, or multiplayer | `npm run v2:check` |
| Broad V2 or release change | `npm run check:local` and the relevant build |

CI is the final cross-platform authority. It uses Node 24 and stable Rust
for lint, tests, content, kernel, Rust builds, browser and composition smokes,
and guide checks. Browser journeys run in parallel groups from one shared
debug binary; keep each group near ten minutes and add a new journey script to
a group in `ci.yml`. A newer push cancels a pull request's run, but a running
main run finishes. Main saves one Cargo cache per UTC day, right after
compiling. A local suite
that opens ephemeral HTTP listeners may fail inside a restricted sandbox with
`listen EPERM`; rerun it where loopback binding is permitted rather than
changing application behavior.

## PR contract

- Use an imperative, outcome-oriented title, for example
  `Preserve room state across journal replay`.
- Keep one coherent behavior or extraction per PR. Split unrelated deployment,
  content, and feature changes.
- Keep at most one open PR in the repository. Before opening a PR, run
  `gh pr list --state open`. If one is open, finish your work on a pushed branch
  and wait until that PR merges or closes. Do not stack PRs on other PR
  branches. Put dependent changes in the same PR, or open them one after another.
- The body must contain:
  - `## Summary` with the user-visible or architectural outcome;
  - `Closes #<issue>` for work that fully satisfies an issue;
  - `## Validation` listing exact commands and observed results;
  - migration, generated-file, deployment, or compatibility notes when relevant;
  - a short review checklist confirming tests and generated artifacts.
- Merge as soon as local targeted tests pass; don't wait for CI. The deploy
  workflow runs its own gates, so a red main keeps .dev on the last good build.
  If main goes red, the next PR fixes it forward before anything else.
- Bump `package.json` and the root versions in `package-lock.json`; CI rejects a
  PR whose version matches the base branch.

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
  applies its own work onto main, regenerates the rules bundle, asset manifest
  and version, and commits; it stops only on a conflict in the branch's work;
- `v2/worlds/official/pack.lock.json` except through the lock command;
- `package-lock.json` except through an intentional dependency/version update;
- `v2/tests/visual-baselines/**` except for a reviewed UI change using the
  documented baseline update flow;
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
- The PR is versioned, validated, linked to its issue, and ready for CI.
