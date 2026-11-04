# Three links per place

Status: owner decision, 2026-11-01. First pack: Thebes (Greek revision 17).

## Rule

Every place has at most three links. Exits, roads, routes, crossings (even
while closed) and reflections all count. Boarding a ship counts as one link,
however many lanes the ship sails, and the ship itself has no cap. A place
`within` another, such as a house in a quarter, links only
to its parent and does not count against it.

`test/card-map-rule.test.mjs` enforces the cap. Places still over it are
listed in `OVER_CAP_FOR_NOW` until their maps are redrawn; remove each one as
its pack lands.

## Thebes

The Hillside Sanctuary is reached through the Palace Forecourt instead of the
courtyard. The courtyard keeps the Harbor Road, the palace and the gate, plus
the well within it. A saved step between the courtyard and the sanctuary is
re-walked through the palace (`upgradeGreekThreeLinksSave`).

Greek revision 19 (#2264) reaches the Palace Forecourt through the Market
Well. The well leaves the courtyard's interior and links to the courtyard
and the forecourt; the courtyard keeps the Harbor Road, the well and the
gate. Thebes stays five places with at most three links each. A saved step
between the courtyard and the forecourt is re-walked through the well
(`upgradeGreekForecourtSave`).

## Engine

The save upgrade lives in `legacy-saves.mjs`, which the shared bundle
imports, so this ships with the next rules version.
