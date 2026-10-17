# CosyWorld: avatars, items, and locations

Status: playable local slice. Updated October 17, 2026. The source findings and game references are in [the research notes](avatar-item-location-research.md).

CosyWorld is a whimsical cosmic horror world built from three kinds of thing: avatars, items, and locations. The player guides one avatar through card plays. Other avatars pursue their own aims. Cards make the world tangible. The scene shows what the cast notices, says, and does.

The purpose of play is to explore, experiment, and change a world that has a life of its own. Useful objects lead to strange places. Strange places reveal powers. Those powers affect the plans of people the player knows. The player chooses which possibilities matter.

## Three kinds of card

| Card     | What it represents            | What matters during play                                           |
| -------- | ----------------------------- | ------------------------------------------------------------------ |
| Avatar   | A particular living character | Where it is, what it wants, what it carries, and what it is doing. |
| Item     | A particular object           | Who holds it, its physical traits, its uses, and its history.      |
| Location | A particular place            | Its paths, contents, signs, and changing conditions.               |

Cards are views of persistent world entities. Picking up a cup moves that cup into the avatar's hand. Giving it away changes its holder. Breaking it changes the object. Entering a place reveals its occupants and things. The history follows the entity through each change.

The slice gives each avatar three carrying spaces. An attached cloth takes one space and moves with its covered object. The single bottom row shows carried items, nearby objects and avatars, reachable places, and the current place. Each item card shows its holder.

## One common action loop

**Raise a card or pair → play it → let the cast act → read the changed scene.**

The basic acts are moving to a linked place, moving an item, using an item, and speaking to an avatar. Inspection is free. Waiting advances a scene beat. Conflict uses the same bodies, items, positions, and consequences as other acts.

The player chooses Vale's next act by playing cards. Each card names its play. A raised pair shows the combined use. Another avatar's answer follows that avatar's own motives.

Tap a card to raise it, then tap it again to play it. Tap a second card to form a pair. Tap either raised card to play the pair. Dragging one card onto another forms a pair; dragging a card or raised pair onto the scene plays it. Tap the scene or press Escape to lower the cards. These choices are free until the play commits.

Keep visible cards tied to what the avatar can reach and knows about. Each known exit should be easy to inspect. A changing world can alter an available action; the new fact should explain the change.

## Build depth from a few shared rules

Ordinary properties should work across the world. Light reveals details. Sound gives listeners a source to seek. Containers carry things. Covering a light blocks it. An item power adds one clear exception, with a visible limit and signs that let the player learn it.

A strange law might say: “Light opens a path through marked reflections.” That can apply at a pond, a mirror, or a polished door. Moving a lamp changes the path. A moth seeking light can cross it. A keeper who wants darkness can close it. Each result follows the same small set of rules.

This is the source of the game's depth: a learned use works again, in a different place, around people with different aims.

## Construct situations

For the first test, use a small map with a loop. Give each location a purpose, an unusual condition, useful contents, and clues about nearby places. Give each avatar a concrete want and a current action. Let several wants touch the same object or path. This is one site template; later sites can use other shapes.

Run a few cast turns before the player arrives. Keep the results as footprints, moved objects, bargains, or damage. The opening scene then has activity to join and facts to investigate.

Generate the facts first: identities, paths, holders, powers, and plans. Then generate names, portraits, and short descriptions from them. New items draw their powers from the tested rule set. New places reuse that set in a different arrangement.

V1 offers three distinctive ideas to develop: seeking a named place, combining carried objects, and objects that remember their users. A generated relic can retain its source objects and remembered use. A place can recount events that happened there. Those memories should refer to recorded changes.

## Whimsical cosmic horror

Let character concerns be simple and specific. A moth wants light. A porter wants to finish a delivery. A collector wants a cup. Their world gives those wants strange consequences.

The horror comes from contact with something larger, a costly discovery, an altered body, or a power whose wider effects become clear through play. The whimsy comes from behavior, objects, and incongruous details. Show concrete signs and let the player choose their response.

Use short language on cards. Give an unusual item one clear power. Let its name and image carry more of the tone. The scene should make a changed fact or a character's next choice easy to understand.

## Play the slice

Run `npm run play:cards` from the repository, then open `http://127.0.0.1:4177/`.

The scene contains Vale, Pip, the keeper, three places, and four items. All world actions come from the cards in the bottom row. Each play gives the cast one act and burns one unit of fuel in a burning lamp.

| Cards                           | Play                                             |
| ------------------------------- | ------------------------------------------------ |
| Loose item                      | Take it                                          |
| Carried Lamp or Bell            | Light / put out the lamp, or ring the bell       |
| Item held by another avatar     | Ask for it                                       |
| Avatar                          | Hear what they want                              |
| Location                        | Travel there; the current location passes a turn |
| Carried item + current location | Put it down                                      |
| Carried item + another location | Carry it there                                   |
| Item + avatar                   | Give it, or ask its holder for it                |
| Oil flask + Lamp                | Add fuel                                         |
| Black cloth + Lamp / Bell       | Cover its light or sound                         |
| Attached Black cloth            | Uncover the object and take the cloth            |

Light at the mirror attic or black pond opens a reflected path between them. The lamp burns fuel while covered. Pip seeks light at the pond and fetches oil when fuel runs low. The keeper follows a ringing bell and carries it to the attic.

The card rules use the same ownership, reach, consent, and carrying limits as the cast. Local saves restore custody, fuel, cast plans, and history. A named URL such as `?table=playtest` creates a separate save slot.

## Scene and conversation

The location image fills the stage. Two character cutouts sit above a dialogue box. The two most recent local speakers keep stable left and right positions; the least recent speaker gives up a slot when a third person speaks. Avatars and locations appear as cards alongside items in one bottom row, with horizontal scrolling on phones. History opens separately. The arrow controls read earlier scene lines for free.

This follows the staging in Ruby High's `ruby2/visual-scene/VISUAL_LANGUAGE.md` and its painted scene mockups, inspected at `eec6ce23`. Ruby High separates world events, performance, and scene layout. The two-speaker rule is the current CosyWorld design. The cutouts and backgrounds are newly generated for this slice; [art prompts and files](https://github.com/cenetex/cosyworld/blob/main/v2/card-game/assets/PROVENANCE.md) record their source.

Original CosyWorld at `1f8b46bb` supplies the media path: `SceneCameraTool.mjs` gathered location and avatar references, while `VideoCameraTool.mjs` turned recent chat into a motion prompt. Its story service also kept ordered scene beats. The slice records stable event IDs, speakers, locations, acts, targets, local cast, object custody, and light. **History → Save scene script** exports those records with asset references and timing hints. The history holds up to 100 records. Earlier saves retain command records, and the export marks omitted records. Future image and video renderers can consume this script.

## Scope and status

The playable slice is a local browser game in `v2/card-game`. Its rules and cast run in a small deterministic model. It uses card combinations and state-based character lines. Generated backdrops and transparent cutouts establish the scene. The existing V2 runtime remains the foundation for a later shared-world version.

Validation covers item custody, capacity, shared action rules, independent goals, stale actions, card previews, save restore, 4,000 varied turns, speaker slots, historical cast, and scene exports. Browser checks cover single cards, card pairs, dragging, keyboard play, reflected travel, desktop and phone layouts, and reloads.
