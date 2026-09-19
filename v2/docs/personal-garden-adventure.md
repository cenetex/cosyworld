# A path for Rati’s next guest

The first adventure gives Rati a concrete need: rain has covered the garden path, and her next guest needs safe footing. The story panel shows that need and the current next step. In the garden, a small scene reveals stepping stones as the shared progress clock fills.

## Play the adventure

1. Begin a shared-world tale at the cottage.
2. Choose Notice with a nearby resident, then follow the garden lead.
3. Choose a garden approach from the cards in your hand. Inspection gives baseline progress and a chance at extra progress. Clearing the drain gives steady progress. Helping lift stones becomes available alongside another traveler.
4. Read the outcome. Your first contribution leaves a marked stone and an attributed record for Rati. Other travelers share the path's progress; each traveler earns their own record.
5. Follow the invitation toward Mara Wick, or return later using the saved next step in the Journal. Core-only worlds use their own riverside invitation.

Each choice submits its exact current offer. The server checks the selected cards, strategy, target, costs, and current availability. A stale choice falls back to a currently supported choice in the browser; the player still presses Play.

## Saved progress

The garden scene reads the existing shared clock. The personal memory reads the first-tale trace. Rati's recognition reads a separate durable claim created with her attributed trace event. Her reply context includes that record when she speaks with the contributing traveler, including after reload. Existing players retain their earlier story progress. The added presentation fields are optional, and the four affected compositions accept their previous bundle hashes for replay.

## Evidence

Regression tests cover all three garden approaches, altered card and strategy rejection, shared progress, personal recognition, snapshot restore, and journal replay. Browser tests cover deliberate choice and stale-choice handling. A local playthrough checked Notice, scouting, travel, inspection, the visible result, and the Journal after a server restart.

A five-player session remains the next product check. Measure whether each player can explain Rati's need, choose an approach, identify their contribution, and find the return invitation. Record time and points of confusion before setting a first-visit duration target.

## Visual baseline review

Desktop and mobile baselines cover macOS and Linux. The Linux images came from CI run 35459714339 at commit `a6483b92fa8a0800e266781c2e3abc21e282aaed` and were inspected before acceptance. System fonts change text wrapping and panel height. Both renderings keep the current next step visible. The comparison limit remains 3%, alongside the shared layout and interaction checks. CI retains its screenshots and layout metadata for seven days.
