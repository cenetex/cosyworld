# Authored story quests

A card pack can declare its story cards in `card-world.json` under
`storyQuests`. The shared story engine reads these definitions for every
mounted pack. The pack's choices supply the deeds, branches and object rules.

Each story has a short line, a holder, art, a start rule and one or more
endings. Each ending names a choice receipt. A saved receipt makes that
ending complete. The quest registry keeps its people, place and outcome.

```json
{
  "storyQuests": [
    {
      "id": "story-quest-orchard-help",
      "line": "The harvest needs a pair of hands.",
      "holder": { "kind": "avatar", "id": "orchard-host" },
      "art": "orchard-basket",
      "start": { "kind": "receipt", "choice": "orchard-ask" },
      "progress": ["orchard-prepare"],
      "endings": [
        { "choice": "orchard-accept" },
        { "choice": "orchard-decline", "outcome": "Declined" }
      ]
    }
  ]
}
```

The pack also declares the named characters, place, item and choices. Their
IDs must exist. `art` names a character, place or item from the pack or hub.

## Identity and outcomes

`id` identifies the card family. The saved quest key is `<pack>:<id>`.
An optional `key` supplies a distinct local key, such as
`story-quest-orchard-return:gate`. Several cards may share a family ID while
each keeps its own key. Keys stay stable across releases.
Card family IDs stay unique across packs. Cards within one pack may share a
family ID while each keeps its own saved key.

`outcome` defaults to `Fulfilled`. An ending can supply its own outcome.
The supported outcomes are `Fulfilled`, `Declined`, `Reported` and `Shared`.
`defaultEnding` chooses the ending shown while a story is pending.
`endingOrder: "earliest"` keeps the first earned ending when several reports
can finish the same story. The default order follows the authored list.

Each ending may have a `when` rule. This selects the endings that match the
world's chosen branch. `when` on the story controls when that card applies.
`historicalWhen` moves a card to history while a later card carries the next
request. These fields preserve the Greek permission report and later grave
report as distinct records.

## Saved requirements

`start`, `when`, `historicalWhen` and an ending's `when` use these rules:

| Rule                                                                    | Evidence                                            |
| ----------------------------------------------------------------------- | --------------------------------------------------- |
| `{"kind":"receipt","choice":"orchard-ask"}`                             | That choice has a saved receipt.                    |
| `{"kind":"met","actor":"orchard-host"}`                                 | The pack records a meeting with that character.     |
| `{"kind":"flag","key":"orchard-ready","value":true}`                    | A lasting flag is set.                              |
| `{"kind":"choice","key":"orchard-answer","value":"help"}`               | The world chose that branch.                        |
| `{"kind":"choice_set","key":"orchard-answer"}`                          | The world chose a value for that branch.            |
| `{"kind":"quest","key":"story-quest-orchard-help","status":"resolved"}` | The named story has resolved. `started` also works. |

Combine rules with `{"all":[...]}` or `{"any":[...]}`. Each list has at least
one rule. Story requirements use lasting world evidence. A flag used here
has a true value and its authored effects preserve that value. Quest
references stay within the pack; their dependency graph must have a clear
start. Validation checks every reference and rejects cycles.

`progress` names choice actions that belong to the story. Each action's own
`requires` controls its order. A card is pending until an ending is earned.

Personal knowledge belongs in an action's requirements. For example,
`{"kind":"knows","topic":"orchard-news","role":"actor"}` lets an avatar
use an action after learning that topic. The action's receipt can then
start a shared story with a stable world identity.

## Time and participation

The default creation turn is the earliest saved evidence from the start,
progress and ending actions. An optional `created` rule can choose an exact
source. Its leaves are `receipt`, `met`, `choice` with a branch key, or
`quest` with a local quest key. Combine sources with `first`, `earliest` or
`latest`. `first` uses the first available source in the authored order.

Participation normally follows start receipts, progress actions and endings.
`related` may name an exact action list. It may also be `ending` or
`start-and-ending`. These options let a return report keep its own people.
The registry preserves participants and saved authors through later visits.

`group` supplies a short author label. The existing Open Door and homecoming
module exports read their groups as compatibility views. `keyedCard` keeps
several cards in one family distinct in the card view.

## Talk topics

`topics` is a list of short facts a named character can share at a place.
Each entry has `id`, `speaker`, `at`, `text` and optional `requires` and
`choiceId`. The text is one complete sentence of at most 180 characters.
Topic IDs are unique across every mounted pack. The mounted catalog supports
128 authored topics, with room for witnessed events in the knowledge store.
Third-person wording keeps its subject clear when another character retells
the fact. Requirements use the common pack condition vocabulary.

`choiceId` links the topic to an existing authored scene. Its speaker and
place match that choice. The original choice keeps its ID and saved effects.
Each avatar's learned topics stay separate from the world's choice receipts.

Build the compiled catalog with
`node v2/scripts/build-card-worldpacks.mjs`. Run
`npx vitest run test/card-pack-story-quests.test.mjs` for the generic pack,
branch, requirement and topic validation checks. The Greek story suites cover
the existing journeys, authors, saved outcomes and poem.
