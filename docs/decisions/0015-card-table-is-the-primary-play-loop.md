# ADR 0015: the card table is the primary play loop

- Status: Accepted
- Date: 2026-10-17
- Decision owners: CosyWorld maintainers
- Related: #1051, #1052, #1054, #1055, #1056, ADR 0001, ADR 0002, ADR 0003,
  ADR 0005, ADR 0009, ADR 0014, ADR 001

## Context

The reflected shore (`v2/card-game/`) is the first CosyWorld loop that plays
well. Its design is [Avatars, items, and locations](../design/avatar-simulation-redesign.md).
Since #1056 it is the root page on both Fly apps. The shared-world client
remains at `/classic`.

The table runs in the browser. Its rules, cast, and quest programs are a
deterministic JavaScript model, and each browser's localStorage save is its only
record. The shared runtime (C kernel, Rust orchestrator, journal) does not see
card play.

The earlier decisions describe a different surface: a dealt two-card action
hand with Think and Pass (ADR 0002) over SRD action ids (ADR 001). Both
documents use "hand" for that surface. The card table uses the word for goals.
Contributors now read two incompatible descriptions of the same product.

## Decision

### The card table is the product direction

New play work targets the card table. `/classic` stays live and maintained, but
new mechanics are designed for the table first. The shared runtime remains the
foundation that a shared, multiplayer table will run on.

### Design pillars

These rules explain why the table plays well. Card work must not break them.

1. **Every play moves a visible fact.** A play changes a place, a holder, or a
   condition, and the scene says so. There are no hidden stats.
2. **Wants are hands of real things.** Each goal is Hold, At, and With over
   entities the player can see and reach. Progress reads off the table.
3. **Wants overlap on a few objects.** Cast goals keep naming the player's items
   and presence. That overlap makes the trades.
4. **One rule path for everyone.** The cast uses the same reach, consent,
   capacity, and trade rules as the player.
5. **A small set of laws recombines.** Light, cover, sound, carrying, and the
   reflection work the same way wherever they appear. Pairs of cards are the
   verbs.
6. **The player's play drives the clock.** Nothing happens offscreen without a
   cause. Each play buys one act from each cast member.
7. **A refusal teaches.** The cast says what it wants and what it offers.

### Vocabulary

| Term             | Meaning                                                                          |
| ---------------- | -------------------------------------------------------------------------------- |
| card             | A view of one persistent avatar, item, or location.                              |
| table            | The row of every card the player can reach now.                                  |
| pair             | Two raised cards that resolve to one combined play.                              |
| play             | One certified act. It commits, then the cast acts.                               |
| target hand      | A goal: Hold these items, At this place, With these avatars.                     |
| quest program    | An ordered list of steps. Each step is one or more alternative target hands.     |
| level            | Earned once per completed program.                                               |
| cast             | Avatars the player does not control. They follow the same rules.                |

"Action hand" names the `/classic` surface only. New documents say "table" for
the row and "target hand" for a goal.

### Entity model

Cards are projections of canonical entities, never the entities themselves. This
restates the surviving rule of ADR 0001 and the ownership boundary of ADR 0006.
Items move between holders. Locations hold occupants and things. History follows
the entity.

### Play grammar

Every reachable card is visible. One card or a pair resolves to exactly one
offer, chosen by the rules. A play is submitted by its exact offer key against a
state revision, and a stale play is refused. Waiting is a play. Avatars
controlled by inference use the same offers as people.

For the card table this supersedes ADR 0002's dealt two-card hand, Think, Pass,
and provider priority table, and ADR 001's SRD action ids as the play substrate.
Both stay in force for `/classic`. Their principles carry over: rules author the
offers, submission is exact, and stale actions are refused.

### Cast and consent

The cast plans toward its target hands through the same legal actions as the
player. An avatar keeps what its current goals need and offers its spares.
Trades are atomic two-holder swaps. Consent comes from authored and current
state, never from generated text.

### Quests and levels

Quest programs compose `hold`, `at`, and `withAvatars` parts with `sequence` and
`either`. Program generation is deterministic. Each program awards its level
once.

### Local tables are not the canonical world

A browser save, including a named `?table=` slot, is a separate non-canonical
installation under ADR 0003's self-hosted clause. It has no shared scarcity, no
accounts, no AI, no currency, and no rewards. It is never imported into or
merged with the official world.

### Authority while the table is local

The JavaScript model is the reference behavior. New card rules land there with
tests in `test/card-*.test.mjs`. A rule may stay client-only while it affects one
browser's table.

Anything shared, multiplayer, persisted on the server, or reward-bearing crosses
the C kernel and the journal before it ships. That includes levels or items that
carry between players or hold value outside the table. Such a change ports the
rule with parity tests in the same change.

### Path to the shared table

The port is planned in [The Shared Card Table](../backlog/shared-card-table.md).
In summary:

1. The JS model emits an ordered trace of sub-actions and a state digest. A
   checked-in golden trace becomes the cross-implementation oracle.
2. The kernel gains card custody and item state: bundles, slot capacity, light,
   fuel, sound, cover, the reflection gate, and a round-end tick.
3. The kernel gains quest hands, desire-derived consent, and consented give,
   ask, and trade as new action codes. Existing codes keep their meaning.
4. Rust journals each cast act and each generated program as its own action, so
   replay never re-runs the planner. Pack data describes card sites.
5. The browser reads server offers over SSE and retires the local save.

## Disposition of earlier decisions

| ADR  | Disposition                                                                                     |
| ---- | ----------------------------------------------------------------------------------------------- |
| 0001 | Keep as superseded. Its surviving rule (a card presents an entity) is restated here.            |
| 0002 | Superseded for the card table. Remains the `/classic` contract.                                 |
| 0003 | Keep. Local tables are non-canonical installations. The shared table must satisfy it.           |
| 0004 | Classic-scoped. The table has no rest, spells, or expedition ring.                              |
| 0005 | Keep. The reflected path is a Gate whose method is light at a marked reflection.                |
| 0006 | Keep. A linked avatar becomes a cast card with its own quest program.                           |
| 0007 | Keep. Lamp and bell are item devices. A dormant item card is inspectable but offers no play.    |
| 0008 | Keep. Programs, completions, and levels land as declared-write projection mutations.            |
| 0009 | Keep. A quest program is a solo Venture. "With" proves co-presence, not membership.             |
| 0010 | Keep.                                                                                           |
| 0011 | Keep. Generated programs are deterministic rules output, never batch-minted state.              |
| 0012 | Keep. Talking to an avatar card is talk, not Notice.                                            |
| 0013 | Keep.                                                                                           |
| 0014 | Keep. A table level-up is not a voice refresh trigger until the table is shared.                |
| 001  | Superseded as the table's action substrate. Its entity and item model and code rule stand.      |

## Consequences

- `CLAUDE.md`, `ENG.md`, `readme.md`, `v2/README.md`, and `docs/index.md` name
  the card table as the primary play loop and scope the shared-runtime
  invariants honestly.
- The backlog is regrouped: documents that feed the table, documents for the
  shared runtime, and historical records.
- The card table needs its own gates: register checks on its copy and a browser
  smoke in `./v2/mvp.sh check`.

## Acceptance for the shared table

- The table replays from the journal and round-trips through a snapshot.
- Two players see the same item custody.
- Cast trades commit atomically.
- AI never changes custody outside a certified offer.
- The JS golden trace replays to the same digest in C.
