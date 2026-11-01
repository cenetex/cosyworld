# Version pack content separately from the shared rules engine

Status: design, 2026-10-31. Issue #1548. Related: #1549 (engine gate), #1552
(generated asset lists and per-pack files).

## Outcome

A pack, art, pose, dialogue or presentation change ships without a new
`engine-vN.js`. The rules engine changes only when the rules change. Every
released bundle, v2 through the newest, keeps replaying its journals
byte-identically.

## Why

The shared engine is everything `v2/card-game/shared-world-entry.mjs` imports.
On 2026-10-31 that was 36 modules. The bundle is about 950 KB, and
`packs.json` alone is 575 KB of it. Other members include `scene.mjs`,
`daylight.mjs`, `narrative.mjs`, `want-talk.mjs`, `forest.json`,
`weather.json` and `shared-cast.json`. Of the 25 rules bumps on 2026-10-30/31
(v32 to v57), 17 changed only art, poses, presentation or pack data. Each one
edited the same five wiring files and raced other branches for the next
number.

## Target

1. **Content is an input, not code.** The engine bundle holds rule modules
   only. Rust supplies one content revision per request: the compiled packs,
   forest, weather, cast, entity profiles, BoardyAI and emoji data that the
   rules read today through JSON imports.
2. **A content revision is content-addressed.** `packHash` is the SHA-256 of
   the exact content bytes handed to the engine. `packRevision` is the
   human-readable package version that built it. The hash is the authority.
3. **The journal records which content it used.** A world's state carries
   `{engine, packRevision, packHash}`. Seed records set all three. A new
   `repack` command moves a world to new content under the same engine.
4. **Content revisions are immutable and stored.** The server writes each
   revision it uses into `card_full_packs(hash PRIMARY KEY, revision, content)`
   before the first journal row that names it, in the same transaction.
   Replay reads content from that table by hash and checks the hash. Rows are
   never updated or deleted.
5. **Presentation and dialogue are outside the engine.** Scene staging,
   daylight drawing, narrative context and dialogue prompts move into a
   separate narrator bundle. Its output is never a journal input, so it is
   rebuilt freely and is never versioned or pinned.

## What the rules actually need

Most of the presentation imports are reachable only through two paths:

- `dispatchShared` puts `currentScene(world)` in every view. Rust drops that
  field; `full_store.rs` sends only `world`, `actions` and `exits`, and
  `full.rs` reads `context`, `profiles` and `events` from a play.
- `narrativeContext` builds the dialogue context for `play` and `context`.

One path is a real rule. The `speech` reducer calls `applySharedReflections`,
which validates and saves reflections against `narrativeContext(world)`. It
reads `entities[].memories`, `resting` and `turn`, and the entity list depends
on `sceneChanges` in `scene.mjs`. So a scene edit can change which committed
reflections are valid. Before the split, the fields reflections need move into
a rules module, `reflections.mjs`, with `sceneChanges`. `narrativeContext`
then calls that module, so the two cannot drift. `DAYLIGHT_TURNS`, the only
part of `daylight.mjs` the rules use, moves next to the clock rules in
`pack-rules.mjs`.

## Engine and Rust changes

- **Build.** `build-card-shared-engine.mjs` resolves the content JSON imports
  to a virtual module that reads `globalThis.cardContent[path]`.
  Rule modules keep their static JSON imports, so the browser is unchanged.
  `build-card-shared-content.mjs` writes the current revision to
  `card_shared/content.json` with a stable key order. CI checks that it is
  fresh, as it does for the engine.
- **QuickJS.** For engines that declare content input (v58 and later),
  `engine::reduce_version` takes the content text. Each request still uses a
  fresh runtime with the same limits and deadline. Rust parses the content
  with QuickJS's JSON parser, sets `globalThis.cardContent`, then evaluates
  the bundle. Module initialisers that derive tables from packs run after the
  content is set. Engines v2 to v57 get exactly the source they get today and
  no content global.
- **View cache.** The projection cache key adds `packHash` to the engine
  version, so two content revisions never share a cached view.
- **World.** `full_world::World` gains `pack: Option<String>`, with
  `#[serde(default, skip_serializing_if = "Option::is_none")]`. Old snapshots
  and seed records then deserialize and re-serialize to the same bytes.
- **Load.** After replay, a world on an old engine is upgraded as today. The
  upgrade to v58 also records the current `packHash`. A v58 world whose
  `pack` differs from the binary's current hash gets one `repack` command,
  `{"op":"repack","from":old,"to":new,"revision":"1.x.y"}`. The engine's
  `upgrade` operation applies it under the new content and bumps the
  revision, just as a rules upgrade does today.
- **Narrator.** `card_shared/narrator.js` is built from
  `shared-narrator-entry.mjs`. Rust calls it for the `context` of a committed
  play and for the scene text it sends to providers. It only ever sees
  current-engine worlds, because live worlds upgrade on load.
