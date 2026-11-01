# The Willows

A small card world based on Algernon Blackwood's 1907 story.

Source: [The Willows, original English text](https://www.gutenberg.org/files/11438/11438-h/11438-h.htm).
Project Gutenberg lists the original story as public domain in the USA.
The pack uses the original English passages and new art. Source passages
enter the Swede's knowledge on arrival and through recorded discoveries.
The exact source is in `source-text.txt`; `card-world.json` names each
passage and its reveal. Later passages become available as play reaches them.
The location and action descriptions connect the story to the game.

The landing, camp and bank speak in the narrator's voice: each notices a
change and gives it an ordinary reason, and the reasons shorten and stop as
recorded discoveries pile up. The thicket speaks as the willows, a plural
"we" that counts and gives no reasons. The Swede is the one resident; as in
the book he knows early, says little and hushes anyone who names them. The player joins him as a visiting companion.
The drowned man is a discovery in the bank scene.

## Play

Aboard the Greek ship on a misty night, at Black Pond or at sea between
ports, choose Visit the Willows. River mist beside the rail leads to River
Landing. By day, on a night without mist, or with the ship at any other port,
the mist does not rise and the card is not on the deck. No date changes this:
after Halloween as before, only night and mist open the way. The deck has its
own sea weather (`weather.json` region `sea`: mist, rain, mist, rain, mist,
clear), so night and mist at the deck meet for 36 turns in every 144 (turns
24-35, 72-83 and 120-131). A voyage lasts one world round, so the crossing at
sea is a short chance; stepping off at sea leaves the empty ship to finish
its voyage.
The island has a landing, a camp, a willow thicket and a crumbling bank.
At the landing, choose Return to the ship while the dark mist holds and the
ship lies at the pond or is at sea. The ship shows at the landing only then.
A traveller still on the island when the mist lifts, or when the ship docks
at another port, waits there until both hold again.

Examine the canoe and count the food. Study the sand hollows, listen at the
bank, and look beneath the roots. Greet the Swede, then compare the signs.
Choose to keep watch with him, or take the rope and sheet to the landing,
lay out the gear, set down the paddle, and choose the quiet way home.
Other discoveries stand alone: watch the otter (landing, by day), watch the
boatman (landing), pace out the willows (camp, by day) and pace it again
(camp, by night, once paced), lie still in the tent (camp, by night) and look
up at the willow tops (thicket, by night). A sign can be out of reach on a
given visit. The decisions and discoveries stay in the save.

On the island the browser plays a quiet drone, the hum: two low detuned sine
waves with a faint harmonic and a slow swell, louder deeper in and at night.
It waits for a gesture, follows the music switch and volume, and falls silent
for a moment before a discovery (`v2/card-game/hum.mjs`).

The canoe, tent and fire are scenery. Carried objects use the normal custody
rules. Laying out gear records preparation for work on the canoe.
The marked corpse, the damaged paddle, missing bread and humming come from
Blackwood's story. The mist crossing, four-place map, visiting player,
discovery order and response choices are game adaptations.

## Art

Four painted scenes and the Swede portrait were made with the built-in
imagegen tool. The prompts are in `art-prompts.json`. The eight transparent
item paintings were supplied by the owner on 2026-10-30, made with built-in
image generation; their prompts and source hashes are also in
`art-prompts.json`. Art lives in `v2/card-game/assets/willows/`.

River Landing and River Camp share the saved world clock with the Greek
places: every twenty-four accepted turns, day turns to night. At night the
landing shows the Greek ship's lanterns in the backwater and the camp shows
its lit fire under a dark sky. These two night paintings came from closed
PR #1293; their prompts are in `art-prompts.json`. The thicket and the bank
keep their single painting.

The uncanny flicker (`transitions.mjs`) runs at every Willows place all year,
not only on Halloween, with the same limits: one cut of 140 ms per entry at
most, a 40% chance, 30 seconds apart, no brightening, and none under reduced
motion or with Flashes and scares off.

## Design

[Making the Willows creepier](../../docs/card-table/willows-horror.md) holds the
planned horror pass: missing book motifs, a rewritten Swede, the hum and
accessibility rules.

## Checks

`test/card-hum.test.mjs` covers the drone. `test/card-willows.test.mjs` covers discovery, custody, old saves, the two
responses and shared play. The Rust Willows tests cover upgrades from released
rules versions 16 and 17 and journal replay. Play the changed path by hand at desktop and
phone sizes with `npm run play:cards`.
