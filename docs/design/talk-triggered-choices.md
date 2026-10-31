# Talk-triggered pack choices

Status: design, 2026-10-31. Issue #1581.

## Outcome

A pack choice can fire from a fixed Talk instead of a named button. "Stay for
tea" is the first one: a human traveler's Talk with RATi in the cottage, once
they have met her, commits `forest-stay-for-tea` and sets `forest-welcomed`.
No tea button appears.

## Rule

`"on": "talk"` mirrors `"on": "give"`. The choice's subject must be a pack
person. When a traveler under human control plays Talk with that subject, the
rules look for the first feasible `on: "talk"` choice with that subject: the
traveler stands at the choice's place, its requirements hold and it has no
receipt. The play then applies it, the choice text becomes the Talk's World
line, and the receipt holds the Talk's turn. A resident's Talk never commits
it. Such a choice is never offered as a `choose` action, so old `choose`
receipts for it still replay and new ones cannot be played.

The choice commits at the play. It does not wait for the AI line.

## Engine

This changes `world.mjs`, `pack-registry.mjs` and `pack-schema.mjs`, so it
mints the next rules version. Released bundles keep replaying their own
journals. A world upgraded onto the new rules keeps its receipts; a traveler
who already chose tea keeps the welcome.
