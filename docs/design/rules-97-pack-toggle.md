# Rules 97: switching a world pack off and on

Owner decisions (2026-11-03, 2026-11-04): packs switch "mid world and all
avatars and items from other worldpacks in the worldpack's locations are
scattered"; all four packs switch, the Shore too, and one stays on; local
worlds only; the attic stays where it is.

- **Which packs.** The hub's `switchable` (`v2/worlds/card-table.json`), in
  its fixed order: The Reflected Shore (`reflected-shore`, the hub's own
  places, residents and things), Cosy Cottage (`lonely-forest`), The
  Wine-Dark Sea (`greek-drama`) and Hoppy Cat Universe (`hoppycat-archive`).
  The Steam Clock and the Willows have no switch.
- **Entries.** Each pack's declared entries (bridge `entries`, gathered into
  the hub as `packEntries`; the hub's own `entries`) name how it is entered,
  by an existing link with that link's own condition
  ([card packs](../../v2/docs/card-packs.md#entries)). A pack switched on
  brings its entries back; switched off, its places sleep, so no entry leads
  in or out.
- **The record.** `world.enabledPacks`, sorted. Every world gets it with all
  on as it is created or loaded (`installPacks`). New worlds start with
  every pack on, so starts are unchanged.
- **The play.** `{ kind: "pack", pack, enable }` through `play()`, logged as a
  `pack` action; no turn passes. Settings plays it.
- **Off.** The pack sleeps: `entityEnabled` is false for its places, people,
  things and ship, which keep their state. Players' avatars never sleep.
- **Landing.** Arrivals and scattered things go to the awake entry places of
  the first pack on, in the fixed order: the Shore's pond, attic and station
  while it is on, else the cottage, else the harbour and Piraeus, else the
  Signal Jetty. A rescue whose place sleeps goes to the first of them.
- **A pack entered only through a pack switched off** stays on. It is entered
  only from inside until that pack returns, and its entry places still take
  arrivals. No fallback link is made: Hoppy Cat with the Sea off keeps its
  jetty, and the Willows and the Steam Clock with the Shore off keep theirs.
- **Scatter.** From its places, players' avatars come out where its first
  awake entry comes from (the attic for Cosy Cottage, the pond for the Sea),
  else at the first landing place. Everyone else, and every thing from
  elsewhere lying there or held by its people, is dealt round the landing
  places from a start drawn from the run seed and revision (`runHash`). A
  thing inside one of its things goes to whoever carries that thing. A
  sleeper wakes.
- **Its things carried away** stay with their holder, unseen, until it is on.
- **Fights** in its places or with its people end; the fighters keep the
  peace three turns (`closeStandoff`).
- **Quests** naming its places, people or things are set aside, as a stalled
  want is (`setAsideWant`).
- **Ships.** Its own ship lies docked where it is, with no riders, course or
  summons. Another pack's ship at or bound for one of its docks puts in at
  home with everyone ashore (rules 95's stuck-ship rule); lanes to sleeping
  docks close.
- **On.** Its content returns as it was; scattered things stay put.
- **Shared worlds** keep every pack for now; the play is refused with that
  reason. Creator-only switching needs a host check later.

Tests: `test/card-pack-toggle.test.mjs`, including the released rules 96
bundle accepting a player in a pack switched off, which rules 97 refuses.
Rules 93 to 96 are byte-identical and hash-pinned
(`test/card-released-rules.test.mjs`).
