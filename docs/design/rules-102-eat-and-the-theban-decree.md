# Rules 102: Eat, and the guard who holds the decree

Owner design, 2026-11-04. Issue [#2284](https://github.com/cenetex/cosyworld/issues/2284). Data for the Theban gate is in
[Greek redesign](../../v2/docs/card-table/greek-redesign.md#the-theban-gate-greek-revision-20).

> **Pending the crafting and items design discussion (owner, 2026-11-04).**
> Not approved for building. The food-reset rule (eaten food returns to its
> home) is likely to change to crafting, for example Dione bakes bread from
> flour and water.

## Problem

Players did not see that the Theban City Gate was open while the Gate Guard
held the Burial Decree. The voices at the gate said "the Guard needs the
written order itself", while the gate stood open with the decree card in
view. The rule read backwards: a guard who holds the order that forbids the
burial was the one who let people out to bury.

## Rules

Two rules changes, and everything else is pack data.

1. **Eat** is a new fixed verb. A thing tagged `food` (`tags: ["food"]`) with
   a `home` can be eaten by whoever holds it. Eating it takes it from the
   eater and puts it back at its home at once, with no history, as a fresh
   one: Dione's bread goes back to the Theban Courtyard. Nothing is minted, so
   the world still holds one of it. Whatever it held drops where the eater
   stands. The context button reads **Eat** when the food is raised alone or
   with the eater's own card. Its caption is "Vale ate the Courtyard Bread."
2. **An eat quest.** An item want may carry `step: { verb: "eat", at? }`. It
   is met only when its avatar eats that food (at that place, when `at` is
   named), never by holding it. A pack resident may start with one (`want` in
   its pack data). A level quest may draw "eat" for a food target. A
   resident that holds a food one of its quests wants eaten eats it at once.
   Once its eat want is met it is content, then draws ordinary wants: it has
   joined the regular want system with no further rule.
3. **A live gate is read live.** A pack route marked `live` is open only
   while its condition holds. `gate_open`, and the resident guard's lift
   (`wayLifted`), now read the route as it stands, latched or live. Latching
   routes behave exactly as before.

No new condition kind is needed: "barred while the guard holds the decree"
is `{ "kind": "not", "condition": { "kind": "holding", "item":
"greek-decree", "actor": "greek-guard" } }` on a live route. A guard bars
his way only while he stands at his post (rules 100), so a guard knocked away
in a standoff does not bar it, as before.

## Versions and replay

Eat, the eat step and the live read are in modules of the shared bundle, so
they mint rules 102 on top of rules 101. Rules 101 and earlier stay
byte-identical and keep replaying their own journals. The upgrade to 102 runs
the Greek revision 20 save upgrade (below). The journal gains the `eat` verb;
older bundles never see it.

## Greek revision 20 save upgrade

A world saved at revision 19:

- forgets the latched `greek-gate>greek-battlefield` key, since that route
  is now live;
- gives the guard the decree, and Creon the writ, if each still lies
  untouched where it started (no history), so a world mid-way keeps what
  players did with them;
- leaves wants as they are: a guard who has already drawn wants keeps them.

## Tests

- Rules: Eat is offered only for a held food, sends it home and is met by an
  eat quest; holding is not enough; a resident eats when it holds the food it
  wants eaten; the gate bars while the guard holds the decree, opens when he
  trades it for the bread and bars again when he gets it back; the full
  play-through, bread to guard to decree to Creon to writ; the guard draws
  ordinary wants afterwards.
- Agreement: the browser rules and the rules 102 bundle commit the same
  worlds, and the journal replays.
