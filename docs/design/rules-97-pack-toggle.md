# Rules 97: switching a world pack off and on

Owner decisions (2026-11-03, 2026-11-04): packs switch mid-world, and
"all avatars and items from other worldpacks in the worldpack's locations
are scattered"; all four packs switch, the Shore too, and one stays on;
local worlds only; the attic stays where it is.

- **Groups.** The hub's `switchable` (`v2/worlds/card-table.json`) names the
  groups in a fixed order: shore (the pack `hub`: the hub's own places,
  residents and things), cottage (`lonely-forest`), sea (`greek-drama`) and
  hoppy (`hoppycat-archive`). A pack in no group is always on. The Cottage
  and Badger can later share a group with no id change.
- **The record.** `disabledPacks`: the groups off, sorted; absent when all
  are on, so a group added later is on in every old save.
- **The play.** `{ kind: "pack", pack: group, enable }` through `play()`,
  logged as a `pack` action; no turn passes. It is refused, with the reason
  for the button, in shared worlds, during the player's fight, for the last
  group on, and for the shore before the first crossing.
- **Off.** Its packs sleep: `entityEnabled` is false for their places,
  people, things and ship, which keep their state. Players never sleep.
- **Entries.** Each pack's declared entries (bridge `entries`, gathered as
  `hub.packEntries`; [card packs](../../v2/docs/card-packs.md#entries)) say
  where its travelers come out: the `at` of each entry that joins a pack
  still on, in group order. With none, the start of the first pack on (the
  hub's `start`, else the pack's `entry`). The hub's entries are its packs'
  hub entries from the other side. So: the attic for the Cottage; the pond
  and the jetty for the Sea; the pond and Piraeus for Hoppy Cat; the
  cottage, harbour, tea garden, clearing and landing for the shore.
- **Entered only through a pack that is off,** a pack stays on and is
  entered only from inside until that pack returns. No fallback link is
  made.
- **Scatter.** Its things carried by people from elsewhere are set down
  where they stand, to sleep there. Players from elsewhere come out at the
  first way out; everyone else, and every thing from elsewhere lying there
  or held by its people, is dealt round the ways out from a start drawn
  from the run seed and revision. A thing from elsewhere held by one of its
  people standing outside it is set down there. A sleeper wakes.
- **Fights** in its places or with its people end; the fighters keep the
  peace three turns.
- **Quests** naming its places, people or things go to the bottom of the
  stack as they are, with nothing redrawn. A sanctuary in it is forgotten,
  and a rest step there turns to an awake sanctuary or home.
- **Ships.** Its own ship lies where it is with its own crew, no course or
  summons. Another pack's ship at or bound for one of its docks puts in at
  home with everyone ashore (rules 95); lanes to sleeping docks close.
- **On.** Its content returns as it was; scattered things stay put. A
  rescue whose place sleeps goes to the start of the first pack on.

Tests: `test/card-pack-toggle.test.mjs`, including rules 96 accepting a
player in a pack switched off, which rules 97 refuses. Rules 93 to 96 are
byte-identical and hash-pinned (`test/card-released-rules.test.mjs`).
