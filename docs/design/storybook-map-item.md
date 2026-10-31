# The storybook map as a hub item

Status: built, 2026-10-31. Engine change: shared rules v60.

## Outcome

The pen-and-ink storybook map of the shore is a card: the **Map of the Wood
and the Wine-Dark Sea** (`world-map`). It waits at the Empty station, outside
the opening hand, and starts covered like every newly met card. Players find,
hold, trade, want and drop it like the bell. Selected and uncovered, its card
offers **Look**, which opens the full map over the table.

## Why the station

The station is a sanctuary with a timetable of years that have yet to happen.
A map of where the rails might go belongs beside it. Vale wakes in the attic,
so the map is a discovery after the first crossing, not part of the opening.

## Rules

- `forest.json` `things["world-map"]` carries `name`, `text`, `art` and
  `view`. `initialState.items` places it at the station. `card-table.json`
  lists it in the hub items, and `entity-profiles.json` gives it a voice.
- No new verb. Take, give, trade, drop and wants already cover any hub item.
- `installPacks` now adds a hub item missing from an older save at its
  `initialState` holder. This keeps local saves and shared worlds valid when
  they upgrade to v60. It is the only rule-module code change, and it is why
  this needs a new rules bundle. `forest.json` is also still inside the engine
  until the content split in
  [pack content outside the engine](pack-content-outside-the-engine.md) lands.

## Presentation

- `app.mjs` resolves card art as pack art, then a hub thing's own `art`, then
  the forest `<id>-card.png`.
- **Look** appears only for a thing with a `view`, one card selected and
  uncovered. It opens the `#item-view` dialog with the large image. A tap on
  the image toggles zoom; a tap outside or Escape closes it. It never sends a
  play.
- Art: `assets/shared/items/world-map.webp` (1600 px, card and stage) and
  `world-map-full.webp` (4096 px, the view). The prompts and hashes live in
  `world-map-art-prompts.json`.

## Ids

The Willows already have `willows-map` (`assets/willows/map.png`), a different
map. The hub id is `world-map`, so the two never collide.
