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

Next: the room lock. While a standoff is open, nobody present leaves or
changes items. It ships separately with its fixture updates.
