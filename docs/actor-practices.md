# Emergent actor practices

CosyWorld does not ask an avatar to select an occupational role. Every legal
verb remains available from the same rules and world state, regardless of
which intelligence controls the avatar. A practice is a replay-derived
description of what an actor has repeatedly made true in the shared world.

## Durable deed contract

Only successful events with a durable public result can become deeds. Each
normalized deed records the actor and controller mode, category, source action
and resulting operation, rules profile and contributing pack, causal event
sequences, target, location, and a deterministic claim key.

The initial categories are `exploration`, `craft`, `delivery`, `stewardship`,
`care`, `mediation`, and `lore`. Attempts, movement loops, searches with no
discovery, aggregate scarcity changes, failed actions, and duplicate event
occurrences do not count. Repeating a meaningful deed does count: the source
event sequence is part of the claim key, making each occurrence idempotent
under journal replay without limiting an actor to one lifetime deed per
target.

Job events are decoded from the right so ids such as
`generated-place:42:current-need` and `world-delivery:1:2:res:5` retain their
full identity.

## Incremental evidence

Physical delivery evidence extends the canonical item-provenance projection.
Acquisition, gift, trade, theft, discovery, creation, drop, use, and movement
events update an item's current possession journey as each journal record is
applied. A delivery is recognized only when the same holder carried the real
item through a contiguous movement chain and gave, dropped, or used it at a
different location.

The active journey is stored in snapshots and deterministically rebuilt by
journal replay. Delivery never scans the capped recent-event feed, so more
than 512 later events cannot erase valid evidence. Both items in an atomic
trade begin new journeys with their post-trade holders.

## Projection

Practice uses the actor's latest 16 qualifying deeds. It is not established
until that window contains at least five deeds across at least three distinct
targets. An established primary changes only when a challenger leads it by
three deeds. A close second practice with at least three deeds can produce a
compound epithet.

The runtime maintains a bounded deed-id index per actor. Reads and practice
updates follow that index instead of cloning or scanning every deed in the
world. Snapshots persist both the deeds and index; older snapshots rebuild the
index once at load.

## Player-facing effect

An established practice supplies an epithet, a short “known for” sentence, and
inspectable evidence with source event sequences. It can influence narration
and ranking, but it never grants or removes verbs, changes action legality,
changes a check or DC, alters a cost, or creates an item. Calling remains a
separate player-authored aspiration: writing “Explorer” is intention, not
evidence.
