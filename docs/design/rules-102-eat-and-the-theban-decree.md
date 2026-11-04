# Rules 102: Eat, crafting, and the guard who wants a writ

Owner design, 2026-11-04. Issue [#2284](https://github.com/cenetex/cosyworld/issues/2284).
The item model is in [items and crafting](items-and-crafting.md); the Theban
data is in the
[Greek redesign](../../v2/docs/card-table/greek-redesign.md#the-theban-gate-greek-revision-20).

## Problem

Players did not see that the Theban City Gate was open while the Gate Guard
held the Burial Decree. The voices said "the Guard needs the written order
itself" with the gate open and the decree in view. The rule read backwards,
and the gate latched open for good.

## Rules changes

Only these are engine code; everything Greek is pack data (revision 20).

1. **Eat.** One fixed verb, `eat`. A thing tagged `food` or `drink` with a
   `home` is eaten or drunk by whoever holds it, alone or with a person
   present. The companion consents as to other social plays (`shareDecision`
   in `world.mjs`: awake, out of a fight, at peace, no grudge, and trust or a
   matching quest). It reads Eat or Drink by tag.
2. **Consumed things go home.** `consume` in `pack-items.mjs` rests a thing
   at its `home`, not its starting holder. One without `locked` is back at
   once; a `locked` (made) thing waits there used up, shown as the locked
   box.
3. **Crafting.** `locked: { by, consumes }`. On the play that gives the
   maker, or lays down at the thing's home, the last thing it consumes, with
   every one in the maker's hands or lying loose there and the maker at
   home, those are consumed and the made thing unlocks (`settleCrafting`).
   The box's reason reads "<maker> consumes <things>" (`sealedReason` in
   `cards.mjs`). Unlocking on a play follows "consuming is a choice"; the
   owner may reverse it.
4. **Eat quests.** A step `{ verb: "eat", with?, at? }` on an item want, met
   only by that meal; a companion's own "with" quest is met by the same
   meal. Level quests may draw it for a food. A pack resident may start with
   one. A resident eats what it holds at once when its quest wants it eaten,
   and leaves a meal it could only have somewhere it cannot go. Talk with
   someone who wants to eat a thing somewhere gives the player that quest.
5. **Live gates read live.** `gate_open` and the resident guard's lift read
   a `live` route as it stands (`packRouteOpen`). Latching routes are
   unchanged.
6. **A guarded card says so.** The card beyond a guarded way is locked, its
   reason reads "<guard> is guarding this card", and it gives no quest; Talk
   with the guard gives his.

No new condition kind: the gate is a live route open while the guard holds
Creon's writ (`holding`). A guard bars both ways, and only at his post, so
beating him in a standoff still gets you through (rules 100).

## Pack schema

- `tags: ["food" | "drink"]` need a `home`.
- `locked` needs a maker of the pack, a home, and one to three homed things.
- A thing may start in someone's hands and be homed elsewhere (`holder`
  plus `home`), unless it regrows, starts used up or is locked.
- A resident's `want` may carry the eat `step`.

## Versions and replay

These modules are in the shared bundle, so they mint rules 102 on rules
101; 101 and earlier stay byte-identical for replay. The journal gains the
`eat` verb (with `accepted` when shared). The Greek revision 20 upgrade only
forgets a shared world's latch on the gate, which is no longer a latching
route. Alpha local saves may be dropped.

## Tests

`test/card-thebes-bread.test.mjs`: baking, eating, the guard's chain
(bread, decree, writ), guarding after the trade, losing the writ, combat
past the guard, eat and drink quests with and without a companion and a
place, the provisions loop, both orders of the two routes, and the upgrade.
