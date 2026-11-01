# Standoff endings

Owner rule, 2026-10-31: a threat lasts only while someone fights.

- Strike (`attack`) and Brace (`guard`) are the only plays that keep a
  standoff open. Any other play by either side ends it: Talk, Wait, Give,
  Trade, travel, a quest drop. The rules log "X steps back from Y. The
  standoff ends." and both sides get the usual three turns of peace.
- A Brace played while the opponent's Brace still stands is a mutual
  stand-down. A Brace stands from its play until that fighter's next play or
  a strike on them, which is the existing `guarding` flag, so the check is
  deterministic in local and shared play.
- Handing over the demanded item is a Give, so it ends the standoff as well
  as releasing the item.
- Resident challengers that want the item strike at once (as on main), so
  their old idle Wait no longer ends a resident threat before it starts.

This is a rules change (`engine` label). `perform()` wraps the play: it
reads the standoff before the play and closes it afterwards when the play
was not a Strike, or was a Brace against a standing Brace. The lander mints
the next shared rules version, and released bundles keep replaying their
journals unchanged.

The no-deadlock test in `test/card-combat.test.mjs` runs seeded games where
the player only ever Strikes or Braces during a standoff. Every standoff
closes within ten turns.

## Room lock

While a standoff is open, its room is locked (`roomLocked` in
`legalActions`). Nobody present can Move, Accompany, set a Course, Take, Drop
an item, Give, Trade, Ask or Cover. The threatened side may still Give the
demanded item to the challenger, which ends the standoff. Arrivals are allowed
and are then locked in. Bystanders keep Talk but cannot Strike. Residents stop
wandering because their moves are not legal. The hand shows only the people,
plus the demanded item for the threatened side. Talk, Wait and that Give are
the ways out.
