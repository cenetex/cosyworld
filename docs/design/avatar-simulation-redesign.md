# CosyWorld: avatars, items, and locations

Status: research direction for review. Updated October 16, 2026. The source findings and game references are in [the research notes](avatar-item-location-research.md).

CosyWorld is a whimsical cosmic horror world built from three kinds of thing: avatars, items, and locations. The player guides one avatar's intentions. Other avatars pursue their own aims. Cards make the world tangible. Chat shows what the cast notices, says, and does.

The purpose of play is to explore, experiment, and change a world that has a life of its own. Useful objects lead to strange places. Strange places reveal powers. Those powers affect the plans of people the player knows. The player chooses which possibilities matter.

## Three kinds of card

| Card | What it represents | What matters during play |
| --- | --- | --- |
| Avatar | A particular living character | Where it is, what it wants, what it carries, and what it is doing. |
| Item | A particular object | Who holds it, its physical traits, its uses, and its history. |
| Location | A particular place | Its paths, contents, signs, and changing conditions. |

Cards are views of persistent world entities. Picking up a cup moves that cup into the avatar's hand. Giving it away changes its holder. Breaking it changes the object. Entering a place reveals its occupants and things. The history follows the entity through each change.

Start with V1's small inventory as a candidate: one held item and one stored item. Compare it with a small visible pack during playtests. Item custody and carrying space should stay easy to read.

## One common action loop

**Choose an aim → attempt an act with the things present → let the cast act → read the changed scene.**

The basic acts are moving to a linked place, moving an item, using an item, and speaking to an avatar. Inspection is free. Waiting advances a scene beat. Conflict uses the same bodies, items, positions, and consequences as other acts.

An intention gives the guided avatar a direction such as “find a way through that reflection.” The avatar can choose a useful next step from that aim. A card play can set a specific step. Its personality shapes its choices and speech. Another avatar's answer follows that avatar's own motives. A risky step shows its known stakes before commitment.

The interaction must expose the intended act. A knife beside an avatar might mean give, threaten, or attack. The research recommendation is a short choice attached to the selected cards, followed by the exact sentence to confirm. Chat can set the wider aim or propose another use. The research notes compare this with typed intent and direct card placement.

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

Use short language on cards. Give an unusual item one clear power. Let its name and image carry more of the tone. Chat should make a changed fact or a character's next choice easy to understand.

## The next slice

Use three linked places, the guided avatar, two independent avatars, and a handful of items. Give each item an ordinary use and give one item or place a strange power. The research notes contain a lamp, moth, keeper, and reflection arrangement for this purpose.

The player should be able to choose several aims from the visible situation. The guided avatar should take a useful step toward its stated aim. The cast should change an opportunity through its own actions. For example, a keeper seeking quiet could carry a ringing bell to another place. An object should support a useful interaction in two places. A saved visit should restore positions, custody, known uses, and remembered events.

Begin with a plain table and chat. Judge the rules through play before another visual design pass. A successful test produces these observations:

- A player predicts a useful interaction from the card's stated facts.
- The same rule works in a second place or with another suitable object.
- A player changes their plan because of an independent avatar's action.
- Different players pursue different aims in the same starting world.
- Players can explain one lasting change they caused.

## Scope and status

This PR records research and a proposed direction. Runtime work follows a small rules test. V2's saved entities, ownership checks, action validation, and replay are the likely foundations. The research notes distinguish active motive code from unfinished foundations.
