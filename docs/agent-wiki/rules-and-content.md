# Rules, content and replay

[Wiki home](README.md) · [Card pack guide](../../v2/docs/card-packs.md) ·
[Shared-world guide](../../v2/docs/card-table/shared-worlds.md)

## Content-first change recipe

1. Read [content instructions](../../v2/content/AGENTS.md), the selected pack in
   [card-table.json](../../v2/worlds/card-table.json), its authored `card-world.json`
   and its shore bridge. Prefer existing primitives over a new special verb.
2. Locate stable IDs, initial custody, homes, quest evidence and entry conditions.
   A fresh-world starting holder is not permission to confiscate an item in a save.
3. Write tests for the actual route, prerequisites, refusals, repeat/reload behavior
   and existing saves. Include both source and compiled behavior where required.
4. Run the owning compiler/generators. Inspect their diff for unrelated churn.
   Commit outputs with source; do not manually edit generated pack JSON.
5. Confirm mounting and public assets separately. A file existing in the repository
   does not prove the current client can reach it.

A new resident in an already mounted pack needs a deliberate revision/migration
that creates its saved actor state; adding catalog data alone is not enough. Read
[legacy-saves.mjs](../../v2/card-game/legacy-saves.mjs) and the closest migration
tests. Retire persisted places deliberately rather than simply deleting their IDs.

## Rule change recipe

1. Identify the shared import graph and affected state shape. Use deterministic
   inputs; the bounded interpreter is not a place for network, clocks or filesystem.
2. Plan migrations and rejection behavior before altering persisted fields. Preserve
   old IDs, commands, released engine bytes and content hashes.
3. Read the [engine policy](../../.github/AGENT.md#shared-rules-engine-changes).
   Shared graph changes need its design note/label and appropriate authoritative tests.
4. Rebase on actual main, then run `npm run v2:card:shared:next` as documented.
   It claims the next available version when rebuilt rules differ from main,
   and restores recorded bundles. Do not resolve
   collisions by overwriting a released engine or copying another branch's wiring.
5. Run generated freshness, source/compiled agreement, save upgrade, and journal
   replay checks at the Rust/QuickJS boundary. Snapshot-only tests are insufficient.
6. Regenerate again after a later main change where needed. A reserved version in a
   draft PR is not a permanent allocation.

Feature PRs do not bump the package release version. Follow current release policy
if an older script message or historical design note says otherwise.

## Data that replay needs

The shared card store is not the classic journal. Inspect
[full_store.rs](../../v2/orchestrator-rust/src/card_shared/full_store.rs) and
[content.rs](../../v2/orchestrator-rust/src/card_shared/content.rs):

- `card_full_log` stores commands with original sequence and time values. Sequence
  allocation is global, so gaps between one world's events are expected.
- `card_full_checkpoints` accelerates loading; it is not a replacement for history.
- `card_full_packs` retains exact content revisions. A `repack` event records change;
  using today's pack content to replay yesterday's engine is not equivalent.
- Plays, scenes, account bindings and queues have their own state. A world snapshot
  is not a complete service backup or proof of idempotency.
- Journal rows also have non-replay readers. Inspect them before considering retention.

## State and presentation checks

Check custody, consent, source events and routes in the rules first, then verify
that local and shared presentation expose the same result. Assert both success and
refusal; preserve state on failed actions. Test late or repeated callbacks and
rejoining where the change touches asynchronous work.

Keep private memories and unprojected world snapshots server-side. Use the existing
per-viewer projection rather than returning the full world to every client.
For a new field or journal operation, examine upgrade, join, leave, restart and
checkpoint-free replay, not only a fresh single-player save.
