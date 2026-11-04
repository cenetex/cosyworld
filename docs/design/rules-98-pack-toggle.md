# Rules 98: switching a world pack off and on

Owner (2026-11-03/04): packs switch mid-world and "all avatars and items
from other worldpacks in the worldpack's locations are scattered"; all four
switch, the Shore too, one stays on; local worlds only; the attic stays.

- **Groups.** The hub's `switchable` names groups in a fixed order: shore
  (the pack `hub`: the hub's own places, residents and things), cottage,
  sea and hoppy. A pack in no group is always on. Hoppy Cat is reached
  only by the Greek ship (owner, 2026-11-04), so its group is
  `reachedBy: "sea"`: it sleeps while the Sea is off, and its button says
  "Reached by The Wine-Dark Sea".
- **Record.** `disabledPacks`, the groups off, sorted; absent when all are
  on, so a group added later is on in old saves.
- **Play.** `{ kind: "pack", pack: group, enable }`, logged as `pack`; no
  turn passes. Refused, with the button's reason, in shared worlds, in the
  player's fight, for the last group on, and for the shore before the first
  crossing.
- **Off.** Its packs sleep (`entityEnabled`), keeping their state. Players
  never sleep. Its things carried by people from elsewhere are set down
  where they stand, so they take no carry slot, and return there.
- **Ways out.** The `at` of each declared entry
  ([card packs](../../v2/docs/card-packs.md#entries)) that joins a pack still
  on, in group order; with none, the start of the first pack on (the hub's
  `start`, else the pack's `entry`). The hub's entries are its packs' hub
  entries from the other side. A pack entered only through a pack that is
  off stays on and is entered only from inside; no fallback link is made.
- **Scatter.** Players from elsewhere come out at the first way out.
  Everyone else, and every thing from elsewhere lying there or held by its
  people, is dealt round the ways out from a start drawn from the run seed
  and revision; one held by its person standing outside it is set down
  there. A sleeper wakes. A crossing signal in progress breaks once no
  player is left where it is made, as walking away breaks it (rules 99).
- **Fights** there or with its people end, with three turns of peace.
  **Quests** naming it go to the bottom of the stack, nothing redrawn. A
  sanctuary in it is forgotten, and a rest step there turns to an awake
  sanctuary or home (`restStep`). From rules 99 a quest to sleep at a
  sanctuary rebuilt this way takes the place of an ordinary quest for the
  same place, as `pushQuest` does (`mergeSanctuaryQuests`); setting one
  aside does the same. Level quests are never merged away.
- **Ships.** Its own ship lies still with its own crew, no course or
  summons.
  Another pack's ship at or bound for its docks puts in at home (rules 95).
- **On.** Its content returns as it was; scattered things stay put. A
  rescue whose place sleeps goes to the start of the first pack on.

Tests: `test/card-pack-toggle.test.mjs` and the seeded toggle fuzz in
`test/card-quest-loop-redirect.test.mjs`, including rules 96 and 97 accepting a
player in a pack switched off, which rules 98 refuses. Earlier released rules are
byte-identical and hash-pinned (`test/card-released-rules.test.mjs`).
