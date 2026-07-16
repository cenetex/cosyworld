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
3. Read `CLAUDE.md`, `ENG.md`, the relevant focused doc under `v2/docs/`, and
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
npm run check:version
```

Then run every row that matches the change:

| Surface | Required checks |
| --- | --- |
| Markdown-only docs | inspect links/commands; `npm run check:version` |
| Legacy Node (`src/`, `test/`) | `npm test`; `npm run lint` when linted source changes |
| Pack/content/compiler | `npm run v2:worldpack` |
| C kernel or ABI | `npm run v2:kernel`; `npm run v2:rust:test` |
| Rust orchestrator | `npm run v2:rust:test`; targeted Rust test while iterating |
| Browser, HTTP, persistence, or multiplayer | `npm run v2:check` |
| Broad V2 or release change | `npm run check:local` and the relevant build |

CI is the final cross-platform authority and runs Node 20, stable Rust,
`npm run lint`, `npm run check`, a Rust build, and the web build. A local suite
that opens ephemeral HTTP listeners may fail inside a restricted sandbox with
`listen EPERM`; rerun it where loopback binding is permitted rather than
changing application behavior.

## PR contract

- Use an imperative, outcome-oriented title, for example
  `Preserve room state across journal replay`.
- Keep one coherent behavior or extraction per PR. Split unrelated deployment,
  content, and feature changes.
- The body must contain:
  - `## Summary` with the user-visible or architectural outcome;
  - `Closes #<issue>` for work that fully satisfies an issue;
  - `## Validation` listing exact commands and observed results;
  - migration, generated-file, deployment, or compatibility notes when relevant;
  - a short review checklist confirming tests and generated artifacts.
- Open as draft until local validation is complete. Do not merge with failing or
  pending required checks.
- Bump `package.json` and the root versions in `package-lock.json`; CI rejects a
  PR whose version matches the base branch.

## Known traps

- V2 is canonical. Do not implement new gameplay in the legacy Node companion
  just because its service graph is easier to navigate.
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
- Pushes to `main` deploy the production Fly app. Release tags also deploy to
  AWS and create a GitHub release. Feature branches never target production.

## Files requiring special handling

Do not edit or commit these directly:

- `.env`, `.env.*`, keys, wallet files, bearer tokens, logs, or runtime SQLite
  and snapshot data;
- `v2/content/official/**` except as output from the worldpack compiler;
- `v2/worlds/official/world.lock.json` except through the lock command;
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
