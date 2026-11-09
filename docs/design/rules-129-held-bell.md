# Rules 129: holding the Bell opens the Forest Clearing

The Steam Clock crossing is pack data. It used to open for three turns after
two rings of the uncovered Bell at Black pond. A sounding bell at either
shore opened the way back.

## Change

The crossing opens only while this traveler holds the Bell: the one card in
their hand (`heldItem` in `held-item.mjs`). Carrying the Bell beside another
held card, leaving it on the ground, or letting someone else hold it does
not qualify. From the clearing, the way back uses the same personal check.

While the way is shut and the traveler is standing at its start, the far
card stays in the hand as the existing locked box. Its quest is to hold the
Bell. No new card widget is added. A ring does not open either shore. The
Steam Clock's own bell still wakes Badger.

`{ "kind": "held", "item" }` is the condition. A crossing may name `sealed`
with an item quest and a reason so the locked box can offer that quest.

## Save upgrade

Badger Forest revision 2. `upgradeBadgerBellSave` drops the old signal's
`phase` and `until` and keeps `discovered`. The upgrade is rules code, so
this branch mints rules 129. Rules 128 and earlier keep the two-ring signal.

## Related work

[#2534](https://github.com/cenetex/cosyworld/pull/2534) changes explicit
stowing on a later rules bundle. This gate calls `heldItem`, so a stowed
hand stays shut when that lands. [#2536](https://github.com/cenetex/cosyworld/pull/2536)
stacks locked boxes with location items and should follow this rules change
rather than invent a second preview. No open or recent closed pull request
removes Ring or Cover.
