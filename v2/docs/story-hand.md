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
| **Heart** | Relate, communicate, exchange, recover, or grow. | Chat, Speak, Befriend, Remember, Give, Trade, Rest, Train, Evolve |
| **Honor** | Face immediate danger or protect someone from it. | Attack, Defend, Flee, Rescue, Steal |
| **Hustle** | Move, manipulate, make, prepare, or contribute. | Travel, Take, Drop, Use, Open, Craft, Prepare, Work, Help, Finish, Illustrate |

Suit is navigation, not the action identity. `Take`, `Use`, and `Craft` are
different actions even though each is Hustle. Danger is risk metadata, not a
fifth suit. A Spell is still an Item/source card; the spell action's suit is
derived from its effect.

## Three stable slots

The server composes exactly three independent queues:

- **Story** — the scene's strongest invitation: location, quest, route, or
  danger.
- **Self** — an action grounded in the avatar: Calling, Friendship, Journal,
  equipped gear, or prepared spell.
- **Anchor** — a safe, legible foundation that keeps the hand usable.

Sparse scenes borrow a deterministic card into an empty slot before any card
is selected. The queues remain disjoint, so advancing one slot cannot move
another. First-tale and journey guarantees are inserted into the Story queue,
not layered over the completed hand.

## Think

Think replaces the focused card, never the whole hand. Every replaceable entry
contains its own certificate with actor, scene, state revision, slot, slot
generation, and exact replaced offer.

- The first Think after entering a safe scene is free.
- Later Thinks in that scene consume the turn.
- Think always consumes the turn in risky, dangerous, and ordered scenes.
- A slot with no other current possibility cannot be Thought about.
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
small collectible mark.

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
