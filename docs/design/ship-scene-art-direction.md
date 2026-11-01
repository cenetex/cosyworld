# Ship scene art direction

Status: proposed art plan, 2026-10-31. No new images or runtime changes are
included in this document. Reference audit: main `48dd0b84`.

## Direction

The ship is a familiar room that carries the player between worlds. Its
wood, sail, lamps, passengers and belongings remain recognizable while the
view beyond the rail changes. Give departure, open water and arrival clear
visual differences without adding a loading sequence or extending the voyage.

Use the current onboard night painting as the composition reference:
[ship-deck-night.webp](../../v2/card-game/assets/greek-drama/ship-deck-night.webp).
The request for a daylight counterpart is interpreted as this onboard view.
The Willows ship-at-landing painting is a separate shore-view composition.

## What the current art and rules already provide

The default [ship-deck.webp](../../v2/card-game/assets/greek-drama/ship-deck.webp)
is twilight: stars, a rosy horizon and lit lanterns. Its
[original prompt](../../v2/card-game/assets/greek-drama/scenery-prompts.json)
explicitly requests twilight. The
[night-edit record](../../v2/card-game/assets/greek-drama/attica-night-provenance.json)
preserves the same wooded mountain coastlines. Neither image is a true day
scene or a view without land.

[Transport state](../../v2/card-game/pack-transport.mjs) already distinguishes
`docked`, `course`, `sea` and `arrived`; boarding alone does not mean sailing.
[Voyage tests](../../test/card-ship-voyage.test.mjs) establish a full world round
at sea and prevent ordinary port boarding or disembarking during that phase.
The [Willows mist crossing](willows-at-sea.md) is an explicit exception.
Scenery in
[scene.mjs](../../v2/card-game/scene.mjs) and
[daylight.mjs](../../v2/card-game/daylight.mjs) currently chooses the same
coastal deck by time of day, without a sea-phase painting.

| Voyage phase | Intended view beyond the rail                                           |
| ------------ | ----------------------------------------------------------------------- |
| `docked`     | The current port or its shore                                           |
| `course`     | The departure shore; the course is chosen but the ship has not cast off |
| `sea`        | Open sea and sky, with no land in sight                                 |
| `arrived`    | The destination shore                                                   |

The existing [voyage design](ship-voyages-and-scattered-things.md) already
makes the deck a place for Talk, travel companions and carried things. This
art plan supports that behaviour; it does not add transport rules.

## First deliverables

These are proposed deliverables, not assets supplied by this design PR.
The [Willows-at-sea handoff](willows-at-sea.md) expects the true day painting
at the existing day path. On publication, preserve the current twilight
painting as `ship-deck-twilight.webp` with its provenance; keep the existing
coastal-night file.

