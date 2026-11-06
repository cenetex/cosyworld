# Combat awareness and item abilities

Status: research and proposed design, 6 November 2026. The source audit used
`678bea9ea`, version `1.2.125`. Implementation belongs in later PRs.

The aim is clear: characters notice important battle events, answer them in
their own voice, and remember what another person did for them. Future weapons
could offer a small set of distinct actions through the existing card table.

## Current game

- [Speech occasions](../../v2/card-game/speech-occasions.mjs) choose voices for
  a threat, a Wait during battle, and the player's defeat. An ordinary Strike
  is silent in the [current test](../../test/card-speech-occasions.test.mjs).
- [Narrative context](../../v2/card-game/narrative.mjs) gives a speaker its
  opponents and open or braced stance. The turn also carries plain event text.
- [Combat rules](../../v2/card-game/world.mjs) record actual damage, resolve
  before and after, the person hit, the person protected, and defeat.
  [Combat beats](../../v2/card-game/combat-beats.mjs) already read those fields.
- The [browser](../../v2/card-game/app.mjs) starts speech generation while an
  exchange animates. Its dialogue bar waits for combat and travel to finish.
- [Local narration](../../v2/card-game/narrative.mjs) checks the reply's
  revision. [Shared play](../../v2/card-game/shared-world.mjs) fixes the allowed
  speakers when an action commits. Shared speech gives each allowed voice one
  line per play.
- Avatars begin with a seed sentence. Events and reflection shape their voice.
  See [voice construction](../../v2/orchestrator-rust/src/card_narrative.rs).
- Combat uses four resolve, seeded damage, Strike, Brace, Cover and Wait.
  A fight spans one room. Residents choose from their last attacker and trust.
  Front and back placement belongs to presentation; range would need rules.
- The [battle hand](../../v2/card-game/cards.mjs) shows people, the current
  place and a disputed item. Held ability items would need to join that hand.
  The current carry limit is three spaces, with some items using extra space.
- The [item schema](../../v2/card-game/pack-schema.mjs) supports tags and story
  fields. Combat effects need a checked field and supported rule. The existing
  [authoring design](world-authoring-play.md) treats ability text as descriptive
  until that rule has been chosen and tested.

## Proposed key moments

Select one short reaction per resolved exchange. Present it in the existing
dialogue bar between exchanges, while the battle is still open. Combat captions
continue to show the exact action and result.

| Event                                       | Preferred speaker                     | Proposed limit                 |
| ------------------------------------------- | ------------------------------------- | ------------------------------ |
| Battle opens                                | Threatened person                     | Once at opening                |
| A character takes another person's blow     | Protected person, if present          | First meaningful cover         |
| A protector attacks the person they covered | Betrayed person                       | Once for that pair             |
| Resolve falls from above one to one         | Endangered person or nearby helper    | Once per person per battle     |
| A brace helps someone survive a strong blow | Person who braced                     | Once per battle                |
| An item ability has a clear effect          | User or affected person               | First use or a decisive result |
| A character yields or is sent home          | Witness at the result's location      | One ending line                |
| The battle ends in peace                    | Person with a reason to welcome peace | Once at closure                |

Priority, proposed: defeat; protection; betrayal; low resolve; decisive ability;
peace; opening; routine ability or brace. Choose the latest relevant event when
two events have the same priority. A speaker must know the event and fit its
final result. A protected person who later yielded needs a line about the whole
exchange.

Start with a three-round gap between optional lines from the same person.
Important first events can bypass the gap. Aim for 4–12 words. All limits and
priorities here are tuning proposals for play testing.

## Facts and timing

The proposed speaking occasion carries:

- Battle key: location, opening turn, challenger and defender.
- Source event sequence, committed play ID, turn and revision.
- Actor, intended target, actual target and protected person.
- Item and ability IDs when present.
- Resolve before and after, brace, cover and final outcome.
- Witnesses, current location and one relevant relationship fact.

The shared rules select the event and allowed speaker when the play commits.
The voice service reads that result. The browser presents it after the exchange
settles. A later accepted play closes the earlier line's presentation window.
Reload and repeat delivery use the saved play identity. Existing generated-line
validation and unavailable-speech handling remain in use.

A compact first version can derive battle facts from the current event fields.
Item abilities should emit the same fields plus their source item and ability.
This keeps speech, animation and saved history attached to the same result.

## Voice examples for review

These are original examples of the proposed tone. Generated lines would follow
the speaker's seed, learned facts and inner life.

| Situation                        | Example                         |
| -------------------------------- | ------------------------------- |
| Vale survives at one resolve     | “Still here. Give me a moment.” |
| Vale protects someone            | “Stay close. I've got you.”     |
| Antigone receives protection     | “You stood with me. I saw.”     |
| Antigone braces through a blow   | “My hands are steady.”          |
| A former protector turns on Vale | “After I stood beside you?”     |
| Creon yields                     | “You have won this hour.”       |

