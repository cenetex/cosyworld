# Content source roles

The current card game selects packs in `v2/worlds/card-table.json`. It compiles
the selected `card-world.json` files and their `card-bridge.json` connections
into `v2/card-game/packs.json`. The forest, shared avatars, and base profiles
live beside that compiled card catalog.

Other source packs and compiled `actors.json` or `registry.json` bundles serve
the classic compatibility runtime. Their identities, locks, and saved history
remain part of its compatibility contract. The [current source map](../../docs/current-game.md)
shows the full cast lookup for current character work.
