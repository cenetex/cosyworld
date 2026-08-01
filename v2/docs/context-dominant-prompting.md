# Context-Dominant Prompting

CosyWorld prompts follow one rule:

> Prompt supplies viewpoint; context supplies consciousness; code supplies contract.

The model should receive a small output envelope around a large, authorized slice of the
world. Character and place specificity comes from persisted history, relationships,
secrets, authored voice, and current events—not from a shared page of instructions.

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

The shared system message describes output shape only, for example:

```text
only Rati's next spoken line · at most 40 words
```

The user context then flows in speaker order:

1. a tiny continuity marker (`…still me.`);
2. speaker identity and authored voice;
3. speaker-owned continuity, with the current relationship first;
4. current relationship/economy facts;
5. authored place description and character;
6. authorized location evidence and public room chapters;
7. goals, present cast, and recent activity when budget permits;
8. recent directed dialogue;
9. the freshest turn, pinned last;
10. a small completion hinge (`so—`).

Stored confidence, salience, event sequence numbers, actor IDs, status codes, and other
telemetry do not appear as prose. Planning state is rendered as ordinary first-person
context and never claims that a merely proposed action already happened.

## Context budgeting

Prompt assembly is model-aware. Each pinned model candidate renders the same evidence
envelope against its declared context limit, reserving completion and provider headroom.

- Output contracts, speaker identity, relationship, and the freshest turn are pinned.
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