| File under `assets/greek-drama/`   | Art direction                                                                                                                                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ship-deck.webp` (day replacement) | Exact-camera daylight companion to the current night scene, retaining its coast. Warm worn wood, ivory sail, blue-green water and airy natural light. The two lantern fixtures remain but are unlit. |
| `ship-deck-at-sea-day.webp`        | The same daylight ship and camera. Uninterrupted water and sky replace every island, ridge, bank and shore light. Restrained swell and a clear horizon make the crossing readable.                   |
| `ship-deck-at-sea-night.webp`      | The same open-water composition in deep indigo and silver. The existing two lamps make small amber pools on the deck. The ocean feels expansive while the vessel remains close and protective.       |

All three use the full **1672 x 941** canvas. Lock the left mast, sail,
rigging, rope coils, planks, rails, carved prow, lamp fittings, camera and
perspective. Keep the central standing space open and the bottom quarter
quiet for the cast, dialogue and cards. Confirm the centered phone crop.

Use the existing painted finish and material detail. Daylight should reveal
the wood and linen without becoming glossy or bleaching the scene. Night
must remain legible around the cast. Preserve the existing off-canvas light
direction instead of adding a moon that contradicts the deck highlights.

No people, readable text, extra ships, destination landmarks or fixed weather
effects in the open-sea set. No low banks disguised as fog. From this
forward-facing camera a stern wake must not appear ahead of the bow; any
movement cue belongs in the water beside the hull. Retain the modest Greek
vessel's identity rather than blending the different existing harbor ships.

## Layer the source art first

Prove one night composition before building a larger asset family. Extract
the existing ship foreground and pair it with one clean open-sea night
plate. If the extraction cannot preserve the rigging, silhouette and camera
cleanly, use exact-reference flat edits for the three deliverables instead
of repeatedly repainting an unreliable cutout.

| Source layer                  | Contents                                                                                               | Keep out                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Environment                   | Sky, water, distant shore when applicable, light reflected on the water                                | Ship, passengers, interface                                      |
| Ship foreground               | Deck, mast, sail, all ropes, rails, prow, cargo corner, both lamp fixtures and their light on the ship | Sky, land, water beyond the rail                                 |
| Water contact, only if needed | Local foam, hull disturbance or lamp glints beside the vessel                                          | Large wake in front of the bow or a complete exterior reflection |

Give the ship foreground matching **day and night light treatments**. A
generic dark tint cannot reproduce amber lamp pools and silver sail edges.
Both versions must retain the same geometry. Preserve true transparency in
every opening around the rigging and above the rails.

Keep every layer at the full canvas size and origin; do not trim, recenter
or independently scale it. Record horizon height, light direction, lamp
positions and the clear standing area alongside the prompt. The horizon is
roughly two-fifths down the current image; the reference determines its exact
position. A future ship is painted into this camera contract.

The initial runtime deliverables can remain complete WebPs assembled from
these sources. Source layers provide reuse even before runtime composition
changes. Check the layer proof at 1440 and 390 px on light and dark backings:
no sky fringe on rope edges, holes in wood, cropped rigging, halo around
lanterns or change in the ship's position.

## Runtime scope when the art is accepted

The client already draws a backdrop and one optional transparent overlay in
[app.mjs](../../v2/card-game/app.mjs); place cards can also draw that overlay.
[style.css](../../v2/card-game/style.css) gives those layers the same crop.
That is sufficient for an environment plate plus the ship foreground. Start
there if live composition is useful; a general scene graph is unnecessary.

Keep the existing `ship-card.webp` portrait unchanged initially. Apply the
deck composition to the stage. A future state-aware card thumbnail needs
the matching environment and deck composed together; the generic overlay
must not put an onboard deck on top of the existing exterior ship portrait.

Resolve voyage phase and day/night together, using the existing `shipAtSea`
helper. The existing generic night
replacement must not overwrite an at-sea choice with the coastal night
painting. Use saved transport state, not a timer or the mere presence of a
passenger. Keep stage, place card and preloads consistent. Change the pair
together so a night deck does not briefly appear over a daytime ocean.

Keep existing weather rendering separate. The ship now has its own
[sea weather cycle](../../v2/card-game/weather.json). Mist can veil the sea
without being baked into every ship image. The special Willows crossing can
open in dark mist at Black Pond or at sea. Preserve that condition; do not
paint its island permanently into the sea-night image or imply that every
night voyage opens it. Any future island apparition is a conditional layer.

Do not move the whole deck against stationary characters to imply sailing.
If motion is later added, keep people and ship anchored together and prefer
subtle water or sail movement. Reduced motion should preserve all phase
information in still images.

One ship layer below the cast is enough initially. Add a separate foreground
rail or rigging occluder only when a real scene requires a character to pass
behind it. A common composition and clear standing area avoid that cost now.

Layering can reduce repeated downloads when a ship is reused, but two full
canvases also cost more decoded memory than one. Measure the total visible
scene payload. Keep the usual full-size WebP budget of about 300 KB per
export and generate the official 512 px card variants. Phone stages currently
request the stage image; verify the actual phone request and total payload.
Smaller phone-stage selection, if needed, is a separate presentation change.
Do not assume that layering alone improves performance.

## Exterior ships are a separate asset family

The [pond overlay](../../v2/card-game/assets/greek-drama/pond-ship-overlay.png)
contains the ship **and its reflection**, positioned for Black Pond. Its
[provenance](../../v2/card-game/assets/greek-drama/scenery-provenance.json)
records masking and a 300-pixel shift; its 1672 x 940 canvas also differs
from the scenery standard. It is useful precedent, not the onboard cutout.

The Wine-Dark Harbor, Athens Harbor and Piraeus already have occupied and
empty berth art by day and night. Keep those paintings for this batch.
Future exterior layers need compatible camera angles, a clean hull/sail
layer, water-specific reflection and contact, and shore objects in front
where quays or reeds hide the hull. Mooring lines and furled sails are docked
states. Do not carry a dock reflection or mooring rope into open sea.

Existing exterior paintings vary in hull shape and details. Decide the
vessel's identity sheet before commissioning new exterior angles: silhouette,
curled prow, timber, sail, fittings and lamps. The onboard reference remains
authoritative for the three requested deck scenes.

A cosmetic ship appearance and an independently moving ship are different
features. A new appearance can share the same voyage state. A second vessel
needs its own transport and deck location, as required by the current
[pack schema](../../v2/card-game/pack-schema.mjs), so its passengers and
position remain separate. This art plan introduces neither save state nor
a second transport.

## The next idea to prioritize

After the open-water pair, paint **arrival views from aboard**. Seeing Black
Pond's shore or a Greek harbor beyond the same familiar rail makes a journey
feel completed. Use recognizable landmarks from those locations, redrawn
for the onboard camera rather than stretching the existing shore view.
The first useful pair is Black Pond and the Wine-Dark Harbor.

The ship can later acquire small, persistent signs of journeys: a repaired
sail patch, a gift tied beside a lantern, or a keepsake in the cargo corner.
These are proposed art hooks, not current mechanics. They should follow real
world state so objects do not appear twice or remain painted in after being
given away. The familiar vessel could gradually become a shared home.

For a more uncanny crossing, the water or distant sky could be the first
part of a new world to appear while the ship stays familiar. Treat that as
an authored transition, with a clear phase rule, rather than random scenery.
The immediate no-land mid-trip images should stay simple.

## Production order and handoff

1. Review the exact onboard reference and the three briefs above.
2. Make one night foreground/open-sea layer proof and inspect the phone crop.
3. On a successful proof, establish matching day/night ship masters and
   environment plates, then export the three requested complete paintings.
   Otherwise make exact-reference flat variants and retain the layer plan.
4. Publish art, optimized variants, full prompts, generation/reference hashes
   and any extraction limitations in an asset PR. Keep it below the change
   budget and avoid shared-rules edits.
5. Wire the accepted phase/time combinations in a focused follow-up. Verify
   the current engine import graph and rebuild affected generated bundles;
   do not change voyage timing or legality for an art feature.
6. Add arrival plates, then another ship design only when the first template
   has proved useful. Keep exterior berth extraction a separate task.

Acceptance: matched canvas/camera, no land in either sea view, correct lamp
states, clear cast space, stable stage/card crop, crisp alpha where used,
mobile image budget, provenance and desktop/phone review. The wiring check
must cover all four voyage phases in both light states, save reload at sea,
and the existing special crossing without changing travel rules.
