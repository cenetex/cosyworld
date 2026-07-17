# Cottage Pact proof world

The Cottage Pact is the dense return-play slice for the official world. It uses
eight existing, ungated rooms rather than adding geography:

`Cottage ↔ Garden ↔ Moonlit Trail` and
`Garden ↔ Old Oak ↔ Lost Woods / Meadow ↔ Mansion / Abbey`.

The Cosy Cottage is the shared home. A new avatar contributes on the first
visit by banking the hearth with the persistent Hearth Tonic and Story Button;
no entitlement or formal membership gate is required. That care action emits a
public `item.crafted` event. The room diary names the contributor, recipe, and
items, so a later visitor sees who tended the home and how.

## Repeatable loops

| Loop | Place | Persistent inputs | Why return |
| --- | --- | --- | --- |
| Bank the Cottage Hearth | Cosy Cottage | Hearth Tonic + Story Button | Leave the shared home ready for the next arrival |
| Tend the Rain-Soft Garden | Rain-Soft Garden | Dewbright Button + Watch Bell | Keep the first shared route legible |
| Reset the Practice Circle | Moonlit Trail | Wolfprint Charm + Hearthstone Tag | Make frontier practice useful to the next traveler |
| Quiet the echo | Moonlit Trail | Work alone or Help alongside another player | Change the active front and Coach relationship |
| Earn the threshold | Haunted Mansion | Work alone or Help alongside another player | Change the active front and Warden relationship |
| Resident exchange | all eight rooms | Overlapping resident desires | Carry one scarce item between several social hooks |

Care recipes do not consume their inputs. Work is the solo front path. Help is
the lower-risk cooperative path: in a two-player test, both players contribute
to the same public clock and see the same ordered room history. Co-presence is
useful, but neither front requires a synchronous group.

## Seven-visit script

Each visit begins and ends at the Cottage. Routes, items, recipes, fronts, and
gates are validated by `npm run v2:proof-world -- --strict`.

| Visit | Script | Proof |
| ---: | --- | --- |
| 1 | Arrive, Notice, take one Cottage item, **Bank the Cottage Hearth**, and Grow | Free first contribution; public named trace |
| 2 | Visit the Garden, trade with a resident, **Tend the Rain-Soft Garden**, return | Renewable home care and reciprocity |
| 3 | Reach Moonlit Trail, Notice, Work solo or Help with a second player, **Reset the Practice Circle**, return | First/third-visit front and care path |
| 4 | Travel through Old Oak and Lost Woods, Work/Help at Haunted Mansion, return | Second front with solo/cooperative responses |
| 5 | Carry Moonwool Thread or the Abbey Bookmark through Abbey and Meadow resident trades, return | Scarce-item circulation without leaving the slice |
| 6 | Revisit both fronts; one player Works while a partner Helps; Grow from the public results | Co-presence and two-front continuity |
| 7 | Read the Cottage diary, repeat **Bank the Cottage Hearth**, Remember, and Grow | The home reflects prior care and remains repeatable |

The deterministic gate verifies visits 1–7 exactly once, every route step, all
required item sources, all three care recipes, both fronts, and the absence of
entitlement gates. It also reports dead rooms, broken job/clock paths, and
non-renewable critical inputs.

## Playtest protocol

For the solo pass, use one new unsigned local avatar and choose Work on each
front. For the cooperative pass, create two avatars in the same room through
separate browser sessions; alternate Help/Work cards until the public clock
changes. After every visit, leave and reopen the game rather than resetting the
world. On visit seven, expand the Cottage diary and confirm the earlier care
line names the contributing avatar and **Bank the Cottage Hearth**.

Record time to first contribution, whether either player leaves the slice for a
required object, whether every card explains its target/cost/risk, and which
public beat gives the clearest reason to return. A failed route, gated input,
missing response, anonymous contribution, or non-repeatable care action is a
release blocker for this slice.
