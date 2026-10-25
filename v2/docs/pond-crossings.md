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

A Greek ship appears at Black Pond when a fueled, lit, uncovered lamp is
physically there and no uncovered hand bell at either shore or clock bell
is audible. Custody by a resident counts only while that resident is at the
pond. Sound elsewhere does not block the ship.

One predicate selects the pond's ship layer, location-card art, current
location facts and boarding offer. Extinguishing or covering the lamp,
removing its carrier, or sounding a nearby bell removes the ship and offer.
Previously raised offers are checked again when played. The Greek harbor's
return remains available without the entry conditions.

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
