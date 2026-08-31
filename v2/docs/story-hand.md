# Story Hand

The Story Hand is the player-facing play system. It deals up to three plain
noun cards:

- one **Location**;
- one **Avatar**;
- one **Item**.

A card chooses a thing. It does not choose an action. There is no Chat card,
Give card, Attack card, suit selector, target list, or verb menu in the hand.

The player selects one, two, or three nouns. The current world state resolves
that selection to one exact sentence. The player can play that sentence or
change the selected nouns.

## Noun queues

The server builds one queue for each noun type. Legal action offers are grouped
by the concrete entity they concern, so every visible card has a stable identity
such as `location:1`, `actor:1001`, or `item:2001`.

One noun may have several legal verbs behind it. Those verbs are resolution
candidates, not options printed on the card. For example, a Hearth Tonic item
may currently support Take, Drop, Use, Give, or Trade. The card face still says
only **Item — Hearth Tonic**.

Empty noun queues stay empty. A slot never borrows a second card from another
type. Think advances only its own queue, so another Item replaces the Item and
another Avatar replaces the Avatar.

## Build a play

The grammar is:

`one to three nouns + world state -> one exact verb`

The resolver starts with exact legal offers already certified by the server.
It then applies these rules:

1. An offer must belong to one selected noun.
2. Every important non-location noun named by the offer must also be selected.
   Give therefore needs its Item and target Avatar. It cannot silently choose
   another nearby person.
3. The current Location may be selected as scene context. A destination
   Location must be the place named by the exact offer.
4. Extra unrelated nouns make no play. They never add power or widen a target.
5. If several exact offers match, a fixed server order chooses one. State gives
   that order its meaning: an Avatar normally resolves to Chat, an opponent in
   active combat can resolve to Attack, a loose Item resolves to Take, and a
   carried useful Item can resolve to Use.

Examples:

| Selected nouns | Possible resolved sentence |
| --- | --- |
| Rati | Chat with Rati |
| Hearth Tonic | Use Hearth Tonic |
| Cosy Cottage | Search the Cosy Cottage |
| Rati + Hearth Tonic | Give Hearth Tonic to Rati |
| Garden Path | Travel to the Garden Path |

The browser shows only the resolved sentence and one Play button. It never asks
the player to choose an approach, verb, or target after selecting the nouns.

## Exact validation

The browser submits the selected noun card ids with the exact resolved offer.
The server rebuilds the current hand and resolves the same nouns again. The play
is accepted only when the submitted offer, route, source, and target still match.

This is especially important for conversation. An Avatar card for Rati can
resolve only to **Chat with Rati**. It is not permission to chat with anyone
nearby.

Older clients may still submit the representative exact offer without noun ids
for replay compatibility. That path remains narrow: it never widens Chat or any
other target-bearing action.

## Think

Think replaces one noun card, never the whole hand.

- The first Think after entering a safe scene is free.
- Later Thinks in that scene consume the turn.
- Think always consumes the turn in risky, dangerous, and ordered scenes.
- A noun queue with no other current entity disables Think.
- Moving to another scene resets the queue positions and safe-scene allowance.

The certificate still records the historical slot name and generation so old
journals replay, but its replacement identity is the noun card rather than one
of the hidden verbs.

## Presentation contract

A noun card publishes only what its face needs:

- `card_id`;
- `card_type` (`location`, `avatar`, or `item`);
- concrete `entity_kind` and `entity_id`;
- `label`;
- its Think certificate.

`offer_ids` are also published for deterministic local preview and exact
submission, but they are not rendered as choices. Action suit, cost, risk,
effect, provider, rarity, and verb do not appear on the noun card face.

The design rule is: **cards choose things; the world chooses the verb**.
