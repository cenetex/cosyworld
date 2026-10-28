# The Willows

A small card world based on Algernon Blackwood's 1907 story.

Source: [The Willows, original English text](https://www.gutenberg.org/files/11438/11438-h/11438-h.htm).
Project Gutenberg lists the original story as public domain in the USA.
The pack uses the original English passages and new art. Source passages
enter the Swede's knowledge on arrival and through recorded discoveries.
The exact source is in `source-text.txt`; `card-world.json` names each
passage and its reveal. Later passages become available as play reaches them.
The location and action descriptions connect the story to the game.

The locations tell the landscape's side of the story in first person.
The Swede is the one resident. The player joins him as a visiting companion.
The drowned man is a discovery in the bank scene.

## Play

Aboard the Greek ship, choose Visit the Willows. River mist beside the rail
leads to River Landing.
The island has a landing, a camp, a willow thicket and a crumbling bank.
At the landing, choose Return to the ship.

Examine the canoe and count the food. Study the sand hollows, listen at the
bank, and look beneath the roots. Greet the Swede, then compare the signs.
Choose to keep watch with him, or take the rope and sheet to the landing,
lay out the gear, set down the paddle, and choose the quiet way home.
The decisions and discoveries stay in the save.

The canoe, tent and fire are scenery. Carried objects use the normal custody
rules. Laying out gear records preparation for work on the canoe.
The marked corpse, the damaged paddle, missing bread and humming come from
Blackwood's story. The mist crossing, four-place map, visiting player,
discovery order and response choices are game adaptations.

## Art

Four painted scenes and the Swede portrait were made with the built-in
imagegen tool. The prompts are in `art-prompts.json`. The item icons extend
the game's simple SVG item style. Art lives in `v2/card-game/assets/willows/`.

## Checks

`test/card-willows.test.mjs` covers discovery, custody, old saves, the two
responses and shared play. The Rust Willows tests cover the released rules
upgrade and journal replay. `v2/scripts/smoke-card-willows.mjs` checks the
play path at desktop and phone sizes.
