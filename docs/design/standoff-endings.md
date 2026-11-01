# Standoff endings

Owner rule, 2026-11-01, replacing the 2026-10-31 rule that any play but
Strike or Brace ended a standoff: talking does not release a threat. A
threat stays in force until both participants, the threatener and the
threatened, have made a play other than Strike or Brace.

- Each standoff records `steppedBack` for both fighters. A fighter's play
  sets it: true for any play but Strike (`attack`) or Brace (`guard`), false
  for those two. The standoff ends when both are true, and the rules log
  "X and Y both stand down. The standoff ends." Both sides then get the usual
  three turns of peace.
- One side's Talk or Wait alone leaves the threat and the room lock in force.
  A Strike or Brace never counts, so two standing Braces no longer end it
  (the old mutual stand-down is gone), and a fighter who stood down and then
  strikes is back in the fight.
- Bystanders' plays do not count.
- Releasing the disputed item still settles a standoff at once (the release
  rule from #1073). Handing over the demanded item is therefore still an
  immediate way out, as the 2026-10-31 note recorded. Whether it should
  instead count only as the giver's stand-down is open for the owner.
- Defeat at zero resolve, a resident challenger setting the item aside, and
  the fighters being parted still end a standoff as before.

Residents answer in kind. A resident strikes while the other side is still in
the fight (its latest play was a Strike or Brace, or it has not yet played),
once blows have landed or when it is the challenger that wants the item.
Once the other side stands down, the resident stands down too, so a
standoff between a player and a resident ends in the round the player
stands down. A threatened resident first answers as before: Talk if it
outranks the challenger, otherwise Brace.

This is a rules change (`engine` label). `perform()` wraps the play: it
reads the standoff before the play and records the fighter's stance
afterwards. Old saves with an open standoff gain `steppedBack` with nobody
stood down. Released bundles keep replaying their journals unchanged.

Two seeded long runs in `test/card-combat.test.mjs` check that standoffs
close: one where the player mixes fighting with any other play, and one
where the player always stands down at once. Every standoff closes within ten
turns. A player who only ever Braces keeps a threat open by choice.

## Room lock

While a standoff is open, its room is locked (`roomLocked` in
`legalActions`). Nobody present can Move, Accompany, set a Course, Take, Drop
an item, Give, Trade, Ask or Cover. The threatened side may still Give the
demanded item to the challenger, which ends the standoff. Arrivals are allowed
and are then locked in. Bystanders keep Talk but cannot Strike. Residents stop
wandering because their moves are not legal. The hand shows only the people,
plus the demanded item for the threatened side. The ways out are both sides
standing down, that Give, or a defeat.
