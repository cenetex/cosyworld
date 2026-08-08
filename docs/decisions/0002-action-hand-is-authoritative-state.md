# ADR 0002: the action hand is an authoritative state projection

- Status: Accepted
- Date: 2026-07-17
- Amended: 2026-07-27 by #354; 2026-07-29 by #529; 2026-08-01 by #516 and #408
- Decision owners: CosyWorld maintainers
- Related: #20, #48, #94, #354, #529, #516, #408

## Context

The browser previously chose its opening action cards with a local hash and
then moved matches for wallet keepsakes to the front. That made the hand depend
on browser state instead of shard state, obscured why an action appeared, and
could not be reproduced from a world snapshot. It also blurred the boundary in
[ADR 0001](0001-cards-are-entitlements.md): owning a collectible appeared to
change available play even though entitlements must not increase base-game
power or odds.

Calling, Journal history, friendships, held world items, active jobs, and the
current location are already authoritative. They should be the sources that
make a small action hand feel personal.

## Decision

`GET /state` projects a deterministic `action_hand` and exposes only those
same current offers through `action_offers`:

```json
{
  "action_hand": {
    "schema_version": 1,
    "capacity": 2,
    "deck_size": 7,
    "draw_available": true,
    "entries": [
      {
        "offer_id": "check:listen",
        "kind": "check",
        "intention": "notice",
        "provider": {
          "kind": "calling",
          "id": "calling:5000",
          "label": "Your Calling",
          "reason": "From your Calling",
          "priority": 40
        }
      }
    ]
  }
}
```

Every ranked offer carries the same provider record. Provider ids are stable
references to authoritative state, not display labels. The supported provider
order is:

| Priority | Provider | Examples |
| ---: | --- | --- |
| 0 | immediate rules | danger and required recovery |
| 10 | Journal | bank a memory, train, begin a friendship |
| 20 | friendship | chat, help, give, trade, remember with a bonded resident |
| 30 | held world item | use, give, trade, or craft with an item in hand |
| 40 | Calling | Notice, Inspect, Scout, or Travel matching the Calling |
| 50 | active job | contribute to named shared work |
| 60 | location | choices supplied by the current room |
| 70 | foundation rules | a final rules fallback |

An offer is eligible only when it is enabled and every required target or
project reference is present. Every reachable exact `offer_id` occupies its own
stable deck position, including same-kind work, help, use, gift, and trade
offers. Candidates sort by provider priority, then existing action rank, then
stable offer id. The composer fills the two ordinary hand slots in the same
stable order. The former generally-useful-card
guarantee is superseded: a hand may be awkward, and certified Think/Pass is
the authoritative way to commit a turn and receive the next two cards.

Clients use `action_hand.entries` for initial card order and use
`provider.reason` on the card, accessible name, hover copy, and confirmation
dialog. Each projected entry renders one card bound to that exact offer; clients
must not merge targets, reconstruct alternatives, hash, randomize, silently
re-rank, or discard same-kind offers. A change to the projected offer/provider
ids is the signal to recompose it.

### Finite hand: two cards and certified Think/Pass

The resting surface is exactly the current two-card hand. There is no complete
offer chooser and clients never receive the internal legal superset. A player
may play one current card or choose **Think** (named **Pass** during a focused
turn). The projected `action_hand.pass` certificate contains an opaque offer
id, actor-bound state revision, hand generation, and scene/focus key. The
server re-derives and validates that certificate under the mutation lock.

Pass records `hand.shuffled`, rotates by two through the deterministic deck,
consumes exactly one current turn, and deals the next hand. A retry with the
same canonical submission receipt is idempotent; a stale certificate mutates
nothing. Snapshot v17 persists an authoritative per-actor hand-generation map
updated by the replayable `ShuffleHand` mutation. Snapshot v16 migrates once
from a bounded event projection; certificates are never subsequently derived
from the event log or browser storage. Historic turn-exempt
`hand.shuffled` records remain replayable, but legacy `draw`, `shuffle`,
`deal`, `more`, and `redraw` inputs are version-refused rather than silently
mapped to Pass.

Inference-controlled avatars use the same hand. They select a playable current
card or Pass; combat uses the same rule, so an AI avatar cannot reach around a
bad hand to select its globally preferred attack, defence, or escape.

## Command submission

`POST /commands` accepts an `offer_id` from the current action projection as
its authoritative action input. The server resolves that exact
identifier under the same world-state lock that checks its embedded
`state_revision`; it does not reparse the offer's display command. Malformed,
stale, unknown, and disabled identifiers fail before presence, journal, event,
seed, or world state can change and return distinct typed failure codes.

The prose command surface keeps room inspection, reporting, and moderation
turn-exempt. State-changing scene actions require a current
hand offer. `POST /commands` with the current Pass certificate is the sole
hand-cycling route; the legacy `/actions/pass` endpoint explicitly refuses an
uncertified request.

Wallet keepsakes may supply matching art and an explicit cosmetic annotation.
Equipping, removing, or owning one does not change action eligibility, order,
rank, effects, costs, odds, or hand power.

## Replay and compatibility

The projection is derived only from the current runtime state, compiled pack
content, and deterministic action ranks. It is not persisted separately. The
same snapshot therefore produces the same hand, and older snapshots acquire
the projection on load without migration. `schema_version` allows a later
client to recognize a deliberately changed composition contract.

Property-style fixtures cover stable repeated responses, certificate-bound
hand-only submission, stale and duplicate Pass rejection/receipt replay,
Calling/Journal/friendship/held-item changes, AI Pass, and snapshot round trips.
Browser smoke covers the visible two-card hand, turn-consuming Think/Pass, and
keeps kept-close cards cosmetic.

## Consequences

Identity and history now affect what the player sees first without affecting
the action resolver. Pack authors can change vocabulary and world resources,
but cannot inject client-local priority. Debugging an unexpected hand starts
from three inspectable values—offer, provider, tie-break—instead of browser
storage or a deal nonce.

The two-card hand is small, learnable, and strategically finite. Clients cannot
browse, manufacture, or submit cards outside it. `hand.shuffled` remains the
durable replay signal; its old turn-exempt replay semantics are preserved, but
new free-redeal inputs are intentionally retired.
