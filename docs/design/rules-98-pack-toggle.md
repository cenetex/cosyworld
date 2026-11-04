# Rules 98: switching a world pack off and on

Owner (2026-11-03/04): packs switch mid-world and "all avatars and items
from other worldpacks in the worldpack's locations are scattered"; all four
switch, the Shore too, one stays on; local worlds only; the attic stays.

- **Groups.** The hub's `switchable` names groups in a fixed order: shore
  (the pack `hub`: the hub's own places, residents and things), cottage,
  sea and hoppy. A pack in no group is always on.
- **Record.** `disabledPacks`, the groups off, sorted; absent when all are
  on, so a group added later is on in old saves.
- **Play.** `{ kind: "pack", pack: group, enable }`, logged as `pack`; no
  turn passes. Refused, with the button's reason, in shared worlds, in the
  player's fight, for the last group on, and for the shore before the first
  crossing.
- **Off.** Its packs sleep (`entityEnabled`), keeping their state. Players
  never sleep; its things they carry stay with them, unseen.
- **Ways out.** The `at` of each declared entry
  ([card packs](../../v2/docs/card-packs.md#entries)) that joins a pack still
  on, in group order; with none, the start of the first pack on (the hub's
  `start`, else the pack's `entry`). The hub's entries are its packs' hub
  entries from the other side. A pack entered only through a pack that is
  off stays on and is entered only from inside; no fallback link is made.
- **Scatter.** Players from elsewhere come out at the first way out.
  Everyone else, and every thing from elsewhere lying there or held by its
  people, is dealt round the ways out from a start drawn from the run seed
  and revision. A sleeper wakes.
- **Fights** there or with its people end, with three turns of peace.
  **Quests** naming it go to the bottom of the stack, nothing redrawn.
- **Ships.** Its own ship lies docked, empty of course and summons.
  Another pack's ship at or bound for its docks puts in at home (rules 95).
- **On.** Its content returns as it was; scattered things stay put.

Tests: `test/card-pack-toggle.test.mjs`, including rules 96 accepting a
player in a pack switched off, which rules 98 refuses. Earlier released rules are
byte-identical and hash-pinned (`test/card-released-rules.test.mjs`).
