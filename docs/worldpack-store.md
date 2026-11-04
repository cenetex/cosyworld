# The worldpack store

Third-party card-table world packs live in **their own repositories** and
reach the game through this store: a publish-by-PR pipeline that pins every
pack to a commit and a content hash, validates it with the same rules as
in-tree packs, and compiles it into `v2/card-game/packs.json` exactly like
native content. The game runtime never fetches anything at play time; the
store is the only door a pack comes through.

## Pieces

- `worldpacks/store.json` — the index. One entry per published pack:
  metadata, source repo + pinned commit, a `sha256` over the pack's payload
  files, rating signals and curated reviews.
- `worldpacks/<id>/` — the **vendored copy** of each admitted pack
  (`card-world.json`, `card-bridge.json`, `assets/`). The vendored copy is
  what builds run from; the pin proves it matches the upstream repo.
- `scripts/build-card-store.mjs` — the gate. Verifies the pin, validates the
  pack (`packProblems` against the card-table hub), materializes art into
  `card-game/assets/<id>/`, and writes `worldpacks/vendor-manifest.json`.
- `scripts/build-card-worldpacks.mjs` — compiles in-tree packs **and**
  admitted store packs into `packs.json`. The runtime contract is unchanged:
  browser and Rust both read the same compiled file.
- `npm run v2:card:pack:build` / `v2:card:pack:check` — the store gate runs
  first, then the ordinary chain.

## Publishing a pack

1. **Make the pack** in its own repository with this layout:

   ```
   card-world.json     the world (places, avatars, items, topics)
   card-bridge.json    the crossings joining it to the card-table hub
   worldpack.json      manifest: id, revision, engine contract
   assets/             art (backdrops, portraits, item art)
   PROVENANCE.md       the generation prompt for every art asset
   ```

   `card-world.json` must pass the card-table validator (see
   `docs/card-packs.md`). Ids must not collide with the hub or other packs.

2. **Publish** = open a PR on this repository that adds:
   - the vendored copy under `v2/worldpacks/<id>/`, and
   - an entry in `v2/worldpacks/store.json` with the source repo, the source
     commit, and `pinned.sha256` — the content hash over every payload file,
     computed as `sha256` of the sorted list of
     `"<path>\n<byte length>\n<sha256 of file>\n"` lines.
   - if `--refresh-ratings` is used, GitHub star/fork signals are refreshed
     in the same build.

   The store build fails the PR if the vendored copy does not match the pin,
   if the pack does not validate, or if ids collide. Review covers tone,
   art provenance and the trust question (see below) — the machinery only
   certifies structure.

3. **Update** = a new PR that re-vendors the pack at a new commit and bumps
   the pin. The hash chain means no pack ever changes inside the game
   without a reviewed commit in this repo.

## Trust model

The pin binds the game to exact bytes a reviewer can read in the PR. What
the machinery guarantees: the vendored copy is byte-identical to the pin,
and the pack is structurally valid and rule-safe (a pack can only speak
through the card game's occasions; the validator blocks custody and
visibility lies). What it does not guarantee: the *content* is good, or the
pack's runtime lines are kind. That is what human review of the PR is for.

## Ratings

`rating` in `store.json` holds build-time GitHub signals (stars, forks) for
each pack's repo — refreshed with `node v2/scripts/build-card-store.mjs
--refresh-ratings`, never blocking the build. `reviews` holds curated,
PR-reviewed notes. Player-facing ratings (per-player votes, play counts)
need an orchestrator endpoint and are deliberately out of scope here; the
schema leaves room for them (`rating.source` can become `"orchestrator"`).
