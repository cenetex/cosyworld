# Authored story quests

> Retired. The rules no longer read `storyQuests`: each avatar now holds a
> stack of quests, described in the [card guide](../card-game/README.md#a-quest-stack-per-avatar).
> Stories are told through pack choices. The mounted packs dropped their
> `storyQuests` data in #1581; this page records the earlier format.

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

## Returns

A return brings an earlier outcome home. Mark it with `return`:

```json
{
  "id": "story-quest-orchard-return",
  "start": {
    "kind": "quest",
    "key": "story-quest-orchard-help",
    "status": "resolved"
  },
  "endings": [{ "choice": "orchard-report", "outcome": "Shared" }],
  "return": {
    "from": ["story-quest-orchard-help"],
    "carries": [{ "kind": "choice", "key": "orchard-answer" }]
  }
}
```

`from` names one to eight earlier stories in the same pack. A return cannot
depart from itself. `carries` names one to eight pieces of saved evidence:
a branch (`{"kind":"choice","key":...}`), a true flag
(`{"kind":"flag","key":...}`) or a receipt (`{"kind":"receipt","choice":...}`).
Validation checks that:

- a choice in a `from` story writes each carried item, and no ending of the
  return itself writes it;
- each `from` story supplies at least one carried item;
- every ending of the return depends on a carried item. The ending's
  `requires`, or its `when`, reads the item directly or reads something that
  only choices depending on the item can set.

The rule records the difference between departure and return. A report that
could finish without the earlier outcome is rejected. Saved receipts still
decide completion, so marking an existing story as a return keeps its saves.
The Greek table's Theban and grave reports, the Open Door account, the five
early reports, Myrine's reading and the forest's charm homecoming are returns.

## Middles made of Talk

A story's middle can be something the player learns from a person. Give the
needed fact to two or three people or places as separate `topics`. The ending
action then requires any one of them:

```json
{
  "kind": "knows",
  "topics": ["orchard-well-host", "orchard-well-child"],
  "role": "actor"
}
```

`topics` names two to four topics; one is enough. This follows the three
clue rule: a missed conversation does not stall the story. Each topic may
link a hidden `choiceId` so the first telling leaves a receipt for the
story's `progress`. Personal knowledge is not part of receipt validation,
so a save that already holds the ending receipt stays complete.

The topics in one `topics` list must have different speakers. The pack
build prints advice for a story with no `progress` and no `return`, and for
an ending or progress action whose `knows` gate has one source. Advice does
not fail the build.

The Ajax shield uses Teucer and Odysseus at the camp and Tecmessa in the
household tent. The forest's evening watch uses RATi at the cottage and
Root at the oak.

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
The listener's Talk that selects the topic commits the choice at the play,
even if the AI line never arrives; published words only teach the fact.
Each avatar's learned topics stay separate from the world's choice receipts.

Build the compiled catalog with
`node v2/scripts/build-card-worldpacks.mjs`. Run
the Greek story suites for the existing journeys, choices and poem.

## Knowledge and ordered steps

A saved fact keeps its original event, person, place and turn. Each avatar keeps
whether they witnessed it or heard it, plus the person who told them. A Talk
selects one fact the listener can learn. The reply includes that complete fact
sentence and may add a short sentence in the speaker's voice. The listener gains
the fact when the checked reply is saved. Heard news becomes available for
retelling on a later turn.

For a chain of story lines, give each topic a stable ID. A later topic can
require the previous topic:

```json
{
  "id": "orchard-second-line",
  "speaker": "orchard-host",
  "at": "orchard-gate",
  "text": "The second verse names the old well.",
  "requires": [
    { "kind": "knows", "topic": "orchard-first-line", "role": "actor" }
  ]
}
```

A personal or shared quest program can also use
`{"kind":"knows","topic":"orchard-first-line","role":"actor"}` in a hand's
`conditions`. Put one such hand in each ordered program step. The common progress
core captures the learned fact as evidence and advances at most one step per
turn. A pack action can require the final fact and record the story's ending.
The Bard continues to read the verses earned by completed deeds.
