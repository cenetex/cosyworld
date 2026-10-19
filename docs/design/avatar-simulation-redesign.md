# CosyWorld: avatars, items, and locations

Status: playable local slice. Updated October 17, 2026. The source findings and game references are in [the research notes](avatar-item-location-research.md).

The general rules here (custody, reach, exchange, target hands, consent, the cast planner, and the quest generator) are the core. The first site's places, avatars, item powers, light-gated path, and authored quest programs are generated scaffolding. [ADR 0015](../decisions/0015-a-generated-world-seen-through-cards.md) makes the core a generated world and story an optional layer. [Generated world core](../backlog/generated-world-core.md) plans removing the scripted layer.

CosyWorld is a whimsical cosmic horror world built from three kinds of thing: avatars, items, and locations. The player guides one avatar through card plays. Other avatars pursue their own target hands. Cards make the world tangible. The scene shows what the cast notices, says, and does.

The purpose of play is to explore, experiment, and change a world that has a life of its own. Useful objects lead to strange places. Strange places reveal powers. Those powers affect the plans of people the player knows. The player chooses which possibilities matter.

## Three kinds of card

| Card     | What it represents            | What matters during play                                           |
| -------- | ----------------------------- | ------------------------------------------------------------------ |
| Avatar   | A particular living character | Where it is, what it wants, what it carries, and what it is doing. |
| Item     | A particular object           | Who holds it, its physical traits, its uses, and its history.      |
| Location | A particular place            | Its paths, contents, signs, and changing conditions.               |

Cards are views of persistent world entities. Picking up a cup moves that cup into the avatar's hand. Giving it away changes its holder. Breaking it changes the object. Entering a place reveals its occupants and things. The history follows the entity through each change.

The slice gives each avatar three carrying spaces. Vale has an avatar card in the hand, with the current quest step and level. An attached cloth takes one space and moves with its covered object. The single bottom row shows carried items, nearby objects and avatars, reachable places, and the current place. Each item card shows its holder.

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

Each room has two music tracks that play in turn. Music starts with the first
tap or key press and follows Vale between rooms. Menu has a music switch and
volume control; the browser saves both settings. Music pauses while the tab is
hidden and resumes when the player returns. Track sources are listed in
`v2/card-game/assets/music/PROVENANCE.md`.

Room changes fade the current song to silence over one second, then start the
next song with a one-second fade in. Pausing and resuming use the same fades.
Each song also fades during its final second. Volume changes ease into the new
level, and quick room changes follow the latest selected room.

The scene contains Vale, Pip, the keeper, three places, and four items. All world actions come from the cards in the bottom row. Each play gives the cast one act and burns one unit of fuel in a burning lamp.

| Cards                             | Play                                             |
| --------------------------------- | ------------------------------------------------ |
| Loose item                        | Take it                                          |
| Carried Lamp or Bell              | Light / put out the lamp, or ring the bell       |
| Item held by another avatar       | Ask for it                                       |
| Avatar                            | Hear what they want; Vale passes a turn          |
| Location                          | Travel there; the current location passes a turn |
| Carried item + current location   | Put it down                                      |
| Carried item + another location   | Carry it there                                   |
| Item + avatar                     | Give it, or ask its holder for it                |
| Your item + another avatar’s item | Trade both items in one play                     |
| Oil flask + Lamp                  | Add fuel                                         |
| Black cloth + Lamp / Bell         | Cover its light or sound                         |
| Attached Black cloth              | Uncover the object and take the cloth            |

Light at the mirror attic or black pond opens a reflected path between them. The lamp burns fuel while covered. Pip begins with the cloth and seeks the lamp at the pond with Vale. The keeper begins with the oil and seeks the bell in the attic with Vale. Their next quest hands change what they seek and offer.

The card rules use the same ownership, reach, consent, and carrying limits as the cast. Local saves restore custody, fuel, quest steps, earned levels, and history. Earlier saves retain their world and begin the new quest programs at level 1. A named URL such as `?table=playtest` creates a separate save slot.

## Desires are target hands

A target hand has three parts: `items`, `location`, and `avatars`. It is met when the avatar holds every named item, stands in the named place, and shares that place with every named avatar at the same moment. Extra items and people are welcome. An empty item or avatar list leaves that part open; a `null` location allows any place. An attached cloth counts as carried by its object's holder.

The avatar cards show **Hold / At / With**, with checks for each part that is true. They also show the active program, step, level, and spare items on offer. **Menu** lists Vale's full programs.

Quest programs are ordered target hands in `v2/card-game/quests.mjs`. Each completed hand advances one step. The final hand earns one level and opens the next program. The opening gives each avatar two authored programs. From level 3, each completed program creates another from current item holders, spare items, companions, and reachable paths. Levels keep increasing. Each program is saved when created, so reloads preserve its goals.

Programs use small reusable builders in `quests.mjs`:

