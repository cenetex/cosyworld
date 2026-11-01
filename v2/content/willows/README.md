# The Willows

A small card world based on Algernon Blackwood's 1907 story.

Source: [The Willows, original English text](https://www.gutenberg.org/files/11438/11438-h/11438-h.htm).
Project Gutenberg lists the original story as public domain in the USA.
The pack uses the original English passages and new art. The exact source
is in `source-text.txt`. Thirteen exact passages are kept as lore in
`lore/readings.json`, each with the discovery that once revealed it. They are
not given to any character's dialogue: the Swede and the places speak from the
world as it stands. A follow-up turns the passages into books and inscriptions
the player can find and read.
The location and action descriptions connect the story to the game.

The landing, camp and bank speak in the narrator's voice: each notices a change
and gives it an ordinary reason, and the reasons shorten and stop as recorded
discoveries pile up. The Swede is the one resident; as in the book he knows
early, says little and hushes anyone who names them. The player joins him as a
visiting companion.

## Play

Aboard the Greek ship on a misty night, at Black Pond or at sea between ports,
choose Visit the Willows. River mist beside the rail leads to River Landing. By
day, on a night without mist, or with the ship at any other port, the mist does
not rise and the card is not on the deck. No date changes this: after Halloween
as before, only night and mist open the way. The deck has its own sea weather
(`weather.json` region `sea`: mist, rain, mist, rain, mist, clear), so night and
mist at the deck meet for 36 turns in every 144 (turns 24-35, 72-83 and
120-131). A voyage lasts one world round, so the crossing at sea is a short
chance; stepping off at sea leaves the empty ship to finish its voyage. The
island has four places: the landing, the camp, the willow thicket and the
crumbling bank.

There are no story buttons. Observe (the Wait play) at a place to notice its
signs, one per Observe, in an order seeded by the run. By day: pacing out the
willows (camp). By night: pacing it again and the patterings on the tent
(camp), and the shapes over the willow tops (thicket). At any hour: the slit
hull (landing), the missing bread (camp, with the Food Sack there), the hollows
(thicket), the humming and the drowned man (bank), and, with the Swede at camp
after the hull, bread and roots, comparing the signs. Each sign keeps its flag,
so the Swede's poses follow it. A sign can be out of reach on a given visit.

The Willow Thicket is a live road (`road: [camp, bank]`), like the Greek
roads: a place to stand between the camp and the bank, with its own painting,
its own voice and its own signs. The camp and the bank join only through it.

The Swede's kit is scattered: the Worn Paddle, Waterproof Sheet, Tent Rope and
Food Sack. While all four are at the camp the canoe is mended: anyone may paddle
it between the landing and Black Pond, and the Swede leaves his camp as a
travelling resident (`stayUntil`). Carry one away and both wait again. For now
the sheet and sack lie at the landing and the paddle and rope at the bank; the
specials draw will scatter them across the other worlds. The pot, spoon, map and
pipe stay at the camp as lore objects, each inscribed with one short line from
the story.

Past the landing the island is never dry. The camp, the thicket and the bank
share one `willows` weather region (`v2/card-game/weather.json`): soft drizzle
under low mist, or heavy river mist, changing every twelve turns. The landing
keeps the open sky and time of day, so the boatman, the otter and the mended
canoe stay clear.

On the island the browser plays a quiet drone, the hum: two low detuned sine
waves with a faint harmonic and a slow swell, louder deeper in and at night. It
waits for a gesture, follows the music switch and volume, and falls silent for a
moment before a discovery (`v2/card-game/hum.mjs`).

The canoe, tent and fire are scenery. Carried objects use the normal custody
rules. The marked corpse, the damaged paddle, missing bread and humming come
from Blackwood's story. The mist crossing, three-place map, visiting player,
seeded sign order and scattered kit are game adaptations. Design:
[the kit and the signs](../../../docs/design/willows-kit-and-signs.md).

## Art

Four painted scenes and the Swede portrait were made with the built-in imagegen
tool. The prompts are in `art-prompts.json`. The eight transparent item
paintings were supplied by the owner on 2026-10-30, made with built-in image
generation; their prompts and source hashes are also in `art-prompts.json`. Art
lives in `v2/card-game/assets/willows/`.

River Landing and River Camp share the saved world clock with the Greek
places: every twenty-four accepted turns, day turns to night. At night the
camp shows its lit fire under a dark sky and the landing shows its night
painting; in dark mist the landing shows the Greek ship's lanterns in the
backwater instead. The thicket and the bank show their night paintings
through place `backdrops` with a `daylight` night condition (#1622). The ship and lit-camp paintings came from closed PR
#1293; their prompts are in `art-prompts.json`. The camp's fire-out painting
waits for the owner to choose its flag.

The uncanny flicker (`transitions.mjs`) runs at every Willows place all year,
not only on Halloween, with the same limits: one cut of 140 ms per entry at
most, a 40% chance, 30 seconds apart, no brightening, and none under reduced
motion or with Flashes and scares off.

## Design

[Making the Willows creepier](../../docs/card-table/willows-horror.md) holds the
planned horror pass: missing book motifs, a rewritten Swede, the hum and
accessibility rules.

## Checks

`test/card-hum.test.mjs` covers the drone. `test/card-willows.test.mjs` covers
Observed signs, the kit's return, the revision 2 upgrade, old saves and shared
play. The Rust Willows tests cover upgrades from released rules versions 16 and
17 and journal replay. Play the changed path by hand at desktop and phone sizes
with `npm run play:cards`.
