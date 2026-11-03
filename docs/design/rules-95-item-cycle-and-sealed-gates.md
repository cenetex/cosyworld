# Rules 95: things used up and coming back, and sealed gates

Status: Rules 95 (2026-11-03). Owner-approved generic item mechanics for the
Thebes provisions loop and burial supplies, the Hoppy Cat scatter and the
Willows kit (#1626). Prior design: [recipes and the item
economy](../../v2/docs/card-table/recipes-and-item-economy.md) (#1748), whose
combine card this replaces with a repeating give. Pack fields and examples
are in [card packs](../../v2/docs/card-packs.md#things-used-up-and-coming-back-rules-95).

## Decisions

- **One record per thing.** Nothing is minted. A used-up thing keeps its id;
  regrowth and drops only bring that record back. Uniqueness holds by
  construction: a thing comes back only from the used-up list.
- **Used up** (`world.usedUp`, sorted ids). `retire_item` now uses a thing
  up. The thing waits at its authored holder with no history, inactive, and
  item conditions ignore it. `useUp` (`item-use.mjs`) is the only way in: it
  clears grievance `item` links (rules 90), keepsake attachments and standoff
  stakes, so a regrown thing cannot repair an old incident.
- **Repeating set give.** An `on: "give"` choice with `repeats: true` and one
  `drop_item` fires again whenever that output is used up. The set is every
  `holding role: actor` slot, and a slot may be an `any` of alternatives;
  giving any item of the set fires it, and an alternative not held stays
  where it is. No new verb.
- **Receipts for a repeating give.** Choices fire once because a receipt
  blocks them (`choiceFeasible`). Rules 95 extends the model for `repeats`
  only: the receipt does not block, and each firing replaces it with its own
  turn, so the receipt is the latest firing. This keeps replay exact
  because a repeating give may not `choose` (the pack check refuses it):
  its `set_flag` effects write the same value at every firing, so validation
  derives the same flags from the latest receipt as from all of them. The
  one-choice-per-turn guard still applies, and the output being used up is
  the gate between firings, so a world never holds two outputs.
- **Voyages spend cargo.** A `spends` lane uses up its opening cargo on
  arrival (`sailTransports` now reports the lane's `from`). Only homed things
  are spent. The return voyage leaves loose homed things at the quay it
  leaves. A plain lane, such as a free home leg, spends nothing.
- **A stuck ship goes home (owner decision).** A ship with anyone aboard
  answers no call, so a rider who waits aboard for a shut cargo lane would
  hold it for ever. At the end of a round, a ship lying at a dock with
  someone aboard, idle for `IDLE_ROUNDS` (nobody set a course), whose every
  cargo lane from that dock is shut, puts in at its home port, its authored
  `at`, and everyone aboard, resident or player, goes ashore there. Things
  aboard stay aboard. A resident put ashore sets that pursuit aside, as a
  stalled want is. The empty ship then answers the next call. It replaces the
  idle sail only at such a dock, so it is as deterministic as the idle rule.
  A save from before rules 95 with a ship already stuck sends it home on load.
- **Regrowth.** `home` plus `regrow: dawn | dusk | rest`. Rest is any long
  rest ending this round. A thing regrows only while its home is active and
  its own `requires` hold; otherwise it waits.
- **Dawn safeguard.** A homed thing lying unheld away from both home and its
  starting holder is noted in `world.astray` at one dawn and goes home if it
  still lies there at the next, so a cloth laid on a grave for a rite is not
  swept away overnight. Kit things are exempt: their job is to lie abroad.
- **Absent holders, held.** Taking a thing from an absent traveler's hands
  conflicts with "no absence penalties", so it is off by default and pending
  the owner's decision. An item marked `absentReturn: true` opts in: at dawn
  it goes home from a human avatar not in `presentActors`, which the shared
  host sets per journaled request, so replay agrees. Dropping the rule is
  deleting that field and one branch of `stray` in `pack-items.mjs`.
- **Kits.** When every kit thing lies at home, the kit's event scatters them
  to active listed places in any world, one per place until all have one.
  The pick is FNV-1a over the run seed, kit, scatter count, turn and thing
  (`runHash`). `world.scatters` counts each kit's scatters. This lifts the
  `hide_item` limit, which sends every thing hidden by one choice to one spot.
- **Sealed gates.** A route may declare `sealed: { reason, quest }`. While
  shut, its far side is a sealed card; the `gate` play gives the story quest
  without passing a turn, as `focus` does. A story quest may now carry a
  `give` step. The reason shows in the context button, never on the card.
- **Makers.** A resident whose want is a repeating give's output speaks the
  set in Talk and never takes the output for itself.

## Order in a round

After `sailTransports`: spend cargo and the return quay. After
`wakeSleepers`: regrowth, then the dawn safeguard, then kits, each in sorted
id order.

## Saves and replay

Bundles up to v94 are unchanged and replay their own journals. The fold runs
in `installPacks` (`installItemCycle`): a save without `usedUp` takes one,
and a thing that now `startsUsed` and still lies untouched where it starts
leaves play. `reconcileContent` keeps used-up things at their current
authored holder and starts newly added `startsUsed` things used up.

## Softlock proof in the pack check

`pack-items-schema.mjs` checks that a thing used up by one choice and needed
by another choice, a route, a lane or a `stayUntil` renews (regrows at home,
or is made by a repeating give from things that renew); that a repeating
give's inputs and a spending lane's cargo renew; and that a spending lane is
one-way with a free lane back.

## Tests

`test/card-item-cycle.test.mjs` (primitives, uniqueness over three laps,
absent holders, spending, repeat only after use-up, scatter determinism,
sealed gates) and `test/card-item-cycle-agreement.test.mjs` (the hosted
bundle and the browser rules commit the same worlds through the cycle).
