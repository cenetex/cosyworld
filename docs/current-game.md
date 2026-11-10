# Current game source map

CosyWorld's shipping surface is the card table. It supports local browser saves
and shared worlds. Read the checked-out version in `package.json`; read the
running version and `primary_game` at each site's `/meta`.
The Mac package embeds the same card files and uses the same release version.
`/meta.card_game.assets_sha256` identifies the public game files in either build.

## Game and cast sources

| Subject | Owning source |
| --- | --- |
| Rules and saved state | `v2/card-game/world.mjs` and its imported rule modules |
| Browser entry and presentation | `v2/card-game/entry.mjs`, `app.mjs`, and their imports |
| Forest catalog and opening | `v2/card-game/forest.json` |
| Shared human avatars and homes | `v2/card-game/shared-cast.json`, used by `human-cast.mjs` |
| BoardyAI, his home, and calling card | `v2/card-game/boardyai.json` and `boardyai.mjs` |
| Base character writing profiles | `v2/card-game/entity-profiles.json` |
| Place sense lines and avatar pronouns (server voice only) | `v2/card-game/senses.json` |
| Mounted card pack selection | `v2/worlds/card-table.json` |
| Authored card pack data | `v2/content/<selected-pack>/card-world.json` |
| Pack connections to the shore | `v2/worlds/<selected-pack>/card-bridge.json` |
| Hoppy Cat card refresh | `v2/content/hoppycat-archive/card-world.json` and `CARD-REFRESH.md` |
| Compiled card packs | `v2/card-game/packs.json`, built by `build-card-worldpacks.mjs` |
| Runtime pack and avatar lookup | `v2/card-game/pack-registry.mjs` |
| A quest stack per avatar: met, next, drop, level | `v2/card-game/want.mjs`, driven by `world.mjs` |
| Starter quests | `want` on each person in `forest.json` and each pack resident |
| A person's quest in Talk context | `v2/card-game/want-talk.mjs`, used by `narrative.mjs` |
| Learned facts and Talk topics | `v2/card-game/knowledge.mjs` and each card pack's `topics` |
| Dialogue service | `v2/orchestrator-rust/src/card_narrative.rs` and its modules |
| Shared rules and current version | `v2/orchestrator-rust/src/card_shared/engine.rs` |
| Public asset list | `v2/card-game/public-assets.mjs` |

The forest has Vale, Pip, and the keeper. Shared avatars add Mara, Ash, Iris,
Tavi, Rue, Cass, and Sage alongside Vale. The selected packs add Badger, the Wine-Dark Sea cast, and the
Hoppy Cat: February Third cast. Derive a full roster from these catalogs and their imports
when doing character work; shared presence and discovery determine who appears
in a particular saved world.

## Identity checks

The physical Pip card points to `/pip` (also `/pip/`). It opens a separate
local save. The existing wooden box and whispers reveal Pip's card on black.
The card's Talk action gives his Lamp quest, then fades into the regular Vale
intro carrying that quest. `pip-landing.mjs` sets up new visits; returning
visits restore that save.
Explicit world, table and pack query links keep their usual behavior.

Start each task with the branch, commit, and package version. Fetch `origin/main`
for new work. For a live task, check `/meta.primary_game` and follow the catalog
URLs in `/meta.card_game`. Compare the served files with the intended release.
The shared engine version and classic content-engine version are separate
contracts; each has a named scope in metadata.

## Classic compatibility

The `/classic` client is retired; `/` serves only the card table. The classic
source packs include `v2/content/core/`, `hoppycat-archive/`, and their
compiled bundles. `v2/worlds/official/` and `v2/content/official/` select and build
that runtime. Its `actors.json` and `registry.json` files describe the classic
cast. The classic compiler and release bundle guards keep saved history valid.

The hosted server boots card-only ([#1652](https://github.com/cenetex/cosyworld/issues/1652)).
`startup::run` calls `AppState::bootstrap_card` in `card_boot.rs`. It loads no
classic content registry, journal, snapshot or scheduler, and mounts only the
card table, `/auth` sign-in, shared worlds, dialogue, authoring, play metrics,
`/meta` and `/health` (`routes::card_app_router`). The classic rows stay on
disk, unread. The classic router, handlers, world modules and the native C
world kernel are deleted from the Rust crate. `AppState` holds only what the
card path reads: the deployment, the event store, accounts, AI config, the
generated-asset directory, the rate limiter and the moderation token.

Historical decisions keep their original dates and context. Current
behavior follows the shipping code, catalogs, tests, and live release.

## Reading list

- [Card game](../v2/card-game/README.md)
- [Shared worlds](../v2/docs/card-table/shared-worlds.md)
- [Dialogue beats](../v2/docs/card-table/dialogue-beats.md)
- [Greek redesign](../v2/docs/card-table/greek-redesign.md)
- [Recipes and the item economy](../v2/docs/card-table/recipes-and-item-economy.md)
- [Card pack authoring](../v2/docs/card-packs.md)
- [Runtime operations](../v2/README.md)
- [Releases](release.md)

`docs/current-docs.json` selects the current HTML navigation and combined AI
reading document. The History section links the archive separately.
