# CosyWorld engineering

The shipping game lives in `v2/card-game/`. Its JavaScript model owns the rules
for local play and shared play. See the [source map](docs/current-game.md).

## Current architecture

The browser renders cards and uses the model for local saves. Shared requests
send action choices to Rust. Rust runs the same authored model in bounded
QuickJS, checks the C session guard, journals accepted results, and publishes
views. The engine has bounded memory and execution time. Rust owns IO.

Released engine bundles retain their recorded behavior for replay. The current
rules version comes from the shared engine constant and appears in `/meta`.
Save migrations and explicit world upgrades preserve earlier accepted history.

The classic client is retired. The native C world kernel remains for
compatibility history until #1652's later phases remove it.
Their pack catalog and metadata have an explicit classic scope.

## Engineering priorities

1. Keep new systems in focused modules. The main-file line ceiling checks this.
2. Change rules in the shared source model, then rebuild its server bundle.
3. Test real action, save, replay, and HTTP boundaries for the changed behavior.
4. Keep public assets and server bundles from the same committed release.
5. Preserve identity, possession, consent, and completed quest evidence.

## Later: refactor without changing behaviour

Folded from the refactor epic [#1361](https://github.com/cenetex/cosyworld/issues/1361)
on 2026-11-01. The goal is smaller code that is easier to change, with a
harness proving behaviour stays the same. The harness comes before the big
splits, and every stage that moves code must pass it. Stages C, E, F and H
are done; dead-code removal (#1389) stays an open issue.

- **A. Equivalence harness (#1387).** A JS runner plays seeded games through
  the old and new `world.mjs` and compares `encodeSave`, `legalActions` and
  `narrativeContext` byte for byte; `decodeSave` runs over every fixture; a
  Rust `rules_agree` test compares `reduce_version(old)` and
  `reduce_version(new)`; it runs in CI. Using the production-journal corpus
  needs the owner's approval.
- **B. One released-version table, brotli bundles (#1388).** `engine.rs` and
  `full_world.rs` read one table; bundles are brotli-compressed (about
  17.0 MB to 2.54 MB); no new rules version; the `next-shared-rules.mjs`
  wiring regex follows.
- **D. Split `world.mjs` behind a facade (#1390).** Modules under
  `v2/card-game/world/` (catalog, geography, create, items, programs, log,
  encounters, actions, perform, planner, play, validate, save), a re-exporting
  facade, a codemod, and a passing harness. Needs #1387 first.
- **G. Invariant test helpers (#1393).** Tests stop pinning exact NPC paths,
  item starting spots and fixed `engine-vN` imports, and still fail when a
  real rule breaks.
- **I. Split `app.mjs` (#1395)** once the card-play UI work settles; browser
  smokes pass.
- **Measure `reduce_version` (#1396).** Measure where it spends its time
  before changing anything; then consider QuickJS bytecode precompiled once
  per version, validating packs only at build time, and fewer `validateWorld`
  passes.

## Source ownership and checks

The [card guide](v2/card-game/README.md) owns the game map. The
[shared-world guide](v2/docs/card-table/shared-worlds.md) owns its server boundary.
The [contribution policy](.github/AGENT.md) owns required checks. The
[release guide](docs/release.md) owns deployment.

Earlier architecture and priorities remain in the
[classic engineering archive](docs/archive/classic/ENG.md).
