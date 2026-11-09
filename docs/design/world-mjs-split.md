# Split world.mjs behind a facade (#1390)

The shipping rules model `v2/card-game/world.mjs` is a single ~4,100-line
module. This refactor moves it into focused modules under `v2/card-game/world/`
behind a re-exporting facade, without changing behaviour. The equivalence
harness (#1387) is the gate: each slice must keep the browser rules
byte-for-byte identical, and the Rust `rules_agree` test covers the shared
engine at the end.

## Module boundaries

The proposed modules follow the existing function clusters:

- `catalog` — `places`, `sanctuaries`, `people`, `things`, `nameOf` (done).
- `create` — `createWorld`, `seedRun` (done).
- `items` — `rootHolder`, `itemPlace`, `carried`, `covered`, `shining`,
  `willingToGive`, `tradePossible`, `canTrade`.
- `geography` — `senses`, `placeText`, `settleStationExits`, `exits`,
  `sealedWays`.
- `log` — `addLog`, `laneFact`, `laneTalkFacts`, `publishKnowledgeSpeech`,
  `LOG_LIMIT`, `GENERATED_LOG_LIMIT`.
- `actions` — `legalActions`, `matchingActions`, `accompanyDecision`.
- `planner` — `plan`.
- `play` — `play`.
- `validate` — `validateWorld`.
- `save` — `encodeSave`, `decodeSave`.

## Shared engine bundles

Each slice is a no-op refactor, so the released `engine-v*.js` bundle is not
rebuilt per slice. The bundle is rebuilt once at the end of #1390 and compared
against the current bundle with `rules_agree`. #1388 (one released-version
table + brotli) then collapses the per-version `include_str!` constants.

## Slices landed

- `world/catalog.mjs` — the catalog data and `nameOf`. Verified old-vs-new
  byte-for-byte equivalent across seeds 7, 42, 1729.
- `world/create.mjs` — `createWorld` and `seedRun`. Verified old-vs-new
  byte-for-byte equivalent across seeds 7, 42, 1729.
- `world/lanes.mjs` — `laneTalkFacts`, `laneFact`, `laneFactText` and the
  port/lane helpers. Verified old-vs-new byte-for-byte equivalent.
- `world/items.mjs` — `rootHolder`, `itemPlace`, `carried`, `covered`,
  `shining`. Verified old-vs-new byte-for-byte equivalent.
- `world/senses.mjs` — `reflectionOpen`, `reflectionsFrom`, `senses`,
  `sensesFor`, `baseSoundAt`. Verified old-vs-new byte-for-byte equivalent.
- `world/station.mjs` — `baseExits`, `stationCandidates`, `settleStationExits`,
  `limitedExits`, `stationTargets`. Verified old-vs-new byte-for-byte equivalent.
