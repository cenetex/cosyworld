# CosyWorld avatar simulation redesign

Status: proposed design, with an interactive local prototype. Written on October 14, 2026. Runtime integration follows the stages below.

CosyWorld is a shared character simulation. The player guides one avatar's intentions while the whole cast acts on its own. Chat makes those lives readable. Cards let the player focus attention, express a wish, and choose a concrete intervention.

The purpose of play is to build a life worth caring about: understand people, make plans, help or complicate their plans, discover useful things, and see relationships and places change. Each visit should produce a small story that belongs to this cast and this player's choices.

## The player promise

“I guide Briony. I can see what she cares about and what she plans to try. The people around her have plans too. I decide when to trust her, when to step in, and which opportunities matter to us.”

The main pleasures are understanding a character, anticipating a reaction, finding a useful connection, and seeing an unexpected result make sense. A modest action can matter: lend a lamp, introduce two friends, keep an agreement, or plant something where someone will find it.

The player's chosen role is **guide one avatar's intentions while the whole cast acts on its own**. This sets the control model for the design.

## Design influences

These sources supply useful principles. The rules in the following sections are proposed CosyWorld choices.

- **RimWorld:** Tynan Sylvester describes placing a person and something they value at the centre of a story. CosyWorld should attach resources and conflicts to particular people: Mara wants a lamp because she likes reading outdoors. [Developer design notes](https://ludeon.com/blog/2022/10/biotech-expansion-announced-update-1-4-on-unstable-branch/)
- **Wildermyth:** its writing guide connects situations to the cast's traits and relationships, calls for understandable trade-offs, and values visible lasting changes. CosyWorld should use short authored reactions that fit recorded events, with relationship and place changes as rewards. [Story inputs and outputs](https://wildermyth.com/wiki/Story_Inputs_and_Outputs)
- **Book of Hours:** Weather Factory describes a world where books, visitors, furnishings, and weather have places, while cards provide a way to handle them. CosyWorld should give cards a stable meaning as things in the world and make their possible uses easy to inspect. [World and interface design](https://weatherfactory.biz/shutter-the-windows-against-the-sea/)

## The loop

1. **Notice.** Read a short exchange and inspect the people or things that catch your interest.
2. **Care.** Choose what matters to your avatar for now: keep someone company, solve a practical problem, explore a curiosity, or rest.
3. **Anticipate.** See the avatar's next proposed action and its reason. Inspect another approach if you have an idea.
4. **Act.** Let the avatar take that step, choose a specific step, or watch the cast for one moment.
5. **Respond.** Other avatars pursue their own aims. Read the consequences and keep, revise, or release your intention.
6. **Remember.** Carry forward a changed relationship, a useful discovery, an arrangement, or a place you helped shape.

A visit can end whenever the player feels satisfied. The Journal remembers the current intention, recent changes, and a few live interests. A new visit starts from the world as it now stands.

## Who chooses what

| Choice | Owner | What the player sees |
| --- | --- | --- |
| Current intention | Player | “Help Mara read outdoors.” |
| Suggested next step | Guided avatar | “I'll ask Pip about the brass ring. Mara says it fits her lamp.” |
| A specific action | Player, when they step in | An exact action with its target, cost, and immediate effect. |
| Another person's answer | That avatar | Their answer and any resulting agreement. |
| Other avatars' plans | Those avatars | Public plans they have expressed, and actions Briony witnesses. |
| Results and ownership | Existing world rules | What changed, who did it, and why it became possible. |

One active intention keeps the interface clear. The player can bookmark two other interests in the Journal. Intentions describe desired situations, such as “spend time with Pip” or “make this place welcoming.” The avatar can find several ways to pursue one.

Setting an intention is free. It prepares a plan. **Let Briony act** approves one visible step. Later, **Follow through** can approve up to three steps with an explicit scope and a stop at a new risk, request, or commitment. The first runtime release uses one step at a time.

The avatar's personality shapes suggestions and speech. The player can choose any currently legal approach for their avatar. Another avatar's agreement still belongs to that avatar. Social outcomes depend on their priorities, history, and resources.

## Chat gives events meaning

The centre of the screen remains a shared room conversation. Each meaningful exchange has a simple rhythm: someone expresses a want, something happens, someone reacts.

Speech has a speaker and a grounded purpose. A short event line states physical changes: “Pip gave the brass ring to Briony.” A character can then express an opinion about that event. Statements about possession, travel, completed work, and agreements draw from committed events.

Keep the immediate view to the latest meaningful exchange. Routine movement and repeated work fold into a short summary. The full sequence stays in the Journal. Show an avatar's reason when it explains a change of plan or helps the player predict a choice.

Use visible language for uncertainty: “Mara thinks the ring is in the garden” cites her last observation. A new observation can revise that belief. A request has a concrete proposed exchange; the recipient's acceptance completes it. A spoken wish becomes a commitment through an explicit agreement action.

In the first release, cards supply conversation aims such as **Ask what matters**, **Offer help**, **Share a discovery**, and **Suggest an exchange**. The avatar supplies the voice. A future text composer can turn a player's words into an editable intention or action preview through the same validation path.

## Cards have three clear jobs

**Entity cards are stable handles.** A person, item, or place card shows identity and one relevant current fact. Pip's card might say “Keeping the brass ring; hoping for company.” Selecting it is free and reveals known context and available actions. The cast, nearby things, and carried items remain directly browsable.

**Intention cards express what matters.** Show up to three suggestions drawn from current desires, observations, and player bookmarks. Each says whose life or which place it concerns. **Other interests** exposes the full known set. The active intention stays pinned above the action area.

**Action previews say what will happen next.** Selecting a person or item exposes explicit actions on that card. Selecting two related cards can narrow the action list: mint plus Pip can offer a trade or a gift when both are legal. The player chooses among the supported meanings. Browsing, inspecting, pairing, and changing focus preserve world time.

The main button names the proposed act. Its supporting line names its reason and any relevant cost. The player always has **Watch one moment** and **Change intention**. A quiet scene can offer rest, practice, a visit, or exploration based on existing world facts.

On a phone, the order is place, recent chat, active intention, proposed action, then browsable cards. Cards and controls wrap. The next action remains visible without opening a second screen.

## A situation that can develop several ways

At the cottage garden, Rati wants company for supper. Mara wants to mend her reading lantern. Pip owns a brass ring that fits the lantern and likes mint tea. Briony is curious about the fireflies near the mint.

These starting facts create several possible lives:

- Briony brings mint to Pip and proposes a swap. Pip accepts because tea matters to him. Briony brings the ring to Mara, who repairs her lantern and can read outdoors.
- Briony spends time with Pip and helps Rati gather company. Supper changes who knows whom. Mara makes a simple sheltered repair while they talk.
- Briony follows the fireflies, finds seeds, and shares the discovery. Pip becomes interested in planting. The garden gains a new feature while Rati cooks and Mara repairs her lamp.
- Briony watches. The cast makes progress through its own skills and supplies. The player can enter the situation after it has already changed.

The same action can have several uses. Mint can flavour supper or support a trade. A working lamp can enable reading or a night walk. A new friend can introduce another person. A solved need changes what the cast wants next.

Content authors supply people, resources, relationships, capabilities, and local tensions. Each important need has an owner and at least one path the cast can pursue. The situation remains useful when the player chooses another interest.

## How avatars choose

The shared legal action surface remains the foundation. Both guided and independent avatars act through the same movement, transfer, work, discovery, and relationship rules.

Give each avatar these compact records:

- **Values:** stable preferences used to rank choices.
- **Desires:** current desired conditions, with strength, evidence, and a satisfaction rule.
- **Beliefs:** known or reported facts, with source and age.
- **Commitments:** accepted agreements with named participants and terms.
- **Intention:** one chosen direction, its origin, and its completion condition.
- **Plan:** the next legal step, its reason, and its expected local result.

Generate candidates from known entities and legal actions. Apply ownership, physical, risk, and agreement rules first. Rank surviving actions by the active intention, accepted commitments, immediate needs, personal interests, and fresh opportunities. Use stable tie-breaking and a small cost for changing plans. A plan changes promptly when its target or assumptions change.

A satisfied desire falls in priority. An impossible step produces a readable reason and another approach. Promises can be fulfilled, renegotiated, or withdrawn through recorded events. Relationships store specific memories and permissions: “lent me a lamp,” “we planted together,” “welcome at my workbench.” These facts affect later choices.

The language model can propose an interpretation or express a voice. Certified actions establish changes. The reason shown to the player is a short rendering of the saved decision factors. It describes the avatar's evidence and priorities.

## Time and shared play

Quiet worlds rest. Active scenes move through deliberate play. Reading and local planning preserve time. An action or **Watch one moment** advances one bounded scene round.

For the first runtime trial, keep the existing room initiative and activation certificates. A guided action uses that avatar's seat. Autonomous actors use their own seats once in the round. Resolve each action against the latest state, and stop the round at the next directly controlled human seat. The interface states **Your turn**, **Mara is acting**, or **Waiting for Rowan**. It keeps free inspection available throughout.

Only actors in an active scene receive those activations. Other scenes retain their last known state unless another player activates them. Each round has a finite actor and speech budget. Responses summarize the useful changes after the round; a reaction creates an observation for a later eligible activation.

Two humans each guide their own avatar. A current action certificate settles a scarce item once. If another actor changes it first, the UI refreshes the proposal and explains the new fact. The player's next approval uses that refreshed proposal. Friendly scenes keep their sanctuary protections. Each avatar enters danger through its own approved action.

Leaving suspends the owner's delegation by default. A later explicit stay-active setting can reuse the existing action, speech, and scope limits. Returning shows changes witnessed or reported to the avatar, with their source. The shared world's history remains common to all players.

## Purpose and growth over time

Short-term purpose comes from an intention the player cares about. Medium-term purpose comes from a relationship, a place, or a practice that creates fresh possibilities. Long-term purpose is a distinctive life: the people Briony knows, the things she has made, her habits, and the places that bear her contribution.

Useful rewards add capacity. Mara may lend a repaired lamp. Pip may share a place he knows. A tended garden may attract visitors or support a new recipe. Each reward has a real giver, source, or world effect. The Journal connects it to the event that earned it.

Existing deed-based practices can describe that life. Skill growth remains tied to the relevant rules. Personal style can appear in an avatar's room, objects, and portrait. Growth creates new ways to interact with the same people as well as reasons to meet new ones.

## Fit with the current code

The source review used main at `54a21ee7`.

| Existing part | Planned use |
| --- | --- |
| `residents/drives.rs` | Integrate the typed desire foundation with current values, beliefs, satisfaction, and ranking. |
| `residents/continuity.rs` | Reuse beliefs and memories; add typed intention and commitment references with clear sources. |
| `autonomy.rs` and the shared action surface | Rank the whole legal candidate set for a goal before projecting a small visible suggestion set. |
| `avatar_autonomy.rs` | Extend the bounded owner delegation from an item goal to a desired condition and one approved step. |
| `composition.rs` and Story Hand | Turn entity cards into free focus controls; show explicit supported actions and a pinned intention. |
| `first_tale.rs` and its presentation | Convert the guide into optional interests tied to live needs and recorded results. |
| Jobs, features, recipes, and clocks | Keep these as concrete opportunities and mechanisms that any eligible avatar can use. |
| Actor practices, Journal, and event replay | Describe outcomes and changing identity from committed deeds. |

The drive foundation currently has its own vocabulary and recovery rules; live integration is the next step. Owner delegation already has action and speech bounds. The existing first-tale guide pins a recommended offer. Adoption replaces that forced priority with the player's active intention and current world conditions.

Existing quest content becomes a set of requests, resources, and relationships. Authored campaign mode can remain an explicit world choice. For the shared simulation, opening situations lead into the ongoing cast.

[PR #1050](https://github.com/cenetex/cosyworld/pull/1050) contains useful return memories and contribution credit. Its proposed follow-up task selection should become optional interests under this design. It was open at the source review.

## Delivery and player checks

**Stage 1: make control clear.** Add the visible intention, exact next action, free entity inspection, and a one-step control to an isolated local scenario. Keep the current runtime accessible during comparison. The included prototype demonstrates this interaction with a small local rules model and authored dialogue.

**Stage 2: make the cast pursue its needs.** Integrate desires and beliefs with the shared action ranker. Use four avatars, one shared scene, a few items, and three overlapping interests. Record why every actor chose each action. Verify that several player intentions and passive observation produce coherent outcomes.

**Stage 3: make consequences last.** Save intentions, commitments, remembered deeds, and changed features. Resume after a restart. Verify ownership conflicts, stale proposals, recipient agreement, plan revision, and delegation cancellation. Give newcomers interests that fit the current shared state.

**Stage 4: make each return worth exploring.** Add another place and a small set of follow-up uses for relationships and objects. Surface recent changes through chat and the Journal. Expand the cast only when players can explain the smaller world.

Start with five observed sessions of 15 minutes each. Ask players to choose their own interest. After three actions, ask who they guide, what that avatar wants, what another avatar wants, and what they expect next. Let them change their minds. End with the story they would tell a friend.

Initial design targets: four of five players can explain their control and an independent motive; four can change intention without help; four can name a consequence of their own intervention. Across sessions, look for at least three different chosen goals or approaches. These are small-sample design gates; voluntary return over later sessions is the retention check.

## Prototype review

Open `avatar-simulation-prototype.html` beside this document in a browser. It contains the same fragment used for the conversation preview. The prototype runs entirely in the page and uses a fresh scenario on reload.

Choose an intention and use **Let Briony act** several times. Inspect an entity card to choose a specific next step. Use **Watch one moment** to observe independent actions. Compare the lantern, garden, and social results across intentions. The prototype uses explicit local rules and authored lines so its claims can be checked while reviewing the interaction.

Runtime validation, open-world content, saved games, and multiplayer integration belong to the delivery stages above.
