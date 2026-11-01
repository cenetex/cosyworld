# Cosmetic upgrades

Owner decisions, 2026-11-01 (#1873):

- A cosmetic upgrade is a one-way upgrade to a traveler's portrait. It never
  reverts, in any world.
- Upgrades are per passkey and per traveler. Signed-out local play is its own
  passkey. Nothing earned locally carries over on sign-in.
- An upgrade follows the traveler into every world, like the level (#1846).
  The traveler does not carry the item that earned it into a new world.
- RATi's scarf is the first upgrade.

## Rules (81)

The upgrade set is `actors[id].upgrades`, a sorted list of ids. Pack data
adds to it and reads it, so the next upgrade needs no rules change:

- The effect `{"kind":"upgrade","upgrade":"scarf"}` on a choice with `for`
  adds the upgrade to the acting traveler. RATi's eight
  `forest-sew-scarf-*` choices use it.
- The condition `{"kind":"upgraded","upgrade":"scarf","role":"actor"}` holds
  while the acting traveler has it. RATi's eight `forest-hide-button-*`
  meetings require `not` upgraded, so an upgraded traveler gets no button
  quest and no second scarf.
- `join` takes `progress.upgrades` and adds them; it never removes one.
  `reset` gives the next holder a fresh traveler with none. A world imported
  from a local save drops every traveler's upgrades.

## Where the set lives

- Shared play: the server stores `card_avatar_upgrades(user, actor,
  upgrade)`. After each committed play it keeps the acting traveler's
  upgrades for the seat's holder. Every claim journals the holder's set as
  `progress.upgrades`, so replay needs no table. Rules 80 and earlier never
  receive it.
- Local play: `cosyworld.local.upgrades` in the browser
  (`v2/card-game/scarves.mjs`). Saving a local world keeps its travelers'
  upgrades; a new or loaded local world wears them.

## Portrait

`avatarImage` in `scarves.mjs` paints the first upgrade with a portrait
(`scarf`: `assets/shared/characters/<id>-scarf.png`). A world from before
rules 81 still shows the scarf while its traveler holds their own scarf.

## Not covered

- A traveler already seated in another world gets a new upgrade there at
  its next claim, not at once.
- Scarves sewn before rules 81 are not back-filled into the passkey set.
