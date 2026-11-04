# Three links per place

Status: owner decision, 2026-11-01. First pack: Thebes (Greek revision 17).

## Rule

Every place has at most three links. Exits, roads, routes, crossings (even
while closed) and reflections all count. Boarding a ship counts as one link,
however many lanes the ship sails, and the ship itself has no cap. A place
`within` another, such as the Market Well in the Theban courtyard, links only
to its parent and does not count against it.

`test/card-map-rule.test.mjs` enforces the cap. Places still over it are
listed in `OVER_CAP_FOR_NOW` until their maps are redrawn; remove each one as
its pack lands.

## Thebes

The Hillside Sanctuary is reached through the Palace Forecourt instead of the
courtyard. The courtyard keeps the Harbor Road, the palace and the gate, plus
the well within it. A saved step between the courtyard and the sanctuary is
re-walked through the palace (`upgradeGreekThreeLinksSave`).

## The row (#2272)

The card row makes the cap a left-or-right choice. The current place leads
the row at the left, with the place the player came from face down beneath
it; tapping the current place fans that stack (and the things lying there),
and choosing the way back offers **Travel** back. The avatar, its two stacks
and the cast follow. The other ways on stack at the right end: the first
face up, the rest face down behind it, fanned by tapping it; a lone way is
chosen at the first tap. Normally that is two ways under the cap.

- With no way back (a new world, a fresh load, a one-way crossing), every way
  on goes in the right stack.
- At a dead end whose only way is back, there is no right stack.
- A place still in `OVER_CAP_FOR_NOW` puts all its other ways in the right
  stack.

"Came from" is presentation only (`cameFrom` in `app.mjs`): the player's
latest arrival in the log, or `world.arrival` once that entry is trimmed,
counted only while it arrived here and the place is still a way on. No rule
or bundle changes.

## Engine

The save upgrade lives in `legacy-saves.mjs`, which the shared bundle
imports, so this ships with the next rules version.
