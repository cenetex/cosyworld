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
imagegen tool. Eight painted item cutouts use true transparency. Four daylight
scene variants supply the base for changing light. The prompts and asset hashes
are in `art-prompts.json`. Art lives in `v2/card-game/assets/willows/`.

## Checks

`test/card-willows.test.mjs` covers discovery, custody, old saves, the two
responses and shared play. The Rust Willows tests cover upgrades from released
rules versions 16 and 17 and journal replay. `v2/scripts/smoke-card-willows.mjs` checks the
play path at desktop and phone sizes.

## Light and weather

All four places share the saved island clock. Dawn lasts eight accepted turns,
then day lasts sixteen, dusk lasts eight, and night lasts sixteen. The cycle
repeats after forty-eight turns. The scenes and place cards share the same light.
Cloud, rain, mist and clear weather change every twelve accepted turns. River
mist crosses the landing, rain taps the camp canvas, and leaves soften the
weather in the thicket. Place dialogue receives the current light and weather.
Reloads and shared views use that same saved turn.

## Music ideas

These four original track briefs are ready for composition. Each piece should
loop for about three minutes. Leave room for the river, wind and spoken words.
Use a shared, slow three-note figure to make the island feel like one place.

| Place          | Track idea                       | Sound and pace                                                                                                                                                                                                           |
| -------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| River Landing  | **The River Carries Everything** | 58 BPM. Low cello notes move under a small felt-piano figure. Soft water sounds and a faint bowed-metal tone suggest the river's scale. Let the last chord drift into the opening.                                       |
| River Camp     | **A Small Fire Between Us**      | 64 BPM. A warm, spare nylon-string guitar and felt piano sit close to the listener. A soft viola note enters at the edge of each phrase. Add quiet canvas taps and embers. Keep a little human warmth in the tune.       |
| Willow Thicket | **Leaves Against the Wind**      | 52 BPM. Breath-like flute fragments, brushed strings and dry leaf sounds move gently across the stereo field. Repeat the island figure with one note held slightly longer each time. Leave long spaces between phrases.  |
| Crumbling Bank | **The Hum Beneath the Sand**     | 44 BPM. A deep bowed double bass, glass harmonics and a quiet metallic hum rise beneath a thin high string note. Use slow swells that feel like pressure under the ground. Let the ending settle into the opening drone. |

At dawn, bring the upper notes forward. Day keeps the clearest version of each
tune. Dusk favours strings and longer gaps. Night gives the low notes more room.
Rain adds soft texture; mist softens the high notes. Keep the same tune at each
place as the sky changes.
