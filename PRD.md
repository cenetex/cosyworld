# CosyWorld product

The current product is a world played through cards, with local saves and shared
worlds. The player chooses an avatar, handles items, travels, meets residents,
and pursues collected quests. Residents use the same world rules.

## Current experience

The reflected shore connects to the Steam Clock and the Wine-Dark Sea. Shared
worlds add eight human avatars and their homes. Character identity comes from
the current catalogs described in the [source map](docs/current-game.md).

Cards show reachable people, things, and places. Selecting cards reveals legal
actions. A committed action changes the saved world. Dialogue follows those
changes. Possession, shared journeys, quest progress, discoveries, and chosen
story accounts survive reload and shared-world replay.

Sharing imports the local world into the authenticated shared service. Each
person claims an available avatar. Room queues and presence keep shared play
ordered. The [shared-world guide](v2/docs/card-table/shared-worlds.md) describes
claims, saves, queues, and upgrades.

## Product principles

- Make each card an honest view of a person, thing, place, or quest.
- Let wants, belongings, encounters, and consequences produce the story.
- Keep character speech grounded in the completed action and its history.
- Give players time to read, browse, and choose.
- Preserve saved progress and each world's accepted history.

Use the [card guide](v2/card-game/README.md) for current behavior and GitHub
issues for proposed work. Earlier plans are in the
[planning archive](docs/archive/backlog/README.md). Earlier product
requirements are preserved in the [classic archive](docs/archive/classic/PRD.md).
