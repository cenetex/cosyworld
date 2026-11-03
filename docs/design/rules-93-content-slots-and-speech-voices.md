# Rules 93: new places join saved worlds, and speech keeps to its voices

Status: Rules 93 (2026-11-02). Unblocks the Piraeus and Trojan landing roads
(#2049) and closes the post-merge review of rules 92 (#2081).

## Places added to a pack

Every place has a memory slot in a saved world, and `validMemories` refuses a
world whose slots differ from the current profiles. `reconcileContent`
(`v2/card-game/legacy-saves.mjs`) already gave a new item its slot. A new
place, or a new ship dock, had none, so a local save asked for a fresh start.
The server moves every shared world onto the current content when it loads
(`full_store.rs` journals a `repack`), so a pack that gained a place asked
every shared world for a fresh start too.

From rules 93, `reconcileContent` gives every location profile the save lacks
an empty memory. A rules 92 world upgrades onto rules 93 with the current
content in one journaled `upgrade`, and later content repacks under rules 93.

Audit of the other per-entity slots a save keeps:

- Crossings, including a new dock's ship crossing, and transports were already
  filled in by `installPacks`.
- Lanes, routes, topics and items need no new slot or were already filled.
- A resident added to a pack that a save already has mounted still has no
  actor record. That stays deliberate: a save missing a resident is refused,
  and a new resident joins through its pack's save upgrade, as the household
  witness did (`upgradeGreekHomecomingSave`).

## Speech keeps to the play's voices

Rules 92 let a shared `speech` op hold one to four lines from any present
speaker, and the same speaker more than once. Only the server builds speech
ops, from the voices the narrator named, so this was not reachable. From
rules 93 the rules check it themselves. `speechOccasions` moved from
`narrative.mjs` into `speech-occasions.mjs`, in the rules bundle; the speech
op asks it for the committed play's voices; the room may always caption. A
line from any other voice, or a second line from one voice, is refused with
"Each voice the play named speaks once." A threat's target still speaks
alone. The server serializes a play and its speech, so the op
reads the world the play left.

`speech.json` now reaches the rules as content, so the content revision
changes and every shared world repacks once.

Replay: journals before rules 93 replay on their own bundles, unchanged. The
rules 92 hash is pinned in `test/card-released-rules.test.mjs`.
