# Standoff endings: room battles

Owner design, 2026-11-01 (rules 84), replacing two earlier rules: the
2026-10-31 rule that any play but Strike or Brace ended a standoff, and the
rule that it lasted until both participants had stood down.

## A battle holds the room

A Threaten starts a battle for its whole room. Every avatar present is a
combatant, players and residents alike, and so is anyone who arrives while it
is open. There are no bystanders and one battle per room. Two avatars are
left out until humans fight in shared play (#1511): a human other than the
challenger or the threatened one in a shared world, and a pack avatar with
`standoffs: false`.

Each combatant has four resolve. The rules store no sides: the battle keeps
the challenger, the threatened avatar and the disputed item, and every
combatant's resolve, brace (`guarding`), whether it has struck, and whether
it has played since the last Strike (`steppedBack`). The combatants are the
keys of `resolve`, in the order they joined. `covering` maps a guard to the
combatant it guards, and `hitBy` maps a combatant to whoever last struck it
since its own last play. A battle carried over from rules 83 lacks those two
maps until they are first needed.

## Plays by selection

- Yourself alone: **Brace** (rules `guard`, no target). The next hit on you
  loses one damage, with a minimum of one, until your next play.
- Yourself and another combatant: **Guard** (rules `intercept`). Strikes
  aimed at that combatant hit you instead until your next play. The hit
  rolls against you and uses your brace; the guarded combatant keeps its own.
  The attack event gives `targetId` as the guard and `coveredId` as the one
  aimed at.
- Another combatant alone: **Strike** (rules `attack`), with the tier damage
  of [combat by tier](combat-by-tier.md). On a battle's avatar card, Talk
  becomes Strike.
- This place: **Wait**.

Anyone may Strike or Guard anyone, including whoever threatened them. Nobody
in the room may Talk, Threaten, move, accompany, set a course, take, drop an
item, give, trade, ask or cover. The threatened avatar may still hand the
demanded item to the challenger. `matchingActions` maps a selection to these
plays: a selection that names the actor matches the play that names it too,
so yourself plus Pip is Guard in battle and Threaten outside one.

## Endings

- **A round without a Strike.** The battle ends once every combatant in the
  room has played since the last Strike and none of those plays was a
  Strike. Brace, Guard and Wait do not keep it going; any Strike starts the
  round again for everyone. The rules log "Nobody strikes for a whole round.
  The battle ends."
- **Arrivals** join with four resolve and must play before the round can
  complete. They join at the next play in the room, before it is performed,
  and at the end of each world round.
- **The item.** Handing over or otherwise releasing the disputed item ends
  the battle at once, as does a resident challenger setting it aside before
  any blow.
- **Defeat.** At zero resolve the loser drops the disputed item (or an item
  the winner needs) and retreats, or is sent home on a third defeat, as
  before. It leaves the battle with three turns of peace. The battle goes on
  if two combatants remain and the disputed item was not dropped.

Every combatant gets three turns of peace when a battle ends.

## Residents

Residents answer plays, not sides:

1. Strike whoever struck them since their own last play, or a combatant who
   holds what they want. A human holder who has played since the last
   Strike, without striking, is let be, so a player can still wait a
   resident's threat out; a resident holder is pressed until it gives way.
2. Brace instead when their resolve is one and someone struck them; with
   only a holder to press, wait.
3. Guard a combatant they trust who is being struck.
4. Otherwise wait.

The threatened resident's first answer is no longer Talk or Brace by tier:
with nobody striking it, it waits.

## Replay

This is rules 84. Rules 83 and every earlier bundle stay pinned, so their
journals replay their own standoffs; the recorded upgrade moves a world onto
rules 84 with its open standoff as a two-combatant battle.
`combat_tests.rs` replays a rules 83 threat through the upgrade without
checkpoints, then checks that rules 84 in the C host refuses Talk and ends
the battle after a round of Brace and waits. `test/card-combat.test.mjs`
covers the selection mapping, the Guard redirect with brace and tier damage,
the round, arrivals, the item, a three-way defeat and the resident policy.
