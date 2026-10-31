# The Willows: a scattered kit, Observed signs and the notebook

Status: in progress, 2026-10-31. Issues #1626, #1629, #1581, #1622, #1575.

## Outcome

The Willows has no story buttons. The island is three core places (landing,
camp, bank); the thicket becomes the way between camp and bank. Two generic
rules carry it, landed in two PRs:

- **Observe finds signs (this PR).** A pack choice marked `"on": "wait"` is a
  sign. A human's Observe (the Wait play) at that place commits one feasible
  sign, picked by a seeded hash of the run seed, place and receipt count. The
  sign's text is the World line in the place's own voice; its flag stays, so
  the Swede's poses still follow it. Day signs: otter, boatman, pacing. Night:
  patterings, shapes, pacing again. Any time: hull, stores (with the Food
  Sack at camp), hollows, humming, roots, and comparing the signs with the
  Swede. The receipts, ids and flags are unchanged, so saves need no upgrade.
- **A resident stays until (next PR).** `stayUntil` conditions free a
  resident that keeps to its scene. The Swede's are the Worn Paddle,
  Waterproof Sheet, Tent Rope and Food Sack all at the camp (`item_near`). The
  same four conditions open the mended canoe between the landing and Black
  Pond, for anyone. No flag records it: carry a kit item away and the canoe
  and the Swede wait again. That PR removes the depart-or-watch ending and
  the gear-laying chain (Willows revision 2, with a save upgrade), retires
  the thicket as a road, and keeps the pot, spoon, map and pipe as inscribed
  lore objects with one short line each from the readings.

## Next

1. Scatter the kit and the notebook pages across the other worlds with the
   specials draw (#1622): a pool entry may name `anchors` in other packs,
   picked per run.
2. The Traveller's Notebook: nine pages from the readings lore, three pages
   make a chapter card and three chapters make the book (#1629). Read in a
   client Read view; characters get facts about pages, never their text.
3. Sign paintings: each sign shows an alternate of its place's painting
   while it is the place's newest sign (#1620's place backdrops); no
   alternate means the base painting.