- **Cast.** Rust reads `shared-cast.json` for avatar IDs and the C session
  guard. The content loader rejects a revision whose eight avatar IDs or their
  order differ from the binary's, because that would change guard indices.

## Replay guarantees

- Journals written under v2 to v57 replay with their own bundles, unchanged.
  Their packs are baked in, so they need no content row. The released-rules
  hash test keeps pinning those bundles.
- A journal row under v58 or later replays with that engine and the content
  named by the world's `pack` at that row. The seed, upgrade and `repack`
  commands are the only rows that change it.
- The server refuses to commit a command that names content it cannot store.
  It also refuses to replay when a content row is missing or its hash fails.
  It reports the world as needing recovery and never falls back to current
  content.
- Recovery captures and backups include `card_full_packs` with the journal.

## Migration, one PR at a time

Each PR stays under the 400-line budget and lands on green CI. Moving code
between modules changes the bundle bytes, so new rules modules land first as
unused, tested copies. The single engine PR then only switches imports and
deletes the originals.

1. This note and a bundle-module allowlist test. A new import into the shared
   engine fails CI until the allowlist is changed on purpose. No engine change.
2. Narrator bundle. `full_store::commit` asks it for each committed play's
   dialogue context; the engine still returns its own. No engine change.
3. `scene-cast.mjs` (3a: speaker selection, `sceneChanges`,
   `speechMemories`) and `reflections.mjs` with the content input plugin,
   switched off (3b). Tests show they agree with `narrative.mjs` and
   `scene.mjs`. Nothing in the engine imports them yet. No engine change.
4. Content store, the `content.json` builder, the `World.pack` field, the
   `repack` command and the content-aware `reduce_pack`. They stay inert
   until an engine reads `globalThis.cardContent`. No engine change.
5. **The one engine bump (v58, `engine` label).** `shared-world.mjs`
   imports the new modules, `DAYLIGHT_TURNS` moves to `pack-rules.mjs`, the
   plugin is switched on, and `next-shared-rules` mints v58. Views drop the
   drawn scene and plays drop dialogue context; the narrator supplies both.
   The bundle drops from 957 KB to 290 KB and holds no pack text.
6. `narrative.mjs` and `scene.mjs` build on the rules modules and lose their
   copies. They are outside the engine by then, so v58 is unchanged.

After step 5, an art, pose, dialogue or pack PR changes `content.json` or
`narrator.js` (both generated) and never `engine-v*.js`.

## Later

- Hash only the fields the rules read, so an image path change does not even
  create a content revision.
- Precompile the engine to QuickJS bytecode once per version.

## Later: pack effects and gates instead of special cases (#1550)

`world.mjs` names specific items and places about 50 times ("lamp", "attic",
"pond", "oil", the player "vale"): `reflectionOpen`, `insideLampRemedy`, the
attic and pond route rules, refuel. Each feature added a bespoke field to
`pack-schema.mjs` instead of reusing generic vocabulary.

- Define generic pack vocabulary in `pack-schema.mjs`: `effects` (refill,
  consume, reveal, return-to), `gates` (light, weather, night, held item, item
  aboard), and lanes and poses as data, read by one module.
- Port the attic opening and the lamp and oil first as the reference case,
  then remove the id-specific branches. Afterwards split `world.mjs`
  (movement, possession, combat, opening, home rescue).
- Done when no item or place ids remain in `world.mjs`, the forest's lamp,
  oil and attic behaviour is expressed in `forest.json`, and released bundles
  replay unchanged.

The [recipes design](../../v2/docs/card-table/recipes-and-item-economy.md)
(#1748) generalizes the oil refuel into `renews`, but defers moving the lamp
and oil and does not cover the light gates, attic and pond routes, reflection
or home rescue. On 2026-11-01 `world.mjs` still named "lamp" 15 times and
"attic" 13 times.

## Per-pack files (#1552)

Split `packs.json` into compiled files per pack if that helps merges. The
engine still receives one logical object, `{schemaVersion, hub, packs}`, with
packs in sorted ID order. The content builder assembles it, and the hash
covers the assembled bytes. Until step 5 lands, keep `pack-registry.mjs`
importing the single `packs.json`. Changing that import changes the engine.

## Hub reflections as data (#1600)

The attic mirror was the last hard-coded crossing rule (`reflectionOpen`).
Each `forest.json` `reflectionRoutes` entry now carries `requires`, written in
the pack condition vocabulary (`light`, `not`, `item_present`) and read by the
same `conditionMet`. The opening flips with data alone: the attic mirror
opens while the lamp there is not shining, and the pond's way back opens while
it shines at the pond. A hub place may also list `backdrops` (`backdrop` plus
`requires`); the first match paints the place, else its own `backdrop`. This
is the same shape #1620 gives pack places. The rule change ships as one new
rules version; released bundles replay older journals unchanged.
