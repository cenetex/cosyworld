# Black Pond crossings

The following applies to the browser-local card table, not the shared classic
world. Discovery remembers a place; current light and sound decide access.

## Forest Clearing

Two consecutive uncovered hand-bell rings at Black Pond still reveal the
clearing for three following plays. Entry requires that bell at the pond.
The return card is no longer permanent: it is present only while the hand
bell is audible at either shore, or the Steam Clock's own bell is sounding.

The clearing card's Choices menu offers **Ring the Steam Clock**. This
repeatable local action sounds the installed bell for three following plays.
It works without the hand bell and does not duplicate or relocate that item.
The clock wakes and irritates Badger. Its window survives reload and can be
refreshed by another ring. Silence hides the return card again.

## Greek ship

At quiet Black Pond, cover the lit Lamp with the Black cloth, uncover it,
then repeat the complete cycle once. The ship and boarding card appear
on the **second uncovering**, not merely when the lamp is lit.

Use **Black cloth + Lamp** to cover it and **Black cloth** to uncover it.
The four resolved transitions are saved. Inspection, reload, generated
speech and rejected actions cannot count as flashes. An unlit or already
covered lamp cannot fabricate a complete cycle. Partial signal phases have no progress text or bespoke reassurance cue.
Waiting between actions is allowed but consumes normal fuel.

Snuffing, running dry, leaving the pond, or sounding a nearby bell cancels
the signal. Restoring light or silence alone does not summon it again.
The variant, current facts and boarding offer share the same predicate.
The Greek harbor retains its return route without the entry lamp.

Legacy saves receive signal phase zero without resetting their stories.
Run the ritual regressions in test/card-ship-ritual.test.mjs alongside
card-crossings.test.mjs and the desktop/phone browser smoke.

## Scope and verification

The ship is a transparent reuse of the pack's existing harbor SVG geometry
over the existing pond image; this is an interim visual, not newly generated
painterly scenery. Camera, mirror, shoreline and base pixels do not change.
No atmosphere simulator or ten-backdrop scenery integration is included.

Saved schema 6 gains an optional validated clock deadline. Old saves acquire
a silent clock, without resetting inventory, residents, memories or branches.
Inspection and dialogue retries cannot advance windows.

Run `npx vitest run test/card-crossings.test.mjs` and
`node v2/scripts/smoke-card-pond-crossings.mjs` for model and desktop/phone
checks. The browser smoke uses fixture speech, not a paid model.
