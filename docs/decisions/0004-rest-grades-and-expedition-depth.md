# ADR 0004: rest grades and expedition depth

- Status: Accepted
- Date: 2026-07-26
- Decision owners: CosyWorld maintainers
- Related: [#348](https://github.com/cenetex/cosyworld/issues/348),
  [#356](https://github.com/cenetex/cosyworld/issues/356)

## Context

Rest currently clears projection tags but cannot refresh authoritative cards.
The world already records a `tired` condition and one
`frontier_travel_since_rest:<seq>` tag for each qualifying frontier move.
Those facts replay, but the existing presentation neither explains expedition
depth nor gives Rest a useful recovery ladder.

The card model also makes refresh authoritative. Restoring a card's charges or
moving it out of an exhausted zone changes legal play, so a new rest procedure
must cross the C kernel. Existing journaled Rest records keep their current
tag-clearing meaning; they are not reinterpreted.

The product constraints are:

- sanctuary remains safe and complete;
- ordinary play, including Rest, always has a zero-Orb path;
- place and carried gear determine the available recovery grade;
- the client does not infer mechanical state from journal tags; and
- `stamina`, `weariness`, and `expedition depth` remain system language, not
  additions to the player-facing noun budget.

## Decision

### Rest grades

Hearth, Lodged, and Camp are internal grade names. They do not become new
player-facing nouns or gauge labels.

The grade is derived before the authoritative rest procedure is submitted.
The kernel validates the submitted grade and applies exactly its refresh
contract; it never silently upgrades or downgrades recovery.

| Grade | Eligibility | Exact refresh contract |
| --- | --- | --- |
| **Hearth** | A sanctuary room | Clear `tired`, `trained_since_rest`, and the complete expedition counter. Refresh the whole exhausted spell hand and every rest-recoverable charm and relic. |
| **Lodged** | A room with an authored lodging feature whose gate is satisfied | Clear `tired` and `trained_since_rest`. Refresh the whole exhausted spell hand. Do not clear expedition depth or refresh charms or relics. |
| **Camp** | A frontier room while valid shelter is equipped | Clear `tired`. Refresh one exhausted spell. Do not clear `trained_since_rest` or expedition depth, and do not refresh charms or relics. |
| **Not offered** | A frontier room without valid equipped shelter | Do not submit a rest procedure. Nothing is spent, changed, or silently downgraded. |

“Everything” at Hearth means the complete state governed by this rest
contract. It does not erase unrelated conditions, clocks, Jobs, Bonds, room
state, or other world history.

The refresh scopes are product law, not tuning values. Content may determine
which authored cards are rest-recoverable, but it cannot redefine the four
grades.

### Lodging gates and price

Lodging never costs Orbs. An authored lodging feature may gate Lodged recovery
only through one or more of:

1. access already recognized by the room;
2. an existing Bond;
3. a completed Job; or
4. an authored room resource.

These are eligibility facts in the world, not alternate currencies. A lodging
route must not debit the Orb ledger, introduce an Orb price, or make wallet
state a substitute for the permitted gates. A player with zero Orbs can
satisfy lodging through ordinary play.

### One expedition-depth ring

The avatar portrait has at most one segmented ring. It represents expedition
depth:

- the number of pips is exactly the actor's
  `frontier_travel_since_rest_required` value;
- each committed qualifying frontier move fills one pip, bounded by the pip
  total;
- Camp and Lodged recovery leave the filled count unchanged;
- Hearth recovery clears the count;
- the server serves filled and total counts as typed projection state; and
- the ring animates only when a committed world event changes that state.

The ring is unlabeled. It does not display a number, tooltip, legend, or
player-visible name such as “stamina” or “weariness.” It never advances from a
wall clock, an optimistic client action, or client-side tag parsing.

Future HP or wound presentation may coexist with expedition depth, but not as
another ring. The ring belongs exclusively to expedition depth; wounds change
the portrait treatment. There are no concentric HP and expedition arcs.

### Replay and compatibility

Existing projection-only Rest journal records retain their historical
tag-clearing behavior. Authoritative card refresh uses a new append-only action
code and events. Replay continues to derive the same numeric expedition count
from committed state; presentation copy and ring animation do not become
authority.

## Explicit non-decisions

This ADR does not choose between redeal and a More Actions surface. That
product-law conflict belongs to
[#354](https://github.com/cenetex/cosyworld/issues/354) and must be resolved
once, without coupling the rest ladder to either outcome.

This ADR also does not tune danger-clock movement, define the shelter or
lodging feature schemas, author an inn, change Rest offer ranking, or implement
the kernel procedure or ring. Those are follow-up implementation slices.

## Consequences

- Every rest implementation can test one of four grades against a fixed
  refresh contract.
- Lodging authors have a closed set of fiction-backed gates and no currency
  escape hatch.
- Expedition depth remains replay-derived and legible without adding a player
  noun or a second portrait meter.
- Card refresh cannot land as projection-only state.
- Rest availability and recovery presentation remain independent of the
  eventual action-browsing decision.

## References

- [CosyWorld Product Requirements](../../PRD.md), especially product pillars 2,
  3, 5, and 7 and the player noun budget.
- [CosyWorld RPG System Bible](../systems/09-cosyworld-rpg-system.md)
- [SRD-backed action and collectible system](../systems/04-action-system.md)
- [ADR 0002: the action hand is an authoritative state projection](0002-action-hand-is-authoritative-state.md)
