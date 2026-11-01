# The Willows: a scattered kit, signs found by waiting and the notebook

Status: in progress, 2026-10-31. Issues #1626, #1629, #1581, #1622, #1575.

## Outcome

The Willows has no story buttons. The willow thicket stays a live road between
camp and bank (`road: [camp, bank]`), a place to stand like the Greek roads.
Two generic rules carry it, in steps:

- **Wait finds signs (step 1, #1640).** A pack choice marked `"on": "wait"`
  is a sign. A human's Wait (the `wait` play) at that place commits one
  feasible sign, picked by a seeded hash of the run seed, place and receipt
  count. The sign's text is the World line in the place's own voice; its flag
  stays, so the Swede's poses still follow it. Day signs: otter, boatman,
  pacing. Night: patterings, shapes, pacing again. Any time: hull, stores (with
  the Food Sack at camp), hollows, humming, roots, and comparing the signs with
  the Swede. Step 2 retires the otter and boatman signs (see step 4).
- **A resident stays until (step 2).** `stayUntil` conditions free a resident
  that keeps to its scene. The Swede's are the Worn Paddle, Waterproof Sheet,
  Tent Rope and Food Sack all at the camp (`item_near`). The same four
  conditions open the mended canoe between the landing and Black Pond, for
  anyone. No flag records it: carry a kit item away and the canoe and the Swede
  wait again. The Swede no longer values the kit, so he does not carry it off
  himself.
- **A resident leaves the world (step 3).** A pack choice marked
  `"on": "depart"` commits when its subject, a resident, takes a crossing out of
  its `at` place. Its flag hides the resident through its own `requires`, so it
  is gone from the run: no cast, plays or wants, and the save, journal and
  shared views keep its record. The validator accepts a disabled resident that
  holds such a receipt. When the Swede paddles off, his flag also closes the
  canoe crossings: he took the canoe. No fallback brings him back.
- **Random landing paintings (step 4, after #1620).** The otter and the man in
  the boat are no longer signs. They are alternates of the landing painting that
  appear at random: a `chance` condition hashes the run seed and the turn, so
  every table agrees, at low odds for a short window. The boatman also needs
  daylight. No flag, no order, no trigger.

The depart-or-watch ending and the gear-laying chain are gone. The pot, spoon,
map and pipe stay as inscribed lore objects, each with one short line from the
readings.

## Saves

Step 1 keeps every id, receipt and flag. Step 2 is Willows revision 2. Step 3
adds receipts only. `upgradeWillowsKitSave` removes the retired choices'
receipts, flags and journal lines and the `willows-response` group. Kit still
lying where revision 1 put it moves to its new place (sheet and sack at the
landing, paddle and rope at the bank). Anyone in the thicket stays there.

## Next

1. Scatter the kit and the notebook pages across the other worlds with the
   specials draw (#1622): a pool entry may name `anchors` in other packs, picked
   per run.
2. The Traveller's Notebook: nine pages from the readings lore, three pages make
   a chapter card and three chapters make the book (#1629). Read in a client
   Read view; characters get facts about pages, never their text.
3. Sign paintings: each sign shows an alternate of its place's painting while it
   is the place's newest sign (#1620's place backdrops); no alternate means the
   base painting. The hollows and the bronze shapes are thicket signs, so their
   paintings (`thicket-hollows`, `thicket-bronze`) are thicket backdrops.
