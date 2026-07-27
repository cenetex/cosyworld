# ADR 0002: the action hand is an authoritative state projection

- Status: Accepted
- Date: 2026-07-17
- Amended: 2026-07-27 by #354
- Decision owners: CosyWorld maintainers
- Related: #20, #48, #94, #354

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
    "capacity": 2,
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
composer fills the two ordinary hand slots in the same stable order, taking no
more than two entries from one provider, and ensures that at least one
generally useful action (Notice, Inspect, Travel, Chat, Rest, or Grow) is
present when one is reachable.

Clients use `action_hand.entries` for initial card order and use
`provider.reason` on the card, accessible name, hover copy, and confirmation
dialog. A client may merge equivalent offers into one choice-bearing card, but
it must not hash, randomize, or silently re-rank the authoritative opening
hand. A change to the projected offer/provider ids is the signal to recompose
it.

### Complete-offer reachability: redeal

The free deterministic **redeal** is the only ordinary-scene escape hatch from
the opening pair. Each redeal replaces both visible cards with the next pair in
the authoritative legal-offer order, excluding offers already shown in that
cycle. After every currently legal offer has appeared, the next redeal begins
the same cycle again. A final one-card page is allowed when the remaining pool
is odd.

Redeal is browsing, not a world action or a random draw. It consumes no world
turn, currency, item use, or progression; it cannot change the legal set,
provider rank, target, cost, risk, effect, or resolver. The `hand.shuffled`
event is its journal record. The browser-local page cursor is disposable
presentation state: refresh may return to the authoritative opening pair, while
the durable event still records that the player asked for another page.

A grouped **More Actions** list is explicitly rejected and closed by #354. It
would be a second ordinary action surface with different reachability and
spotlight behavior, not another rendering of redeal. The browser's compact
“more” control means “draw the next two actions”; it must never open or imply a
complete pick-list. Future transports may render the same redeal as a reaction,
terminal command, or voice intent, but may not introduce the rejected list
under another name.

This amendment deliberately upholds the browser's shuffle/redeal contract. The
regression assertions requiring `id="shuffle"`, `class="shuffle-glyph"`, and
the compact “more” label remain normative. They supersede the earlier
no-shuffle browser expectation cited by #354 and must not be quietly removed or
inverted.

## Command submission

`POST /commands` accepts an `offer_id` from the current `action_offers`
projection as its authoritative action input. The server resolves that exact
identifier under the same world-state lock that checks its embedded
`state_revision`; it does not reparse the offer's display command. Malformed,
stale, unknown, and disabled identifiers fail before presence, journal, event,
seed, or world state can change and return distinct typed failure codes.

The optional prose `command` field remains temporarily available for older
clients and the command palette. It is a legacy convenience resolver, not the
authoritative join between an offer and an action. When both fields are sent,
`offer_id` wins. Retirement or stricter hand enforcement remains a separate
decision alongside #354.

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
and snapshot round trips. Browser smoke covers the visible two-card hand, its
required redeal control, and verifies that kept-close cards remain cosmetic.

## Consequences

Identity and history now affect what the player sees first without affecting
the action resolver. Pack authors can change vocabulary and world resources,
but cannot inject client-local priority. Debugging an unexpected hand starts
from three inspectable values—offer, provider, tie-break—instead of browser
storage or a deal nonce.

The cost of closing **More Actions** is that reaching a specific low-ranked
offer can take several redeals. The benefit is one small learnable control
surface, no duplicate grouping taxonomy, and behavior that already matches the
browser, terminal alias, PRD, `hand.shuffled` event, and no-turn redeal tests.
