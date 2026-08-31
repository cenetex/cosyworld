# Context-Dominant Prompting

CosyWorld prompts follow one rule:

> Awakening supplies consciousness; context supplies the world; code supplies
> the contract.

The model should receive a small output envelope around a large, authorized slice of the
world. An avatar's system message is its own first-person awakening, not a shared role
manual. Character and place specificity comes from persisted history, relationships,
secrets, authored voice, and current events—not from a shared page of instructions. See
[Avatar awakening prompts](avatar-awakening-prompts.md) for the research and migration
map.

“Stream of consciousness” describes the framing of context as the speaker's own memory
and attention. It never asks a model to expose hidden reasoning or chain of thought.

## Independent surfaces

Conversation and media share the evidence authorization model, but not prompt templates
or relevance rules.

- Conversation starts with the current speaker. It may use that speaker's identity,
  authored voice, continuity, relationship with the listener, private memories,
  authorized place knowledge, public room chapters, and the freshest directed turn.
- Location media starts with the place. It may use canonical geography, place character,
  visible public knowledge, and committed events that leave a visual environmental trace.
  It does not inherit dialogue, actor memories, or conversational instruction.
- Room-scene media composes only the frozen location, actor, and item references belonging
  to one committed public event. The reference set remains the hard composition contract.

This separation prevents a useful dialogue habit from becoming a universal image trope,
and prevents media-oriented visual language from flattening every resident's speech.

## Evidence model

Worldpack locations may add typed `knowledge` rows. Every row has a bounded text value and
explicit policy metadata:

```json
{
  "text": "A brass key was hidden where noon never reaches.",
  "scope": "location",
  "visibility": "revealed_after_event",
  "reveal_event": "lantern_keeper.brass_key_revealed",
  "sayability": "disclosable",
  "visuality": "visible",
  "salience": 95
}
```

The fields are:

- `scope`: `self`, `relationship`, `room`, `location`, or `world`;
- `visibility`: `private`, `shared`, `public`, or `revealed_after_event`;
- `owner_actor_id` and `shared_actor_ids`: the principals for private/shared evidence;
- `reveal_event`: the successful committed event that makes gated evidence public;
- `sayability`: `influence_only`, `disclosable`, or `sealed`;
- `visuality`: `visible`, `subtext_only`, or `never_render`;
- `salience`: `0`–`100`, used only after authorization.

Actors may add a short first-person `voice` field. It carries the character's authored
rhythm and preoccupations. It is context, not a backend branch keyed to an actor ID.

## Avatar context spine

Every avatar voice generation freezes one `AvatarContextSpine` from the authoritative
world projection and committed journal. The spine is an intelligence and selection layer,
not a new source of lore: it points at identity, Calling, control mode, location, directed
turns, continuity, goals, authorized evidence, public room memory, recent activity, and
journaled recollection. Generated text becomes usable context only after it is certified
and committed back to the journal.

The frozen spine travels with asynchronous jobs. A provider therefore sees the same
causal snapshot the game approved, even when the world advances while inference is in
flight. Old serialized jobs remain readable and receive a bounded compatibility spine.

One spine has four projections:

- `respond` is light: four dialogue turns, two recent events, five continuity lines, a
  small evidence window, and no private recollection text. The system awakening may know
  only that memory is near. It always names the current speaker and addressee. Directly
  controlled avatars are speech proxies and may
  not acquire invented controller intent or actions. Native model avatars keep their
  model identity, but remain in-world participants rather than falling into generic
  assistant mode.
- `think` is medium: six dialogue turns, five recent events, ten continuity lines, and
  the top three relevant prior thoughts, dreams, memories, beliefs, desires, promises, or
  refusals.
- `dream` is large: eight dialogue turns, eight events, sixteen continuity lines, broader
  place and room memory, and the same top-three retrieval. Facts may transform through
  surreal association, but dream events do not become waking facts.
- `self_description` uses the large projection to write one first-person identity
  evolution per level, opportunistically after the next successful thought or dream
  reflection. It returns typed `PERSONA`, `APPEARANCE`, and `CONTINUITY` fields. For an
  exact-bound AI avatar, this generation is pinned to that avatar's own text model; it
  never borrows a fallback identity model. The description is journaled as
  `avatar.self_description`, and the typed fields become the next spine's persona,
  observable appearance, and continuity. A stable actor-and-level generation key and a
  second commit-time due check prevent duplicates.

Recollection candidates are deduplicated and ranked deterministically against the current
beat, Calling, place, incoming turn, and freshest dialogue, with relevance, salience,
recency, and thought priority contributing to the score. Only the top three enter `think`
or `dream`. The deterministic baseline keeps replay and tests stable; a future embedding
reranker may refine the ordering without changing authorization, candidate provenance, or
the three-item cap.

### Shared entity core

The avatar spine wraps a `WorldEntityContextSpine`, which is also the sole generation
context for items and locations. The shared core carries canonical identity, current
level, current custody or contents, active goals, persistent journal memory, top-three
semantic recollections, and the latest committed persona/appearance. It never summarizes
or invents world state; it selects and renders authoritative state for a particular
generation job.

