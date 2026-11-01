# Cosmetic upgrades

Owner decisions, 2026-11-01 (#1873): a cosmetic upgrade is a one-way upgrade
to a traveler's portrait. It is per passkey and per traveler, and follows the
traveler into every world, like the level (#1846), but the item that earned
it stays behind. Signed-out local play is its own passkey; nothing carries
over on sign-in. RATi's scarf is the first upgrade.

Rules 81 keep the set in `actors[id].upgrades`, written and read by pack
data, so the next upgrade needs no rules change:

- `{"kind":"upgrade","upgrade":"scarf"}`, on a choice with `for`, adds it to
  the acting traveler.
- Rules 82: RATi's `forest-sew-scarf-*` choices leave the scarf in her
  cottage as an ordinary item. An `"on": "hold"` choice,
  `forest-wear-scarf-<id>`, commits after any play once the scarf's holder is
  its own traveler, by any route. It records the upgrade, sets
  `forest-scarf-<id>-worn` and retires the scarf; the scarf's `requires`
  then keep it out of play. Someone else's scarf upgrades nobody, so it joins
  wants and trades like the button. A scarf held from before rules 81 is tied
  on after its owner's next play, which fills the old gap.
- `{"kind":"upgraded","upgrade":"scarf","role":"actor"}` holds while the
  acting traveler has it. RATi's `forest-hide-button-*` meetings require
  `not` upgraded: no button quest and no second scarf.
- `join` adds `progress.upgrades` and never removes one. `reset` leaves the
  next holder none. A world imported from a local save drops them all.

Shared play: after each committed play the server keeps every seated
traveler's set for its holder (a gift can upgrade someone other than the
player) in `card_avatar_upgrades(user, actor, upgrade)`, and every
claim journals the holder's set as `progress.upgrades`, so replay needs no
table. Local play: `cosyworld.local.upgrades` in the browser; saving keeps a
local world's upgrades and a new or loaded local world wears them.
`avatarImage` in `v2/card-game/scarves.mjs` paints `<id>-scarf.png`; a world
from before rules 81 still shows it while its traveler holds their scarf.

Not covered: a traveler seated in another world gets a new upgrade there at
its next claim.
