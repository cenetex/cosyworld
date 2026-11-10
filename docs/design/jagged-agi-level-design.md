# Designing past the jagged edge

Design note, 2026-11-09. Based on Ethan Mollick, [*Fable 5.2 and
Jagged AGI*](https://www.oneusefulthing.org/p/fable-52-and-jagged-agi).
This is an application of the essay, not a claim that it tested CosyWorld.

## Thesis

Strong models can produce striking worlds without noticing that their own
work is repetitive, joyless, unreasonably long, or optimized for the wrong
test. In Mollick's portal experiment, a request to polish the worlds grew
into a lengthy approval bureaucracy. More AI judges did not notice the
loss of enjoyment. Human taste and a simpler goal had to intervene.

**CosyWorld's response: generate possibilities, verify consequences, let
the player determine what matters.** Do not promote a model's eloquence
to state authority. See [the Pact](../cosyworld-pact.md) for the product
law and [A world that remembers](../cosyworld-ethos.md) for the governing
ethos and backlog questions. This note is the working detail beneath both.

This isn't a mandate to add more rules. The three useful boundaries already
exist:

- **Author:** supplies an idea, chooses which generated cards to Keep,
  and may reject work that is accurate yet flat.
- **Rules:** supply identities, custody, consent, routes, risk, and journaled
  effects. A generated description is a proposal until authored as data.
- **Player:** may experiment, retreat, refuse, return, and make an outcome
  meaningful. Do not reward compliance with an author's intended plot.

## Level design: five different kinds of consequence

A level should not repeat the same gate with different names. On each pass,
ask what changed besides the set of reachable rooms.

| Beat | Player sees | Mechanical truth | Distinct experience |
| --- | --- | --- | --- |
| Hearth | A place that stays worth returning to | Sanctuary and home | Attachment |
| Sign | An absent object leaves a physical trace | A real item or remembered event | Curiosity |
| Threshold | A particular relation grants passage | Held item, consent, or saved flag | Recognition |
| Venture | The relation can be changed elsewhere | Real movement, custody, or risk | Agency |
| Return | A changed relation is made public | Placement, witness, flag, or journal | Consequence |

Use the Pact's six tale functions as *possibilities*, not a mandatory
sequence. Not every scene needs to be a gate. A failed action should
change what is known or possible; otherwise omit it.

The smallest publishable encounter has: one concrete detail, one entity
the player can act on, one legible consequence, and a usable way back.
A memorable oddity without an action is scenery; an action without
consequence is a chore. Both can exist, but should not pretend to be quests.

## RatiRadio: a reference journey

Keep the [existing contract](ratiradio.md): the beanie, carried, opens
Dispatch; the thermos, set down at the Dispatch Window, opens Listening; a Talk
with RATi while holding the figurine opens Booth; glass, figurine and beanie are
placed **directly** in Listening to wake Raven. Routes latch open. The Request
Slip remains optional. Nothing consumes the objects.

Give the thresholds different dramatic functions while keeping those
facts: the **Staff Kitchen** contains a missing worker's trace; the
**Dispatch Window** makes warmth an act of recognition; the **Listening
Room** is RATi's genuine home rather than a reward kiosk; the
**Broadcast Booth** pays off with a real song. The final return is not a
fourth door: it restores a relationship and releases a new roaming Raven.

The three doors use three different locks (held, placed, heard), so the
station is not three copies of one key and door. The condition text in
locked-card descriptors continues to tell the player what opens each route. Scene copy should provide physical evidence
and atmosphere instead of repeating each instruction. The player can move
an item away after opening a passage; descriptions must not falsely claim
it remains on a shelf. The Raven figurine never becomes the living Raven.
Home and roaming/level behavior stay authoritative.

This is **narrative differentiation** within the existing progression.
Alternative gate solutions, changing difficulty, or new quest verbs require
their own authored rule proposal and tests; do not imply those mechanics
through generated speech.

## World authoring: small, relational proposals

The shipping seed route
(`v2/orchestrator-rust/src/card_authoring_seed.rs`) produces a place,
an avatar wanting an item, and that item. Use this minimal triangle.

- A place needs an observable feature and purpose for play, not an
  atmosphere-only adjective.
- An item needs an ordinary, playable use and a physical distinguishing
  detail; do not promise unimplemented powers.
- An avatar needs a specific desire linked to that item, plus a reason
  the player might help, decline, or negotiate.
- Later draws should add a **different relationship or use**, not simply
  another locked door, mysterious symbol, or resident issuing a task.
- Keep one or two short sentences per card; no lore dump, rubric, invented
  reward, or long chain of permission gates.
- Output remains proposed text. A human accepts cards; authored pack
  fields and validation decide what actually happens.

The seed prompt implements these preferences, while preserving the
existing JSON shape and result validation. No new editor UI, evaluator
model, state field, billing step, or inferred player identity is required.

## Human taste review, not an AI approval maze

For a new or significantly revised level, one human reviewer should
play a short journey, ideally once without knowing its intended solution.
Keep the existing card-table controls and test tools.

The ethos asks for two answers: the most memorable moment and the part to
remove. These four questions are optional prompts for finding them, not a
form to complete:

1. **Surprise:** What specific detail could only belong to this level?
2. **Agency:** What did I choose that changed something real?
3. **Rhythm:** Did two successive scenes ask me to do the same thing
   in different clothing? What can be cut?
4. **Return:** Can I leave with a consequence or an unresolved question?
   Can I still reach safety if I abandon the task?

The reviewer can write **keep, revise, cut** against each scene, with one
example. A clear "cut" is useful. Do not add an automatic model vote,
a global quality score, or a growing rulebook to resolve subjective taste.

Run a few *different* journeys instead of optimizing a fixed screenshot:

- First arrival with no prior knowledge.
- Correct item, then move it away; the route remains truthfully open.
- Wrong item or a refusal; no invented transfer or secret bypass.
- Return after a save/reload; earned access and Raven remain recorded.
- Speech unavailable or sound muted; gameplay remains possible, with
  the booth's music not treated as a required quest action.

Track *falsifiable* issues: dead ends, contradictory clues, broken
ownership, repeated mechanical tasks, stale UI, and non-recoverable state.
Treat delight as editorial judgment, not an automated pass/fail metric.
A high completion rate does not prove the journey was interesting.

## Limits and follow-through

The essay demonstrates a failure mode in AI projects. It does **not**
establish that all models or all procedurally generated games suffer
equally. A prompt can increase useful variation; it cannot guarantee taste.

The initial implementation should remain small: improve seed proposals,
polish one real pack, observe playtests. If players still experience the
station as three copies of a key-and-door puzzle, revise the level
structure in a separate pack-first design; do not invent a global quest
framework to solve one corridor.

Success means **fewer repeated beats with more consequential play**,
not more worlds generated per hour, more critics, or more rules.
