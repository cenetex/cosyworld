# Dynamic characters through shared life

Status: research and proposed design, 6 November 2026. Source review used
`9ccebec20`, version `1.2.125`. Implementation belongs in later PRs.

CosyWorld can make people feel alive through choices that follow from their
lives. A person wants something, knows part of the world, has relationships,
and carries promises from earlier encounters. Shared actions change those
facts. The next choice shows that something mattered.

The proposed loop is **current concern → legal choice → committed result →
memory**. Invitations, daily plans, quest help, combat, and speech should read
the same account of a person's situation.

## What the games teach us

These examples describe specific sources and versions. The CosyWorld column
contains our proposed use of them.

| Source                                                   | Observed design                                                                                                                                             | Proposed use in CosyWorld                                                                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| MUDs: [Evennia's AI tutorial][mud]                       | A saved state selects roaming, combat, or flight. Recent room history helps travel continue forward.                                                        | Give each activity a clear state and a useful next action. Keep enough recent history to detect pointless loops.                       |
| Zork I: [archived Infocom source][zork]                  | The thief carries possessions, steals from visited rooms, deposits treasure, and reacts to the player's presence.                                           | Let a person's ongoing purpose leave visible changes in objects and places. The player can understand a life through its traces.       |
| ADOM 3.3.3: [official distribution manual][adom]         | Bards form lasting companion bonds and can calm beasts with music. The game has a companion order command.                                                  | Make shared skills and deeds routes into companionship. Give an invitation a clear purpose that the companion can accept.              |
| NetHack 3.6.7: [guidebook, section 6.2][nethack]         | Pets eat, gain experience, and follow across stairs when near the player. Separation affects their bond.                                                    | Give companions needs and continuity across travel. Show who is joining before the party moves.                                        |
| Dwarf Fortress: [2018 developer log][dwarf]              | Memories pair an event with an emotion. Important memories recur; categories preserve variety. Some memories change values over time.                       | Remember a few meaningful events with their causes. Let protection, loss, welcome, and betrayal affect later choices.                  |
| The Sims 3: [Richard Evans's GDC talk][sims]             | Traits shape choices and reactions. Visits create temporary host and guest motives. Shared picnics encourage friends to gather.                             | A visit should hold people together. Traits should shape what each person does within the visit.                                       |
| RimWorld: [base game][rimworld] and [Ideology][ideology] | Needs, relationships, wounds, and beliefs shape daily life. Beliefs give meaning to social roles and rituals.                                               | Let fatigue, duty, grief, and friendship compete in clear ways. Give rituals participants, roles, preparation, and remembered results. |
| Caves of Qud: [completed feature arcs][qud]              | The water ritual links reputation to secrets, recruitment, and other benefits. Generated histories connect people, places, and objects.                     | Make a quest reward open a relationship or a future action. Objects can carry the history of the people who gave them.                 |
| Versu: [Evans and Short's architecture paper][versu]     | Social activities define roles and available actions. Different characters can fill those roles. Each person chooses through their own beliefs and desires. | Author a visit, meal, or vigil once. Let the current cast bring its own relationships and motives to it.                               |

For the Sims talk, the most useful sections are slides 41–62 on traits,
visits, shared meals, and specific social choices. For Versu, see pages 1–2
and 6–9 on roles and action selection. The Zork archive is historical source;
its exact build can differ from a published edition. The ADOM evidence is
`adom/docs/manual.txt`, under Bards and the companion command list, in the
Linux ASCII 3.3.3 archive linked from the official downloads page.

## What CosyWorld already has

| Current source                                                                                              | Useful part                                                            | Proposed connection                                                         |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [world.mjs](../../v2/card-game/world.mjs)                                                                   | Legal actions, invitation consent, resident planning, committed events | One decision input for consent and planning                                 |
| [want.mjs](../../v2/card-game/want.mjs)                                                                     | Current goals, quest steps, completion                                 | Goals remain active through a social visit or a needed side trip            |
| [life.mjs](../../v2/card-game/life.mjs)                                                                     | Shared experiences, recent company, gifts kept                         | Give every active resident a life record; extend it with lasting activities |
| [motives.mjs](../../v2/card-game/motives.mjs)                                                               | Item value, trust-related choices, grievances                          | Explain how the same invitation matters to different people                 |
| [knowledge.mjs](../../v2/card-game/knowledge.mjs)                                                           | Witnessed and learned facts, sources, repair                           | Separate what happened from what each person knows                          |
| [adaptive-learning.mjs](../../v2/card-game/adaptive-learning.mjs)                                           | Outcomes of earlier approaches                                         | Retry a request when its relevant circumstances change                      |
| [resident-sleep.mjs](../../v2/card-game/resident-sleep.mjs)                                                 | Personal sleep timing                                                  | Give a visit a clear ending and make tiredness part of a decision           |
| [reflections.mjs](../../v2/card-game/reflections.mjs) and [narrative.mjs](../../v2/card-game/narrative.mjs) | Thoughts with sources and speech context                               | Let speech express the same concern that shaped the action                  |
| [pack-items.mjs](../../v2/card-game/pack-items.mjs)                                                         | Item custody and authored uses                                         | Let a meaningful gift support later practical help                          |

The [invitation review](invitation-consent-and-visits.md) records the concrete
Fable failures. Fixed residents can lose the Invite action before consent runs.
Their life records also differ from those of traveling avatars. A successful
trip can be followed by an immediate return home. These are connected parts of
one visit lifecycle.

## A common view of the person

Propose a pure `currentConcerns(world, actor)` view. Build it from existing
goals, life, knowledge, relationships, location, inventory, battle, and sleep
state. Each concern carries its kind, subject, urgency, and source fact or
event IDs. Rebuild this view when the world changes.

Start with five kinds of concern:

- **Care:** personal safety, rest, and a person being protected.
- **Purpose:** a current quest, work, or a route prerequisite.
- **Company:** an accepted visit, a shared activity, or a wish to meet someone.
- **Relationship:** trust, gratitude, grievance, and a recent repair.
- **Attachment:** a valued object, home, or meaningful place.

Keep durable promises and activity progress in saved state. Derive temporary
scores and current location facts from the world. This keeps saves small and
gives every reader the same current facts.

An invitation evaluates the proposed location of the whole party, including
carried items. If Fable wants to talk to Vale, going with Vale can preserve that
purpose. Her priorities determine whether a competing duty calls her elsewhere.
Route requirements are checked for each traveler before the joint move commits.

The decision returns acceptance and one leading reason with its source facts.
Consent, autonomous planning, and speech consume that same result. The existing
descriptor can explain an obstacle; the character's voice can express its
personal meaning.

Use a small ordered set of priorities first: immediate safety, a current
commitment, useful progress, company, then ordinary routine. Traits can change
the weight and expression of those priorities. Tune this order through recorded
play traces. Include the score terms in development evidence so a choice can
be traced back to its cause.

## Shared activities that last

A saved activity holds an ID, kind, participants and their roles, place, phase,
start event, and ending conditions. Begin with the accepted visit defined in
the invitation review. Its first implementation can use that smaller saved
visit record and grow into the common shape as more activities appear.

Examples of authored activity roles:

| Activity    | Roles                                | Choices with meaning                   |
| ----------- | ------------------------------------ | -------------------------------------- |
| Visit       | Host, guest                          | Welcome, accompany, stay, say farewell |
| Shared meal | Host, cook, guest                    | Bring food, prepare, offer, join       |
| Funeral     | Mourner, helper, witness             | Gather, anoint, wrap, bury, keep vigil |
| Protection  | Protector, person protected, witness | Cover, accept help, thank, withdraw    |

Participants choose from the actions available to their role. A story can
still name its central people. Supporting roles can accept suitable people
from any mounted cast.

Activity progress survives a pause and reload. An ordinary Wait keeps a visit
active while the participants remain together. Sleep, farewell, separation,
harm, and transfer to human control have explicit ending rules. The invitation
note defines these rules for the first visit implementation.

A story journey stores its progress separately from physical location. A visit
can pause a journey; the character can later return to the next story step.
Likewise, Antigone can keep her funeral goal while pursuing the conversation
with the shade that opens her own route into the Hollow.

## Memory that changes a later choice

Build on the existing small experience list and sourced knowledge records.
For a meaningful event, retain who acted, who was affected, who witnessed it,
the source event, and the person's response. Keep a bounded range of kinds so
routine exchanges leave room for a rescue, a loss, or a promise kept.

Repeated minor actions refresh a recent memory. Relationship gains should
depend on a meaningful change, such as fulfilling a current need or keeping
a promise. Test repeated Talk and gift exchanges over long runs.

Knowledge remains personal. A witness can remember a rescue directly. Someone
else can learn about it through the existing sourced conversation path. Later
reflection may change its meaning while retaining the original event.

One event can support several future choices. A companion who received cover
may choose to stay near the protector, offer help, and speak a short line when
they next meet. The [combat design](combat-awareness-and-abilities.md) describes
how the committed battle event can feed that reaction.

## Quests and rewards as a changed world

The [earlier quest research](quest-design-research.md) explores lasting
consequences. The [saved reward design](quest-reward-claims.md) gives completion
a visible moment.
The deed earns a checked card; the player claims its reward through the card.

Further rewards can follow the same saved event: an invitation accepted,
a skill learned, a promise of help, a useful keepsake, or a place made welcoming.
Each reward should describe a change the player can later use or observe.
A weapon gift can grant one clear combat action, as proposed in the combat
note. A funeral can change a mourner's concerns and the meaning of the Hollow.

This supports the game's central feeling: care leaves traces in the world.
Characters reveal themselves through what they choose, remember, and offer.

## Deleuze, Guattari, and Barthes as design prompts

These are our design interpretations of the texts.

In [the introduction to A Thousand Plateaus][deleuze], Deleuze and Guattari
describe connections among different kinds of things and many possible points
of entry. For CosyWorld, this suggests quests built around relationships among
people, objects, and places. A funeral cloth can connect a mourner, a maker,
a gift, and a place. Meeting any of them can lead into the situation. A reward
can create another useful connection, such as a person willing to accompany
you or an object with a new use. Keep the actual conditions clear enough for
the player to learn through the world.

In [The Death of the Author][barthes], Barthes gives the reader a central part
in bringing a text's many voices together. Our game design use is to leave
room for the player's interpretation. Antigone, Creon, and the player may give
the same burial different meanings: care, defiance, duty, or grief. Commit the
deed once. Let each person's knowledge and relationships shape their response.
The player can decide which response matters to them.

This also gives the quest card a stronger role. Its changing art records the
rite; its check marks the deed; Claim gives the player a moment to receive
what follows. A keepsake, a welcome, or a promise makes that moment personal.
The existing cards and descriptor can carry these meanings.

## First implementation slices

Each slice should fit a small PR after its dependencies have merged.

1. **Common concerns and life coverage.** Add the derived view and cover active
   residents with existing experience records. Prove current behavior through
   focused traces before using the view to change consent.
2. **Invitations and lasting visits.** Follow the invitation note: prospective
   party state, consent, saved visit, explicit ending, story journey resume.
   Let mutual conversation provide evidence of company for Fable and her peers.
3. **One shared activity.** Use a meal to test role choice, useful contributions,
   interruption, rejoining, and an outcome remembered by each participant.
4. **Battle memory.** Carry protection and defeat facts into the same records,
   then use them for the short reactions described in the combat note.

The per-person Hollow prerequisite and its NPC planning remedy belong in the
invitation work. Antigone needs an available plan to speak to the shade while
her funeral goal remains held. The player follows the same route requirement.

## Evidence for each slice

- Invite several residents from different packs with the same circumstances.
  Change trust, company, duty, and danger one at a time; explain each choice.
- Fable accepts after useful mutual contact, stays through Wait, and responds
  to a later farewell. Mira can resume her own work after a visit.
- Antigone seeks the shade, records her own conversation, and joins the funeral
  when its people and materials are present.
- Two personalities choose differently within the same meal. The action trace
  makes the difference visible before any generated speech is read.
- Repeat Talk, gifts, refusal, interruption, and travel for long runs. Check
  memory bounds, stalled goals, repeated movement, and relationship inflation.
- Check partial knowledge, competing invitations, human control, pack changes,
  reload, and checkpoint-free journal replay. Local and shared choices agree.
- Play each changed path at phone and desktop widths through the existing
  cards, stacks, descriptor, and single context action button.

[mud]: https://www.evennia.com/docs/latest/Howtos/Beginner-Tutorial/Part3/Beginner-Tutorial-AI.html
[zork]: https://raw.githubusercontent.com/historicalsource/zork1/master/1actions.zil
[adom]: https://www.adom.de/home/downloads.html
[nethack]: https://www.nethack.org/v367/Guidebook.html
[dwarf]: https://www.bay12games.com/dwarves/dev_2018.html
[sims]: https://media.gdcvault.com/gdc10/slides/Evans_Richard_ModelingIndividualPersonalitiesInTheSims3.pdf
[rimworld]: https://rimworldgame.com/
[ideology]: https://rimworldgame.com/index.php/ideology
[qud]: https://cavesofqud.com/roadmap/
[versu]: https://versu.com/wp-content/uploads/2014/05/versu.pdf
[deleuze]: https://markingham.org/wp-content/uploads/2012/05/introductionrhizome-pdf.pdf
[barthes]: https://writing.upenn.edu/~taransky/Barthes.pdf
