# Rules 97: switching a world pack off and on

Owner decision (2026-11-03): packs can be enabled and disabled "mid world
and all avatars and items from other worldpacks in the worldpack's
locations are scattered".

- **Which packs.** The hub's `switchable` (`v2/worlds/card-table.json`) names
  them with their card names: The Wine-Dark Sea (`greek-drama`, Thebes and
  Athens included), Hoppy Cat Universe (`hoppycat-archive`) and Cosy Cottage
  (`lonely-forest`). The Reflected Shore (the hub), the Steam Clock
  (`badger-forest`, the shore's bell crossing) and the Willows (`willows`)
  stay on. One switchable pack stays on.
- **The record.** `world.enabledPacks`, sorted. Every world gets it with all
  on as it is created or loaded (`installPacks`), idempotently. Saves keep
  every pack's record, because a pack switched off keeps its state.
- **The play.** `{ kind: "pack", pack, enable }` through `play()`, logged as a
  `pack` action; no turn passes. Settings plays it; it is not a hand card.
- **Off.** The pack sleeps: `entityEnabled` is false for its places, people,
  things and ship, which keep their state. Saved-custody checks ignore it.
- **Scatter.** From its places, players' avatars go to the shore end of the
  pack's own crossing (the pond, or the attic for Cosy Cottage). Everyone
  else, and every thing from elsewhere lying there or held by its people,
  is dealt round that place and the station, attic and pond, from a start
  drawn from the run seed and revision (`runHash`). A thing inside one of its
  things goes to whoever carries that thing. A sleeper wakes.
- **Its things carried away** stay with their holder, unseen, until it is on.
- **Fights** in its places or with its people end; the fighters keep the
  peace three turns (`closeStandoff`).
- **Quests** naming its places, people or things are set aside, as a stalled
  want is (`setAsideWant`): to the bottom of the stack, not lost.
- **Ships.** Its own ship lies docked where it is, with no riders, course or
  summons. Another pack's ship at or bound for one of its docks puts in at
  home with everyone ashore (rules 95's stuck-ship rule).
- **On.** Its content returns as it was; scattered things stay put.
- **Shared worlds** keep every pack for now; the play is refused with that
  reason. Owner-only switching needs a host check later.

Tests: `test/card-pack-toggle.test.mjs`, including the released rules 96
bundle accepting a player in a pack switched off, which rules 97 refuses.
Rules 93 to 96 are byte-identical and hash-pinned.
