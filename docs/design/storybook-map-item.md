# The storybook map, retired

The **Map of the Wood and the Wine-Dark Sea** (`world-map`) was a hub item at
the Empty station (#1621). On 2026-11-01 the owner removed it from the game.
There is no replacement in the menu or settings.

## Rules and compatibility

`forest.json`, `card-table.json` and `entity-profiles.json` no longer define the
map, so new games never place it. Loading a save runs the generic content
reconcile: a thing the content no longer defines leaves the world with its
memories, wherever it lay. A map in Vale's hand leaves too; alpha saves may
lose it. The released engine bundles stay as they were, so journal replay of
older shared worlds is unchanged. The current shared content drops the item.

## Art

The map's card and view images (`assets/shared/items/world-map*.webp`), their
optimized variants and `world-map-art-prompts.json` were used only by this item.
They left the repo and the public asset list; git history keeps them. The
`art`/`view` and client-only **Look** support for hub things remains, unused.
The Willows' own `willows-map` and the art-direction atlas
(`docs/art-direction/assets/world-map.png`) are separate and stay.
