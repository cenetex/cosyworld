# ADR 0002: the action hand is an authoritative state projection

- Status: Accepted
- Date: 2026-07-17
- Decision owners: CosyWorld maintainers
- Related: #20, #48, #94

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

`GET /state` projects both the complete ranked `action_offers` list and a
deterministic `action_hand`:

```json
{
  "action_hand": {
    "schema_version": 1,
    "capacity": 3,
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
project reference is present. `work` and `help` for the same progress clock are
one hand group; `use_item` and `use_feature` are one Use group. Candidates sort
by provider priority, then existing action rank, then stable offer id. The
composer initially takes no more than two entries from one provider, fills any
remaining slots in the same stable order, and ensures that at least one
generally useful action (Notice, Inspect, Travel, Chat, Rest, or Grow) is
present when one is reachable.

Clients use `action_hand.entries` for initial card order and use
`provider.reason` on the card, accessible name, hover copy, and confirmation
dialog. A client may merge equivalent offers into one choice-bearing card and
may let the player page through the remaining complete offer list, but it must
not hash, randomize, or silently re-rank the authoritative opening hand. A
change to the projected offer/provider ids is the signal to recompose it.

Wallet keepsakes may supply matching art and an explicit cosmetic annotation.
Equipping, removing, or owning one does not change action eligibility, order,
rank, effects, costs, odds, or hand power.

## Replay and compatibility

The projection is derived only from the current runtime state, compiled pack
content, and deterministic action ranks. It is not persisted separately. The
same snapshot therefore produces the same hand, and older snapshots acquire
the projection on load without migration. `schema_version` allows a later
client to recognize a deliberately changed composition contract.

Property-style fixtures cover stable repeated responses, reachable targets,
the generally useful fallback, Calling/Journal/friendship/held-item changes,
and snapshot round trips. Browser smoke covers the visible three-card
explanation and verifies that kept-close cards remain cosmetic.

## Consequences

Identity and history now affect what the player sees first without affecting
the action resolver. Pack authors can change vocabulary and world resources,
but cannot inject client-local priority. Debugging an unexpected hand starts
from three inspectable values—offer, provider, tie-break—instead of browser
storage or a deal nonce.
