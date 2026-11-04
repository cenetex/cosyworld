# Rules 97: switching a world pack off and on

Owner decision (2026-11-03): packs can be enabled and disabled "mid world
and all avatars and items from other worldpacks in the worldpack's
locations are scattered".

## The rule

- **Which packs.** The hub's `switchable` (in `v2/worlds/card-table.json`)
  names the packs a world may switch, with the names the Settings cards
  show: The Wine-Dark Sea (`greek-drama`, Thebes and Athens included), Hoppy
  Cat Universe (`hoppycat-archive`) and Cosy Cottage (`lonely-forest`). The
  Reflected Shore (the hub) and the packs that hang on it stay on: the Steam
  Clock (`badger-forest`, the shore's own bell crossing and Badger's home)
  and the Willows (`willows`, an island off the pond and the ship's lanes),
  until the owner makes the Willows a card. One switchable pack stays on.
- **The record.** `world.enabledPacks` is the sorted list of switchable
  packs that are on. Every world gets it with all of them, new or loaded
  (`installPacks`); the upgrade is idempotent. Saves still hold every pack's
  record, because a pack switched off keeps its state.
- **The play.** `{ kind: "pack", pack, enable }` through `play()`, journaled
  as a `pack` action with no turn passing, like choosing a quest. It is not
  a card in the hand; Settings plays it.
- **Off.** The pack goes dormant: `entityEnabled` is false for its places,
  people, things and ship, so they are unseen, unreachable and do not act,
  and they keep their state. Custody checks of saved state (`saved: true`)
  ignore the switch.
- **Scatter.** Everyone and everything from elsewhere in one of its places
  leaves it at once:
  - players' avatars go to the shore end of the pack's own crossing (the
    pond for the Sea and Hoppy Cat, the attic for Cosy Cottage);
  - everyone else, and every thing from elsewhere lying in its places or
    held by its people, is dealt round the shore places (that end, then the
    station, attic and pond), starting at a place drawn from the run seed
    and the revision (`runHash`), so they spread and every replay agrees;
  - a thing from elsewhere inside one of its things goes to whoever carries
    that thing, else round the shore;
  - a sleeper wakes.
- **Its things carried away** stay with their holder, dormant, and are back
  in that hand when the pack is on again.
- **Fights** in its places, or with its people, end at once, and the
  fighters keep the peace three turns (`closeStandoff`), as any standoff
  that ends without a winner.
- **Quests** naming its places, people or things (a quest's target or its
  step's places) are set aside, as a stalled want is (`setAsideWant`):
  they go to the bottom of the stack, so nothing is lost and they come back
  round when the pack is on again.
- **Ships.** Its own ship lies docked where it is, empty of riders, with no
  course or summons. Another pack's ship at, or bound for, one of its docks
  puts in at home and everyone aboard goes ashore (rules 95's stuck-ship
  rule): the Charybdis leaves the Hoppy Cat jetty for the Wine-Dark Harbor.
- **On.** Its dormant content returns as it was. Scattered people and things
  stay where they were scattered.
- **Shared worlds** keep every pack for now: the play is refused with the
  reason. Owner-only switching needs the host to check the owner; that is a
  later change.

Tests: `test/card-pack-toggle.test.mjs` (scatter, determinism and reload;
dormant content and its return; a carried thing; a fight and a quest; the
ship; the shore, the last pack and shared worlds refused; the released
rules 96 bundle accepts a player standing in a pack switched off, which
rules 97 refuses). Rules 93 to 96 are byte-identical and hash-pinned.
