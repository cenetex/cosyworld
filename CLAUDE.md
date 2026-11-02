# CosyWorld contributor guide

Read `AGENTS.md` and the [current source map](docs/current-game.md) first.
Check the branch, commit, package version, and selected live game before feature
work. Keep the original project folder on `main`; use a `codex/` worktree branch
for changes. Preserve local settings and other contributors' files.

## Product and authority

The shipping game is the card table in `v2/card-game/`. It supports local browser
saves and shared worlds. Its forest, shared avatars, profiles, and mounted card
packs supply the cast. The [card guide](v2/card-game/README.md) describes play.

The browser uses the authored JavaScript rules. Shared play runs those same
rules inside bounded C QuickJS, with C session guards. Rust handles requests,
provider calls, queues, persistence, and the append-only journal. See
[shared worlds](v2/docs/card-table/shared-worlds.md).

AI supplies dialogue from committed events and current character facts. The
rules own movement, possession, consent, quests, and outcomes.

The `/classic` client is retired ([#1652](https://github.com/cenetex/cosyworld/issues/1652)).
Native C world rules and classic packs remain until later phases remove them.
Their older product guides are in the [archive](docs/archive/classic/index.md).
The source map distinguishes the card pack compiler from the classic compiler.

## Make a change

1. Follow the active game's imports to the owning module and source data.
2. Keep rules in the shipping model and its focused modules. Preserve save
   migrations and the exact released rule bundles used for journal replay.
3. Run the relevant tests from `.github/AGENT.md`. Shared changes need replay
   and client/server agreement at the real authority boundary.
4. Rebuild the public asset list after adding a public file. Rebuild the shared
   engine after changing an imported rule module. Commit generated outputs.
5. Update the closest current guide. Do not bump the version: a release bumps
   the package and Rust crate versions once with `npm run version:bump`
   ([release operations](docs/release.md)).
6. Commit and push the branch and open a draft PR. Many PRs may be open at
   once; rebase yours when main moves. Merge once local targeted tests and the
   PR's fast check pass and the change is reviewed, in batches of 2-3 (see
   `.github/AGENT.md`). Main deploys `.dev` without gates as soon as its image is
   built, and the pre-push hook runs only the change budget and
   `npm run check:version`. Lonely
   Forest production releases stay a manual trigger.

## Commands

```sh
npm ci
npm run play:cards
COSYWORLD_PRIMARY_GAME=cards npm run dev
npm test
npm run docs:check
npm run check:local
npm run version:bump
npm run check:version
git diff --check
```

The full local gate requires the Rust `wasm32-unknown-unknown` target. Install it
with `rustup target add wasm32-unknown-unknown`.

## Review boundaries

Keep secrets and runtime files local. Preserve journal semantics, stable entity
IDs, bundle hashes, and save compatibility. Use source compilers for generated
packs, public assets, and shared engines. Keep new Rust systems in focused
modules and respect the checked main-file size ceiling.

`.github/AGENT.md` defines the required checks and PR format.
[Release operations](docs/release.md) define deployment and recovery.
