# Story Hand

The Story Hand is the player-facing action system. It deals up to three noun
cards: the current **Location**, one **Item**, and one **Avatar**. A player
selects one, two, or all three cards, then plays the resulting Scene Meld.

The noun cards provide context. The four suits provide intent. The exact verb
remains a server-certified action offer underneath.

## The four action suits

Only playable actions have suits. Actor, Item, Location, Spell, Calling,
Friendship, Journal, and Worldpack cards keep their own roles and may be the
source or target of an action.

| Suit | Meaning | Typical exact verbs |
| --- | --- | --- |
| **Head** | Learn, notice, interpret, or reveal. | Notice, Inspect, Search, Study, Scout, Listen, Find resonance, Rank echoes |
| **Heart** | Relate, communicate, exchange, recover, or grow. | Chat, Speak, Befriend, Remember, Give, Accept, Trade, Rest, Train, Evolve |
| **Honor** | Face immediate danger or protect someone from it. | Attack, Defend, Flee, Rescue, Steal |
| **Hustle** | Move, manipulate, make, prepare, or contribute. | Travel, Take, Drop, Use, Open, Craft, Prepare, Work, Help, Finish, Illustrate |

Suit is navigation, not the action identity. `Take`, `Use`, and `Craft` are
different actions even though each is Hustle. Danger is risk metadata, not a
fifth suit. A Spell is still an Item/source card; the spell action's suit is
derived from its effect.

## Three noun cards

The server composes three independent queues, one per kind of world entity the
action is *about*:

- **Item** — a tangible object: Take, Drop, Use, Give, Trade, Accept, Steal,
  Craft, and Cast.
- **Location** — a place or the room itself: Travel, Flee, Search, Study,
  Scout, Explore, Open, and the place-bound job verbs (Prepare, Work, Help)
  plus the room Check.
- **Avatar** — a person, yourself or another: Chat, Notice, Befriend,
  Remember, Attack, Defend, Rescue, Steal, Rest, Train, Evolve, Cast.

Each queue surfaces its strongest current exact offer. This means the hand does
not show two Location cards while hiding the Avatar card. The public hand names
each noun with `card_type: location | item | avatar`; the older internal slot
names remain in Think certificates so old journals still replay.

Grouping is by exact offer, not by suit, provider, or narrative role. A few
kinds are deliberately filed against their source rather than their target:
`give_item`, `trade_item`, and `theft` involve another Avatar but belong to
**Item**, because the Item is what is being decided about. An unrecognised kind
uses its target or source entity and otherwise falls to **Location**.

Empty entity queues stay empty. The queues remain disjoint, so advancing one
cannot move another. First-tale and journey guarantees are inserted into the
queue that owns their entity.

## Build a play

A Scene Meld follows a small grammar:

`one to three noun cards + one approach -> one exact verb`

The browser starts with the exact offers already certified in the current
hand. It never creates a verb from card names or artwork.

1. Select one to three noun cards.
2. Compare their stable entity bindings with each selected exact offer.
3. Keep only offers that name every selected entity. The current Location is
   an implicit binding for ordinary scene actions.
4. Filter those offers by Head, Heart, Hustle, or Honor.
5. If one verb remains, it may be inferred. If several remain, show their exact
   names and let the player choose. If none remain, ask the player to remove a
   card or Think.

For example, Location + Item can resolve **Take** when that exact item is at the
current Location. Location + Avatar can resolve **Chat** when that Avatar is a
legal target. Location + Avatar + Item can resolve **Give** only when the offer
binds that same Item and Avatar. Adding an unrelated Item to Chat does not make
a new action.

Selecting extra cards does not add power, combine effects, or widen targets.
The selected cards only disambiguate an already legal offer. Authored
three-card recipes may later add special presentation or rewards, but they must
still resolve through a named server offer and deterministic rules.

## Think

Think replaces one noun card, never the whole hand. Every replaceable
entry contains its own certificate with actor, scene, state revision, slot,
slot generation, and exact replaced offer. The journal and wire format retain
the historical `ThinkHand` name for replay compatibility.

- The first Think after entering a safe scene is free.
- Later Thinks in that scene consume the turn.
- Think always consumes the turn in risky, dangerous, and ordered scenes.
- A queue with no other current possibility disables Think, and the
  card says so rather than showing a dead control.
- Because a queue is one noun kind's offers, Think reads as "show me another way
  to act on this" — the same rotation mechanism, a legible meaning.
- Moving to another scene resets the slot counters and safe-scene allowance.

The hidden deterministic structure is an **Offer queue**, not a player deck.

## Presentation contract

Every published playable offer must carry these independent dimensions:

- `family`: action, control, or ceremony;
- `suit`: one of Head, Heart, Honor, or Hustle for an action, absent for controls/ceremonies;
- `verb`: the exact authored action;
- `source`: kind, stable id, and player-facing label;
- `state`: ready or locked;
- `provenance`: Core, Worldpack, Community, or Legacy;
- `rarity`: Everyday, Curious, Rare, or Storybook;
- `power`: separate from rarity;
- optional `cost`, `risk`, and `effect`.

The server owns this mapping. A new playable kind or model-interaction intention
that has no explicit mapping fails publication rather than falling back to a
client-inferred `utility` or `danger` type.

The compact card face reads in this order: noun type, suit and verb,
title/target, effect, cost and risk, source, then art. Suit controls the main
colour. Rarity is only a small collectible mark. On mobile the footer never
renders more than the three Story Hand cards.

## Player vocabulary

| Concept | Player-facing term |
| --- | --- |
| carried physical inventory | **Pack** |
| equipped weapon, bag, shelter, and worn charms | **Loadout** |
| ready magic | **Prepared spells** / **Spellbook** |
| exhausted or discarded cards | **Spent** |
| three current actions | **Story Hand** |
| deterministic internal action sequence | **Offer queue** (not normally shown) |

The design rule is: simple on the surface, exact underneath.