Antigone's [authored facts](../../v2/content/greek-drama/card-world.json) value
practical help and care for the dead. That gives a concrete basis for her
response to protection. The current mounted cast supplies these examples.

## Proposed item abilities

A held item grants one named combat action. The first tap opens its details.
Selecting the item with a combatant names the target. The existing context
button shows the act and its effect. The item card shows whether it is ready
or spent; its descriptor states the use limit.

Start with one use per item per battle and one full play per use. Three carry
spaces create an early choice about which tools to bring. One item and target
should offer one clear action. Further actions on one item need a reviewed
selection design within the existing card table.

A disputed weapon needs a clear surrender action too. Proposed control:
selecting the disputed item alone offers Yield to the challenger; item plus
target offers its ability. Check this choice in a focused desktop and phone
play-through.

These are original sketches. Effects and values are proposed for play testing.

| New item       | Action     | Proposed effect                                                                    |
| -------------- | ---------- | ---------------------------------------------------------------------------------- |
| Bronze buckler | Stand with | Cover one combatant and brace yourself until your next play.                       |
| Rowan crook    | Hook aside | Remove a target's Cover, creating an opening.                                      |
| Reed whistle   | Rally      | Restore one resolve to another combatant who has one resolve.                      |
| Cast net       | Entangle   | Reduce the target's next Strike by one, with a minimum of one damage.              |
| Short sword    | Answer     | After this target struck you, strike at the top of the existing tier damage range. |

Pilot the buckler and crook. They make support and counterplay visible through
Cover and Brace. Test two- and three-person fights before adding healing or
further saved effects. The buckler's expiry needs an explicit timing rule.
Hook aside is offered while its target is covering someone. Answer is offered
when its target hit the user since the user's last play.
Each harmful ability resets the peaceful round. Each peaceful support action
counts as that person stepping back.

Use new authored items for the pilot. Ajax's existing shield carries a specific
delivery promise to Eurysaces in the [Greek pack](../../v2/content/greek-drama/card-world.json).

Keep sanctuary protection, tier damage limits, item custody, shared human
battle rules and defeat settlement. Residents and players should use the same
legal actions and effects. Resident choice needs a policy for each new action.

Save a set of used item IDs with the battle. A use stays spent through reload,
transfer and departure or return until that battle ends. Shared play checks
revision and custody again. The committed result records item and ability IDs,
actor, intended target, actual recipient, state changes, witnesses and source
event sequence. Key-moment speech reads those same fields.

## Research sources

- [Valve: dynamic dialogue](https://gdcvault.com/play/1015946/AI-driven-Dynamic-Dialog-through).
  Elan Ruskin describes matching world facts to responses, choosing specific
  cases, and giving writers control over history and special cases. The proposed
  event selector applies that pattern to CosyWorld's generated voice.
- [Greg Kasavin on Hades and Bastion](https://seanzwrites.com/posts/supergiant-games-greg-kasavin-interview/).
  His examples tie speech to low health, current place, previous meetings and
  exact player actions. CosyWorld can make a reaction equally easy to connect
  to a visible event.
- [Red Hook: Darkest Dungeon](https://store.steampowered.com/app/262060/Darkest_Dungeon/).
  The official description links stress and quirks to play and describes
  narration that marks successes and failures. CosyWorld could give each key
  outcome a brief human response.
- [Red Hook: Darkest Dungeon II](https://store.steampowered.com/app/1940340/Darkest_Dungeon_II/).
  Its token system supports combat decisions, while relationships can create
  useful combinations or conflict. The proposed lesson is readable conditions
  and battle consequences tied to people.
- [Battle Brothers: features](https://battlebrothersgame.com/features/).
  The developer explicitly gives weapons distinct skills, including axe shield
  splitting, mace stuns and spearwalls. This supports the proposed idea that
  a CosyWorld weapon grants a clear verb.

These applications are our design proposals. The linked sources establish the
reference games' patterns; CosyWorld's effects and limits need its own tests.

## Proposed delivery and proof

1. Add structured battle facts and first-person rendering to narrative context.
2. Add selected combat occasions and shared speaker selection. This is an
   engine change and needs its own design review, engine label and rules version.
3. Tune timing and voice quality in the existing dialogue bar.
4. Add a checked item field and one bounded effect resolver, with authoritative
   local, shared and replay tests. Use a new shared rules version.
5. Add ability item visibility, target selection and the single context action.
   Play the changed path at desktop and phone widths.
6. Author two pilot items and their resident choice rules. Test balance and
   the matching speech occasions.

Test a covered blow, a protected person yielding later in the same exchange,
a defeated speaker changing rooms, simultaneous shared battles, repeated
delivery, reload, a slow reply after another action, and hidden information.
Journal replay and local/shared results should agree on event and speaker.
Ability tests also cover spent items, transfer, repeat requests, expiry order,
sanctuaries, a full hand, invalid targets, peaceful rounds, retreat and re-entry.

Play-test current speech, key-moment speech and frequent speech. Ask players
who reacted, what caused the line, and why that person cared. Measure relevant
lines, repeated lines, response delay and interruption of play.
