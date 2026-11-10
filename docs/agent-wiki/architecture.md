# Architecture: find the owner

[Wiki home](README.md) · [Source map](../current-game.md) · [Engineering](../../ENG.md)

## Authority in one paragraph

Local play uses authored JavaScript rules. Shared play runs those same rules in
bounded QuickJS, with C session guards; Rust handles requests, queues, providers
and persistence. The rules decide movement, possession, consent, quests and
outcomes. AI describes committed events and the facts available to a character.
Neither a browser claim nor a character's generated words can grant an item.

## Follow an action

- Browser: [entry.mjs](../../v2/card-game/entry.mjs) and
  [app.mjs](../../v2/card-game/app.mjs) route presentation to
  [world.mjs](../../v2/card-game/world.mjs) and its imported rule modules.
- Local saves: inspect [local-saves.mjs](../../v2/card-game/local-saves.mjs)
  and the world's encode/decode/validation boundary.
- Shared client: [shared.mjs](../../v2/card-game/shared.mjs) and
  [shared-sync.mjs](../../v2/card-game/shared-sync.mjs).
- Shared requests and writer orchestration: [full.rs](../../v2/orchestrator-rust/src/card_shared/full.rs).
- Shared authority: [full_world.rs](../../v2/orchestrator-rust/src/card_shared/full_world.rs)
  invokes [engine.rs](../../v2/orchestrator-rust/src/card_shared/engine.rs);
  [full_store.rs](../../v2/orchestrator-rust/src/card_shared/full_store.rs) persists it.
  Read the [shared-world guide](../../v2/docs/card-table/shared-worlds.md) first.
- The C session guard is in [card_table.c](../../v2/core-c/src/card_table.c).
  The older `card_shared/kernel.rs` adapter is not the current authored-rules owner.

## Follow content or dialogue

| Question                                    | Owning entry point                                                                                                                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which packs/cast exist?                     | [card-table.json](../../v2/worlds/card-table.json), selected card-world/bridge files, forest/shared-cast catalogs; derive the roster rather than copying a list.                              |
| Which quests or facts does a person know?   | [want.mjs](../../v2/card-game/want.mjs), [want-talk.mjs](../../v2/card-game/want-talk.mjs), [knowledge.mjs](../../v2/card-game/knowledge.mjs).                                                |
| Why did a person say this?                  | [AI.md](../../AI.md), [narrative.mjs](../../v2/card-game/narrative.mjs), [card_narrative.rs](../../v2/orchestrator-rust/src/card_narrative.rs) and its modules.                               |
| Why is dialogue or a selected card waiting? | [Dialogue beats](../../v2/docs/card-table/dialogue-beats.md); follow presentation and queued choices, not only legal actions.                                                                 |
| How does `/make` work?                      | [Card pack guide](../../v2/docs/card-packs.md), then [authoring-entry.mjs](../../v2/card-game/authoring-entry.mjs) and [card_authoring.rs](../../v2/orchestrator-rust/src/card_authoring.rs). |
| Which art reaches the client?               | [public-assets.mjs](../../v2/card-game/public-assets.mjs), media manifests and the asset builder, not manual Rust embedding.                                                                  |

## Keep these generated products separate

- `packs.json`: compiled selected card packs and bridges.
- `content.json`: injected content revision, identified by exact-byte SHA-256.
- `engine-vN.js`: immutable released replay rules from authored source.
- `narrator.js`: current scene/dialogue-context bundle; not a journal rules version.
- Media/public-asset outputs: served file inventory and hashes; Cargo builds its
  Rust asset embedding from the source list.

Follow imports before editing. The current game is `v2/card-game/`; classic packs,
older native-C world rules remain
for compatibility/history, not as an alternative place to implement new play.
