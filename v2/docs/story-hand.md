# Story Hand

The Story Hand is the player-facing action system. Its surface has three stable
slots and four suits; the exact verb remains authoritative underneath.

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

## Three stable piles

The server composes exactly three independent queues, one per kind of world
entity the action is *about*:

- **Item** — a tangible object: Take, Drop, Use, Give, Trade, Accept, Craft.
- **Location** — a place or the room itself: Travel, Flee, Search, Study,
  Scout, Explore, Open, Use feature, and the place-bound job verbs
  (Prepare, Work, Help) plus the room Check.
- **Avatar** — a person, yourself or another: Chat, Notice, Befriend,
  Remember, Attack, Defend, Rescue, Steal, Rest, Train, Evolve, Cast.

Each pile always surfaces its own strongest current offer, so the hand cannot
show two Travel cards and no Notice. Because a pile holds every verb for its
entity kind, the verb variants of one thing (Take / Drop / Give for the same
item) sit in the same queue — so Discard reveals *another way to act on this
thing*, not an unrelated replacement. See Discard below.

Grouping is by exact verb (`offer.kind`), not by suit, provider, or narrative
role. A few kinds are deliberately filed against their literal target:
`give_item` and `trade_item` target the other avatar but belong to **Item**,
because the item is what is being decided about; `theft` targets the item but
belongs to **Avatar**, because stealing is a confrontation with the person.
An unrecognised kind falls to **Avatar**, the catch-all.

Sparse scenes borrow a deterministic card into an empty pile before any card
is selected. The queues remain disjoint, so advancing one pile cannot move
another. First-tale and journey guarantees are inserted into the pile that
owns their entity, not layered over the completed hand.

## Discard

Discard replaces the selected card, never the whole hand. It lives inside that
card's detail modal rather than occupying a fourth hand slot. Every replaceable
entry contains its own certificate with actor, scene, state revision, slot,
slot generation, and exact replaced offer. The journal and wire format retain
the historical `ThinkHand` name for replay compatibility; clients present it as
Discard.

- The first Discard after entering a safe scene is free.
- Later Discards in that scene consume the turn.
- Discard always consumes the turn in risky, dangerous, and ordered scenes.
- A pile with no other current possibility does not show Discard, and the
  card says so rather than showing a dead control.
- Because a pile is one entity's verbs, Discard reads as "show me another way
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

The compact card face reads in this order: suit and verb, title/target, effect,
cost and risk, source, then art. Suit controls the main colour. Rarity is only a
small collectible mark. On mobile the footer never renders more than the three
Story Hand cards.

## Player vocabulary

| Concept | Player-facing term |
| --- | --- |
| carried physical inventory | **Pack** |
| equipped weapon, bag, shelter, and worn charms | **Loadout** |
| ready magic | **Prepared spells** / **Spellbook** |
| exhausted or discarded cards | **Spent** |
| three current actions | **Story Hand** |
| one pile's rotation of verbs for its entity | **Discard** (never shown as a queue) |
| deterministic internal action sequence | **Offer queue** (not normally shown) |

The design rule is: simple on the surface, exact underneath.
