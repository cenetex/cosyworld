# Saved quest reward cards

The first rules change saves completed player quests as `actor.questRewards`.
Each receipt has its actor, completion event ID, turn, original quest, XP,
earned level when present, and `paid: true`. Quest advancement, XP, levels,
sanctuary dreams and milestone timing keep their current behaviour in this PR.
Residents keep automatic rewards and receive no receipt.

An owner's `claim` action removes one paid receipt. It changes the revision
and logs the collection while keeping the same turn, rest and battle state.
The action key includes the actor and completion event ID. Legal action lookup
and shared actor checks establish ownership. A stale revision or a repeated
claim fails the usual current-action check.

Receipts remain until collected. Their compact records share the existing
quest fields and contain no art or profile text. IDs are ordered, unique per
actor, and bounded by the world's event count. Their count is bounded by that
same count. A large uncollected hand grows the save; a future fixed capacity
would need a gameplay rule that preserves every earned reward.

Old saves have an empty receipt list. Their already awarded XP and levels
remain intact. Earlier completions are kept as history; receipt creation starts
with the new rules. Released engine bundles keep their recorded behaviour.

Next, the browser should draw checked cards from these receipts and collect
them through the shared action. A later rules PR can save new rewards with
`paid: false` and pay them on claim. Those claims will run milestone checks at
payment time. The deed still advances its quest and changes the world; the
sanctuary rest still completes the final level step. That activation needs
tests for delayed level rewards, old paid receipts, multiple pending steps,
and further sanctuary rests before collection.

Validation covers actual quest plays, save/reload, recurrence, final level
steps, owner and revision checks, repeated claims, shared engine agreement,
and replay. Claiming a paid receipt preserves XP, level and NPC state.

## Payment on collection: rules 110

New player deeds save `paid: false`. The quest advances and the world changes
at once; XP and the final earned level wait on the checked card. Residents
keep automatic rewards. Existing `paid: true` cards remain acknowledgements.

Claim removes its receipt first, adds its recorded XP, and raises the level
to the greater of the current and earned level. A level rise clears the old
glimpse and checks the new level's thresholds afresh. Other claims check the
actual XP crossed. Thus step and ordinary rewards can be collected in any
order around the final reward.

An unpaid final reward blocks another level quest, milestone pointer, and
duplicate glimpse for that level. Sanctuary Rest still finishes the deed,
rest, and its eligible dream. Collection uses the existing zero-turn play
and shared journal. Rules 109 keeps its released bytes and paid behaviour.
