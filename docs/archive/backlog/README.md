# Planning archive

Archived from `docs/backlog/` on 2026-10-31 (source revision `origin/main`
before this move). Most of these plans predate
[ADR 0015](../../decisions/0015-a-generated-world-seen-through-cards.md) and
describe `/classic`. Active work lives in GitHub issues; current behavior is in
the [current game source map](../../current-game.md).

Still cited by current card-table guides: [Generated World Core](generated-world-core.md)
and [Runtime Maintenance](runtime-maintenance.md).

| Plan                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Superseded by or conflicts with      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| [Action verbs and economy](action-verbs-and-economy.md), [SRD action-card foundation](srd-action-card-foundation.md)                                                                                                                                                                                                                                                                                                                                                              | Fixed verbs                          |
| [Avatar NFT-only core](avatar-nft-only-core.md)                                                                                                                                                                                                                                                                                                                                                                                                                                   | NFT avatars deferred                 |
| [Quest grammar and return](quest-grammar-and-return.md), [Void vision quests](void-vision-quests.md)                                                                                                                                                                                                                                                                                                                                                                              | One want per avatar; no quest chains |
| [Player journal as a semantic chronicle](player-journal-semantic-chronicle.md), [Fiction frontier](fiction-frontier.md)                                                                                                                                                                                                                                                                                                                                                           | Now, not a log                       |
| [Rest, travel, and weariness](rest-travel-and-weariness.md)                                                                                                                                                                                                                                                                                                                                                                                                                       | #1648 rest design                    |
| [Avatar lifecycle and rescue](avatar-lifecycle-and-rescue.md)                                                                                                                                                                                                                                                                                                                                                                                                                     | Three-loss rule                      |
| [Reflected Shore worldpack migration](reflected-shore-worldpack-migration.md), [World topology and composition joins](world-topology-and-composition-joins.md)                                                                                                                                                                                                                                                                                                                    | Small worlds                         |
| [Thresholds, trails, and strict referee](thresholds-trails-and-strict-referee.md), [Combat, encounters, and range](combat-encounters-and-range.md), [Card-composed character creation](card-composed-character-creation.md), [Community art evolution](community-art-evolution.md), [Holy Land integration playtest](holy-land-integration-playtest.md), [Seventh-visit operating queue](seventh-visit-operating-queue.md), [Resident drive autonomy](resident-drive-autonomy.md) | Classic                              |

The original planning index follows.

## Original index

The files in this directory preserve product and engineering thinking beyond
the immediate implementation slice.

## Source-of-truth policy

- **Planning documents own planning:** rationale, product law, alternatives,
  durable acceptance, dependency order, proof gates, and next/later horizons.
- **GitHub Issues own immediate work:** one bounded executable slice, its current
  acceptance checklist, assignee, dependencies, and delivery status.
- An issue link in a planning document is historical context unless the text
  explicitly identifies it as the currently promoted slice.
- Do not keep future design alive as a parked or blocked issue. Close it into
  the relevant planning section and promote a new or reopened bounded issue only
  when the prerequisite and priority decision are real.
- Closing a design issue does not mean the proposal shipped. The planning
  document must say whether a result is shipped, accepted but unshipped, or only
  proposed.

## Status vocabulary

| Label          | Meaning                                                                                |
| -------------- | -------------------------------------------------------------------------------------- |
| **Shipped**    | The behavior exists in the runtime/content, replays, and has executable evidence.      |
| **Accepted**   | Product or compatibility law is normative, but some behavior may remain unimplemented. |
| **Planning**   | A durable candidate sequence or design that has not been activated.                    |
| **Historical** | Prior issue/decision evidence retained to explain why the current contract exists.     |

Avoid `open`, `blocked`, `ready`, milestones, assignees, and live priority labels
in these files. Those facts change in GitHub. A planning priority may describe
dependency or product importance, but it must not imply that the work is active.

## Grooming rule

When immediate work lands:

1. close its GitHub issue;
2. update the canonical product/system documentation with shipped truth;
3. update the relevant planning status or remove the resolved gap; and
4. promote only the next smallest justified slice.

The current product proof is the card table
([ADR 0015](../../decisions/0015-a-generated-world-seen-through-cards.md)). Its
next sequence is [Generated World Core](generated-world-core.md). A planning
document that predates ADR 0015 and describes the dealt action hand applies to
`/classic` until it is rewritten for the table.

The [Seventh-Visit Product Proof Plan](seventh-visit-operating-queue.md) is
historical: it records the proof waves for the shared-world loop. The
construction/living-world sequence is
[Construction, Place Development, and Route Discovery](../../worldpacks/construction-and-routing-discovery.md).

[Runtime Maintenance](runtime-maintenance.md) preserves the extraction sequence
and connection reuse proposals that the shared card table will need.

[Reflected Shore Worldpack Migration](reflected-shore-worldpack-migration.md)
preserves the six-pack art research, four-of-each content selection, proposed
Shore crossings, and bounded delivery slices. Integration follows multiplayer
testing and the creator's art approval.
