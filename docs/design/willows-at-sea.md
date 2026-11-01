# The Willows at sea

Status: built, 2026-10-31 (#1589; follows #1484 and #1535).

## Outcome

The Greek ship's crossing is weather. The deck has its own `sea` region in
`v2/card-game/weather.json`, cycling mist, rain, mist, rain, mist, clear
(twelve turns each). On a misty night the Willows crossing rises beside the
rail while the ship lies at Black Pond **or** sails between ports. By day, on
a night without mist, or at any other port, it does not. No date overrides
this rule; Halloween only touches presentation.

## Rules

The crossing pair in `v2/worlds/willows/card-bridge.json` uses generic pack
conditions only:

- `{ "kind": "daylight", "phase": "night" }`
- `{ "kind": "weather", "place": "greek-ship", "condition": "mist" }`
- `{ "kind": "any", "conditions": [ship_at pond, ship_at "@sea"] }`

`any` (two to four conditions, bounded like `not`) and the `ship_at` dock
`"@sea"` are new in the pack vocabulary, so this ships as a new shared rules
version. A voyage lasts one world round, so the crossing at sea is a short
chance. Stepping off at sea leaves the empty ship to finish its voyage; the
way back opens while the ship is at the pond or at sea in dark mist.

## Presentation

- The landing shows the ship (`landing-ship-night.webp`) under the same rule
  (`willowsMist` in `daylight.mjs`).
- On the island itself the camp, thicket and bank are always rainy or misty
  (the `willows` region in `weather.json`, owner direction 2026-10-31); the
  landing keeps ordinary weather. This is island weather, separate from the
  crossing's deck mist.
- The uncanny flicker is permanent at Willows places (`UNCANNY_PLACES` in
  `transitions.mjs`, client data outside the engine) and date-gated elsewhere,
  with every safety limit unchanged.
- Ship day art: the deck already resolves `ship-deck.webp` by day and
  `ship-deck-night.webp` at night. The owner's day painting replaces
  `v2/card-game/assets/greek-drama/ship-deck.webp`; no code changes.