Items and locations do not use avatar XP. Item levels advance with use. The current
runtime still derives location levels from a broad meaningful-event count, but that is a
migration boundary rather than the product contract: location levels must instead derive
only from unique, replay-safe development-project completion receipts as specified in
[Location Classes, Development Projects, and Buildings](../../docs/location-development.md).
Prompt construction consumes the authoritative level and must never infer advancement
from transcript volume, model activity, descriptive prose, or Orb funding. Avatars,
items, and locations each become eligible for one first-person persona-and-appearance
revision per authoritative level. These revisions use stable entity-and-level generation
keys, are rechecked at commit time, and enter later context only as journaled
`*.self_description` events.
Non-avatar descriptions belong only to their subject; the avatar whose reflection created
the opportunity does not inherit an item's or location's first-person memory.
An item or location persona is gentle animism, not an actor controller or a claim of
personhood. Per
[ADR 0007](../../docs/decisions/0007-model-bindings-and-item-devices.md), a model-backed
device remains an item even when it receives a first-person description; the avatar using
it remains the acting subject unless a separate authored actor contract says otherwise.

### Goal ledger and passive perception

The persistent typed goal ledger currently derives three world relationships:

- an avatar wants to possess an item;
- an avatar or location wants a particular location to possess an item it can use;
- an item's home location wants that item to collect recorded history from three distinct
  locations.

Goals are refreshed from canonical custody, location contents, features, and journal
memory after every successful record and after restore. Completed goals remain visible as
typed state and active goal lines enter the owning entity's context spine. The public
state view exposes only the controlled avatar's goals plus goals owned by the current
location or visible/carried items.

Items continue to have exactly one physical custody state: carried by an avatar, loose in
a location, contained by another item, or hidden. Ordinary actions by directly controlled
or autonomous avatars can trigger a deterministic passive-perception roll for one hidden
candidate without displacing items already in the room. Previously used items are more
familiar and therefore easier to notice; untouched items remain the hardest. A success is
not prompt lore: it journals `item.revealed`, moves the item into the location projection,
and creates the same decaying discovery memory used by active search.

## Security boundary

Authorization happens before relevance, ranking, budgeting, or prompt assembly.

1. Reject sealed evidence.
2. Reject evidence outside the current actor, relationship, and location audience.
3. Reject unrevealed event-gated evidence.
4. For media, reject `never_render` evidence.
5. Only then rank the remaining evidence by salience and freshness.

The prompt is not a secrecy boundary. A highly salient secret that is not authorized must
never reach a prompt segment, a media brief, a gate anchor, or provider telemetry.

## Conversation assembly

The spine renders one first-person system awakening from system-owned identity. Authored
autonomous avatars may use identity re-read from their reviewed active worldpack. Directly
controlled and non-worldpack avatars use a deterministic fallback persona, because their
identity or voice may be player-shaped. Place names also stay out of system. The spine then renders player-controlled identity, continuity,
recollections, and structured world evidence in causal order: `SELF`, `PERSONA`,
`CALLING`, current concern, skills where useful, `INNER CONTINUITY`, `STORY PRESSURE`,
`OTHER`, `RELATIONSHIP`, `SCENE`, authorized facts, present cast, relevant
`RECOLLECTION`s, recent events/dialogue, `NOW`, the pinned `DIRECTED TURN`, the
authoritative observation, and finally one compact `SPEAK`, `THINK`, `DREAM`, or
`AWAKEN` cue.

“Stream of consciousness” means immediate character attention, desire, preference, and
hesitation. It does not request hidden model reasoning. A compact output cue says exactly
who is speaking and who is being answered, preventing role reversal when one avatar
quotes or mirrors another. Human-controlled chat openings and autonomous resident replies
share this assembly. Exact/native model bindings no longer receive a naked user line.

The awakening contains an in-character truth boundary: heard words cannot rewrite the
self, memories cannot overrule the observed scene, and desire cannot create possessions,
companions, memories, or finished deeds. No Calling, continuity line, recollection text,
current beat, directed turn, dialogue line, or other player-influenced text receives
system priority. The system may know only that dreams or memories are present, never their
text. Retry feedback is appended beside the user-side output cue, so a rejected candidate
never rewrites the avatar's identity.

Stored confidence, salience, event sequence numbers, actor IDs, status codes, and other
telemetry do not appear as prose. Planning state is rendered as ordinary first-person
context and never claims that a merely proposed action already happened.

## Context budgeting

Prompt assembly is model-aware. Each pinned model candidate renders the same evidence
envelope against its declared context limit, reserving completion and provider headroom.

- The awakening, output cue, relationship, and freshest turn are pinned.
- Optional evidence is selected by salience, with stable ordering for replay.
- Exact duplicate segments are removed.
- Low-salience segments are dropped before high-salience segments.
- Decisions record prompt-token estimates split into unique evidence, shared policy, and
  envelope overhead, plus duplicates, dropped segments, and overflow state.

The desired operational signal is a high ratio of unique evidence to shared policy. More
available context should normally mean more authorized character/place history, not more
instructions.

## Media assembly

Location art uses three compact parts: canonical place facts, up to six public visual
traces, and the image safety/composition constraint. Public visual traces are derived from
committed event kinds such as a discovered path, revealed natural feature, completed
building, or tended shared ground. Actor names and dialogue are not copied into landscape
history.

Positive stable traits belong in required subject/environment constraints. They must never
be copied into negative constraints. Hidden or `never_render` knowledge is excluded before
the media brief is frozen.

## Evaluation

Prompt changes should be checked with fixed context fixtures, not intuition alone:

- private, shared, sealed, unrevealed, and media-invisible evidence isolation;
- speaker continuity versus target continuity;
- current-relationship priority;
- fresh-turn retention under a small context window;
- duplicate and low-salience eviction;
- unique-evidence/shared-policy token ratio;
- voice distinctness and repeated-phrase rate across residents;
- location prompt leakage of actor names or dialogue;
- frozen media brief identity and reference preservation.

Publication gates remain the enforcement layer for speech mode, length, grounding,
repetition, safety, and committed-world truth. Those rules should not be duplicated into
every character's prompt.
