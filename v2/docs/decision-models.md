# Decision models

A decision model answers typed questions about a state with probabilities
instead of prose. The engine uses one through the OpenRouter Decisions API
(`POST /api/alpha/decisions`, model `typesafe/jev-1.13`) wherever it needs a
judgment and not a sentence. It is about fifty times cheaper than a language
model for the same call and answers in a few hundred milliseconds.

## Authority

A decision proposes. It never grants an item, moves an actor, resolves combat,
or writes state. Every call fails open: a missing model, a transport error, an
out-of-range or unreadable answer returns nothing and the caller keeps its
previous behaviour. Probabilities steer a seeded draw (a stable hash of world,
actor, round, and the last journal line), so the draw for one beat never
changes even though the provider's probabilities may vary slightly.

## Configuration

- The operator names the model with `COSYWORLD_AI_DECISION_MODEL`. Unset means
  decisions are off everywhere. Set, decisions are on for every world with the
  default policy (chat floor on, repeat judge on at 0.8).
- A pack tunes or turns off its judgments with `extensions["x-cosyworld-decisions"]`.
  Declaring `{"schema_version": 1}` with no judgments turns both off for that
  world:

```json
"x-cosyworld-decisions": {
  "schema_version": 1,
  "chat_floor": true,
  "repeat_judge": true,
  "repeat_threshold": 0.8
}
```

## Judgments

- **Chat floor (`chat_floor`).** Replaces the chat-or-pass language-model call.
  The question is a yes/no over the speaker's persona, who is present, and the
  last six lines. The probability of yes wins or loses a seeded draw, so
  residents talk in proportion to how much they have to say.
- **Repeat judge (`repeat_judge`).** After a candidate line is generated, one
  yes/no asks whether it repeats an idea in the last eight lines, even
  reworded. At or above `repeat_threshold` (0.5 to 0.99, default 0.8) the line
  joins the speaker's recent record, which the deterministic gate rejects as a
  duplicate, so the model is drawn again. This catches paraphrase echo that the
  lexical repeat check cannot.

## Limits to respect

Jev reads at most 32k tokens of state, reads criteria literally, loses accuracy
on irrelevant detail, and cannot write prose. Keep state compact. The Decisions
API is alpha. Its data-retention terms are not published, so a world should opt
in knowingly.

## Next

A closed choice (`DecisionQuestion::Choice`) with `sample_choice` is built and
tested for resident intent: pick among the legal candidates by probability
instead of a temperature-zero selection, with "none" as an option so a quiet
room stays quiet. Persistent attention and per-pair sentiment, as the original
Node cosyworld kept, can feed these questions as state.