```js
const lampHand = hand(hold("lamp"), withAvatars("moth"));
const journey = sequence(
  hand(lampHand, at("station")),
  either(hand(lampHand, at("pond")), hand(lampHand, at("attic"))),
);
const program = sequence(journey, carryTo(["lamp", "bell"], "station"));
```

`hand` combines item, place, and avatar parts. `sequence` joins hands, fragments, and whole programs in order. `either` lets any listed hand complete one step. `meet` and `carryTo` are reusable fragments made from those parts. The cast chooses a useful current alternative; the player can fulfill any alternative. The menu shows the choices for Vale and the cast.

Generated programs combine gathering an item or a payment, meeting another avatar, and carrying the item to another reachable place. Higher levels can include a second carried item. Recent items help vary later programs. The cast follows payment needs through the same item rules, so it can obtain something to trade for its goal. A cast member revisits a generated goal after twelve turns without a completed step. It keeps its completed prefix and chooses unfinished steps from the current world. These revised goals use items the cast can seek while Vale keeps carried items. New programs also create regular chances to trade with Vale. Vale keeps the selected program until completion.

Programs are chosen one avatar at a time, and each choice reads the programs chosen before it. A new cast goal never keeps an item that another avatar's current hand needs, so that item stays free to trade or give. After twenty-four turns without a completed hand, a cast member sets the bargain aside for an errand: carry its free items to another reachable place, alone. It can always finish an errand, and holding its own items again makes it willing to give spares.

Completion is saved once. Saves retain the current program, total completed hands, and the last 32 completion turns. The last four generated item goals help vary choices. Older completed saves keep their levels and receive a new program. Quest records include the exact program and chosen target, so later changes preserve the meaning of earlier awards.

A hand can be completed between cast acts. The round records the matching items, place, and people as proof, then advances programs after every actor has acted. Each avatar advances at most one step in a turn. This preserves a completed meeting when someone leaves later in that turn.

The cast plans from these same target hands. It seeks missing items, makes useful trades, asks holders, makes carrying room, travels to the target place, and waits for its companions. When an avatar can make no progress of its own, it goes to anyone who holds a whole hand somewhere else and waits only for it. It stays while Vale is beside it holding an item it wants, since the player may hand that item over. When two avatars each hold a hand and wait for the other, the later one in cast order goes, so the cast always comes to Vale. Avatars keep items required by their current hand. They offer spare items in exchange for missing ones. Once they hold the required items, they can give a spare item when asked. After Vale has gone twenty-four turns without completing a hand, the cast gives Vale spares even before its own items are in hand. Trades between cast members follow these rules too. Vale's exchanges come from the player's card plays.

A trade uses two item cards: one held by Vale and one held by a nearby avatar. Both holders change in the same play. Covers travel with their objects, and both carrying limits apply after the swap. Pairing an item with an avatar remains a gift. The card preview names both sides of an exchange.

One opening route is to take the lamp and bell, trade the bell for the keeper's oil, and meet the keeper in the attic. At the pond, trade the lamp for Pip's cloth. This completes Vale's first program. Pip then wants the oil, and the keeper wants the cloth. Those new desires create the next bargains.

## Scene and conversation

The location image fills the stage. Two character cutouts sit above a dialogue box. The two most recent local speakers keep stable left and right positions; the least recent speaker gives up a slot when a third person speaks. Avatars and locations appear as cards alongside items in one bottom row, with horizontal scrolling on phones. History opens separately. The arrow controls read earlier scene lines for free.

This follows the staging in Ruby High's `ruby2/visual-scene/VISUAL_LANGUAGE.md` and its painted scene mockups, inspected at `eec6ce23`. Ruby High separates world events, performance, and scene layout. The two-speaker rule is the current CosyWorld design. The cutouts and backgrounds are newly generated for this slice; [art prompts and files](https://github.com/cenetex/cosyworld/blob/main/v2/card-game/assets/PROVENANCE.md) record their source.

Original CosyWorld at `1f8b46bb` supplies the media path: `SceneCameraTool.mjs` gathered location and avatar references, while `VideoCameraTool.mjs` turned recent chat into a motion prompt. Its story service also kept ordered scene beats. The slice records stable event IDs, speakers, locations, acts, both sides of trades, local cast, object custody, light, and fulfilled quest hands. **History → Save scene script** exports those records with asset references and timing hints. The history holds up to 100 records. Earlier saves retain command records, and the export marks omitted records. Future image and video renderers can consume this script.

## Scope and status

The playable slice is a local browser game in `v2/card-game`. Its rules and cast run in a small deterministic model. It uses card combinations and state-based character lines. Generated backdrops and transparent cutouts establish the scene. The existing V2 runtime remains the foundation for a later shared-world version.

Validation covers item custody, capacity, shared action rules, target hands, quest order and levels, cast trades, player consent, stale actions, card previews, save migration and restore, 4,000 varied turns, liveness after long loose play, speaker slots, historical cast, and scene exports. Browser checks cover single cards, card pairs, dragging, keyboard play, reflected travel, desktop and phone layouts, and reloads.
