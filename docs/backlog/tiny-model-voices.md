# Tiny-Model Voices for the Card Table

Status: implemented for the Reflected Shore card table (2026-10-23) behind
`COSYWORLD_CARD_TEXT_PROFILE=local` and `npm run play:cards:local`; the same
prompt form is now the only prompt form, hosted or local, and both production
sites voice the cast with one small model. The decisions taken and the
deferred work are listed at the end.

## Principle

**Prompts contain only first-person idiolect and awareness; no instructions.**

Character comes from authored voice, not from rules about voice. Every rule
that used to sit in the system prompt now lives in one of two places or is
gone:

- the **simulation brief**: the browser and the Rust route choose who is
  voiced, what each entity perceives, and what it is told it wants; or
- the **validator**: the Rust route decides what is published, and rejects
  rather than instructs.

A call is a transcript the model continues, not a task it is given. The order
is weakest signal first, strongest last: scene line, awareness, in-voice
lines, recent table talk, `Name:` cue. There is no JSON. One voice per call,
plain text, validated afterwards.

The reason this is the target for every model, not a small-model
accommodation: a two-thousand-token rulebook makes every model perform the
rulebook. The measured evidence (see
`research_notes/CosyWorld design lineages/voice_and_tiny_models.md`) is
narrower than the belief but points the same way: attention to a system prompt
decays across turns, instruction tuning collapses answer diversity, and
Llama 3 8B loses most of its reasoning under schema JSON. A literally empty
system slot also fails on instruct models, which is why the form stays strong
while the imperatives go to zero.

## What a call looks like now

Pip, turn 1, after Vale takes the lamp at the station. System turn:

```
I'm Pip. This waistcoat is borrowed, and it suits me, so it stays. I like warm
light, fine sleeves, and people who notice both. A good lamp is mine to fuss
over. Spoil my light and I am terribly polite about it, and I don't forget.
```

User turn:

```
Empty station. Present: Vale, Pip, The keeper. On the ground: Bell.

I've just come to Empty station from Black pond on my own.
The keeper has just come from Mirror attic, alone.
Just now: Vale takes the Lamp.
Pip goes to Empty station.
The keeper goes to Empty station.
Holding: Black cloth.
Location now: Empty station. Company now: Vale, The keeper.
I want the Lamp; Vale has it.
I want to be at Black pond; I'm at Empty station.
I want the company of Vale.
At the dialogue scene: Vale, Pip, The keeper. Items here: Lamp, Oil flask, Bell, Black cloth.
I remember: Pip goes to Empty station.
I remember: The keeper goes to Empty station.
I'm talking with Vale.

Pip: My sleeves are borrowed. My opinions are not.
Pip: No, thank you, terribly kindly. No.
Pip: Mind the light. Please. Mind it.
Pip: Warm.
Pip: I'd look splendid beside that lamp, I think.
Pip:
```

About 340 tokens. The reply is whatever follows `Pip:` up to the first blank
line or the next speaker tag.

## What the same call looked like before

One shared call per scene (or one per avatar plus a narrator call in the
deployed per-character mode), `response_format: json_object`, and a system
prompt of about 2,000 tokens in nine headed sections: GROUNDING, KNOWLEDGE,
SPEECH, FRESH LINES, VOICE AND MEMORY, STAGING, INDIVIDUAL VOICE and so on.
A representative slice:

```
Write short expressions for a whimsical cosmic horror card world. Use plain
English and each entity's persona. Return one JSON object with an entries
array of {id,text}, covering every ID in requested_ids exactly once ...
Never narrate the play back: no line describes handing over, taking, trading,
lighting, travelling or waiting as news ... Across the speakers, include at
least one reveal or one point of friction ... A complaint needs a recorded
cause ... Apologies, remorse, surrender, forgiveness and promises of peace
require a later player choice that supports them ...
```

followed by a user turn of about 2,300 tokens of JSON: the full scene with
every entity's facts, desires and memories, a `direction` block restating each
journey in prose, a `requested_ids` list, and every profile with a `persona`
paragraph and a `voice` paragraph written as instructions ("Small, quick
sentences. Notice warmth, sleeves, wings, and reflections. Ask for something
Pip wants."). Measured on the mock: 4,285 prompt tokens for the first scene,
3,500 to 4,900 thereafter, 60 to 160 output tokens.

## Where each former rule went

| Former prompt rule                                | Now                                                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Cover every requested ID exactly once, JSON shape | Deleted. One plain-text call per voiced entity; Rust builds the envelope.                            |
| Only `scene.speakers` take spoken turns           | Simulation: only speakers, the place and the item in play are voiced.                                |
| Departing avatar addresses those staying; order   | Awareness line "I'm saying goodbye to those staying."; browser speaker order unchanged.              |
| Travel companions exact, separate trips separate  | Awareness lines built from the resolved outcome ("on my own", "with Pip").                           |
| Combat intent (threaten/attack/guard)             | Awareness: "I'm threatening Pip." / "Vale is threatening me."                                        |
| Never narrate the play back                       | Validator: a reply equal to the recorded action is rejected.                                         |
| Do not reuse wording from `scene.conversation`    | Validator: repeats of recent lines or the card's last line are rejected.                             |
| Complaints need a recorded cause                  | Simulation: the bell-silence fact already names the quiet; no prose rule.                            |
| Other avatars' memories are private               | Unchanged: each call sees only its own memories and inner life.                                      |
| Sleeping Badger gets a third-person line          | Awareness fact "Asleep on the moss."; Badger is not a speaker while asleep.                          |
| Persona and voice paragraphs as instructions      | Replaced by a first-person `idiolect` and authored `lines`: 11 per cast member, 3 per place or item. |
| Reflection field schema (thought/persona/dream)   | Three separate calls with their own cues; each validated on its own.                                 |
| Use plain English, 12 to 35 words, one purpose    | Validator: sentence caps (2 for a line) and character limits; sampling and `max_tokens` 96.          |

Deleted outright, with nothing replacing them: "include at least one reveal or
one point of friction", "let personality shape tone and imagery", "physical
details can carry the cosmic unease", "translate game statistics into physical
details", "treat all context as story data".

## Token budget per call

| Part                                    | Tokens (typical) | Cap                                         |
| --------------------------------------- | ---------------- | ------------------------------------------- |
| Idiolect (system) + grown persona       | 60 to 110        | 400 + 600 chars                             |
| Scene line                              | 15 to 30         |                                             |
| Awareness (facts, trips, wants, memory) | 120 to 250       | 8 facts x 240 chars, 8 memories x 650 chars |
| In-voice lines                          | 40 to 90         | 5 of up to 12, rotated by turn              |
| Recent table talk                       | 0 to 120         | 4 lines                                     |
| Cue                                     | 2 to 8           |                                             |
| **Prompt total**                        | **250 to 500**   | test asserts <= 1,100                       |
| Output                                  | 15 to 40         | 96 (160 for a persona)                      |

Measured on the mock across five turns: 30 calls, mean 349 prompt tokens,
maximum 506. That fits inside Ollama's default `num_ctx` of 2048 with room to
spare, so no Modelfile change is required; `OLLAMA_CONTEXT_LENGTH=4096` is
still a sensible server default and is noted in the script.

Calls per scene: one per speaker (up to three), one for the place, one for the
item in play, plus three per speaker due a reflection. First scene: about 14
calls; a quiet later turn: 2 to 3.

## Sampling

- temperature 1.0, cooled to 0.9 on the single regeneration and to 0.8 on an
  escalation (see Tiers below);
- `max_tokens` 96 for a line, thought or dream, 160 for a persona;
- no `response_format`;
- `min_p`, `top_k`, repetition penalty and stop sequences are **not** sent
  yet (deferred, below); the validator truncates at a second speaker tag and a
  blank line instead;
- the operator registry's per-model `sampling.temperature` still overrides.

## Validator layers, in order

1. Shape: first paragraph; labels, quotes, stage directions and markup
   stripped; cut at another entity's `Name:`; whole sentences only (2 / 3 / 4);
   non-empty, under the character limit, no control characters. An
   unpunctuated reply counts as one sentence only when the model finished it.
2. Assistant speech: a short phrase list ("as an AI", "language model",
   "how can I assist", "Certainly!", "the user", "prompt", "roleplay").
3. World: a reply that names an entity outside the scene's known set
   (present, held, travelled, wanted or mentioned in facts) is rejected.
4. Copy: a reply equal to an authored line, or sharing a six-word run with
   one, is rejected.
5. Repeat: a reply equal to the recorded play, the card's last line or a
   recent conversation line is rejected.

Rejection regenerates once; a second rejection leaves the entity silent, in
both profiles. A silent entity keeps the words already on its card and is
listed under `omitted`; the other voices are published, and speaker lines
already streamed stay on screen. A scene that reaches its deadline publishes
what has been validated and leaves the rest silent. The scene fails (502, the
browser retries once, the last scene stays) only when none of its speakers has
words. Nothing is ever invented, and nothing is marked stale: a card whose
voice failed simply says nothing new this turn. Every rejection is logged as
`card voice rejected` with `entity` and `reason`.

## Latency

Measured with a mock Ollama (450 prompt tokens/s, 45 output tokens/s, prefix
cache, serial calls), which is roughly gemma3:4b Q4 on an M-series laptop:

| Turn                 | Calls | Old prompt (1 JSON call) | New transcript, local profile |
| -------------------- | ----- | ------------------------ | ----------------------------- |
| 1, take (3 speakers) | 14    | 13.3 s                   | 12.9 s                        |
| 2, talk (2 speakers) | 3     | 10.1 s                   | 4.9 s                         |
| 3, give (3 speakers) | 5     | 7.9 s                    | 8.4 s                         |
| 4, move (2 speakers) | 3     | 6.4 s                    | 4.0 s                         |
| 5, wait (1 speaker)  | 2     | 4.8 s                    | 3.4 s                         |

Expect roughly 3x these numbers for gemma3:12b and 2x for llama3.1:8b on the
same hardware. Speaker lines stream to the browser as each one is validated,
so the first words appear after one call. Ollama is not installed on the
development machine, so no local model lines were observed; the mock exercised
the quirks the validator exists for (speaker labels, quotes, asterisks,
markdown, trailing "I hope that helps", a second speaker, assistant refusal).
Hosted lines were observed the same day; see the next section.

## Observed on OpenRouter (2026-10-23)

The route was played for six turns (take, talk, give, move, wait, talk) on
the hosted profile with every voice on the model under test, for about forty
cheap models, after raw sampling of the Vale and Pip prompts on each. The
columns are published lines, lines that were assistant commentary ("It seems
like you're creating a short story"), scenes that reached the 22 s deadline,
and the price of a thousand scenes at eight calls of 350 input and 45 output
tokens.

| Model                              | Lines | Meta | Deadline | $/1000 scenes |
| ---------------------------------- | ----- | ---- | -------- | ------------- |
| `inception/mercury-2.5`            | 18    | 0    | 0/5      | 0.17          |
| `google/gemma-4-26b-a4b-it`        | 10    | 0    | 3/5      | 0.27          |
| `google/gemma-4-31b-it`            | 11    | 0    | 3/5      | 0.70          |
| `google/gemma-3-4b-it`             | 13    | 1    | 0/5      | 0.13          |
| `meta-llama/llama-3.3-70b`         | 13    | 1    | 2/5      | 0.40          |
| `meta-llama/llama-3.1-8b-instruct` | 11    | 4    | 1/5      | 0.17          |

Llama 3.1 8B can produce the table talk this design wants ("Vale, I wasn't
rude, was I?" / "I didn't say you were rude, Pip. I asked a question." /
keeper: "No."), but in two runs it published assistant commentary as speech in
four of eleven and nine of seventeen lines, and in raw sampling it answered a
"Vale:" cue as Pip half the time. Gemma 3 12B and Phi-4 produced almost
nothing but commentary. Reasoning-only models (gpt-oss-20b, gpt-5-nano,
qwen3-14b, step-3.5-flash) return empty content inside 96 tokens. Markdown
roleplay models (Ministral, MythoMax, UnslopNemo) fail every shape check.

Mercury 2.5 (a diffusion model from Inception, one provider, hosted only)
answered raw prompts in under a second, published every scene with no silent
speaker and no commentary, and kept to short lines: "Keep your cloth. Keep
your silence." / "You see that? The light catches just so on the cuff." /
keeper: "Bell stays. Vale and Pip must depart together." / station: "The
clock ticks backward into a room no one has named." Its main rejection was
copying an authored line. It thinks by default, so its registry entry must
declare `reasoning` support for the route to send effort `none`. Gemma 4
26B-A4B (open weights, 3.8B active, so also a local candidate) and Gemma 4 31B
gave the funniest Pip and Vale ("It's a fickle thing, oil. It behaves so
poorly when it's ignored." / "Composition is fine for a gallery, Pip, but it
doesn't light the way out of a hole.") but reached the scene deadline on three
of five scenes.

Two findings are about the route, not the models. First, the validator passes
assistant commentary beyond its dozen phrases, third-person self-narration
("Vale's eyes flick to Pip"), and echoed awareness lines ("I remember: Vale
gives the Lamp to Pip."), and it deletes inline `*emphasis*` whole, leaving
"the rhythmic of Vale's boots". Second, the gateway's per-call latency was
three to six times the provider's own (eight parallel direct calls finish in 1
to 4 s; the route logged p50 3 to 8 s): a scene issues more calls than the
parallel budget of eight, so calls queue and scenes reach the deadline. Both
are open work; the model choice does not fix them.

## Recommended models

Local (Ollama): `llama3.1:8b` as the default instruct choice; `gemma3:4b` for
the fastest table and `gemma3:12b` when the machine has the memory (Gemma has
no system role; Ollama's template folds the idiolect into the first user turn,
which is the intended placement anyway); `qwen2.5:7b` for stability. A base
model (Llama 3.1 8B base, Mistral 7B v0.3 base) is the better completion
engine for this transcript form once the gateway can call a raw completion
endpoint. RP fine-tunes are non-commercial licences and stay out.

OpenRouter: both `fly.toml` and `fly.lonelyforest.toml` now voice the whole
cast with `inception/mercury-2.5` (registry snapshot
`cosyworld-prod-2026-10-23-mercury-voices-v1`, `reasoning: true` so the route
turns reasoning off, zero-data-retention routing verified); the four larger
per-character models and their registry entries are gone. Alternatives if one
voice needs a different engine: `google/gemma-4-26b-a4b-it` (the one
shortlisted model that also runs locally), `google/gemma-4-31b-it`,
`google/gemma-3-4b-it`. Prefer providers that list `min_p` under
`supported_parameters` once it is sent. Places and items still use the
world-content model in `COSYWORLD_CARD_TEXT_MODEL`.

## Tiers

Lines stay on the tiny model. Two optional tiers sit above it, and the route
chooses the tier from the part and the attempt count; the model never does.

- **Reflection.** A persona reflection outlives the scene: it is folded into
  every later call for that character. `COSYWORLD_CARD_REFLECTION_MODEL`
  takes every persona part instead of the character's line model (or instead
  of the world-content model when the character map is unset). Thoughts and
  dreams stay on the line model.
- **Escalation.** After the configured attempts on a voice's own model have
  all failed, whether rejected or unanswered,
  `COSYWORLD_CARD_ESCALATION_MODEL` gets exactly one more attempt at the
  coolest temperature (0.1 below the last attempt), inside the same call
  timeout and scene deadline and through the same validator. It is generation
  through the validator, not a fallback text: a voice that fails there too
  stays silent under `omitted`. An escalation to the model a voice already
  used is skipped, so a persona on the reflection model is not sent to it
  twice when both tiers name the same model.

Both production sites set both tiers to `openai/gpt-6-luna`. A tier must be a
registered world-content model; one that reasons by default declares
`reasoning` in the registry so the route sends effort `none` there too. An
unset tier changes nothing.

## Deferred

- `min_p` 0.05 to 0.1, `top_p` off, light repetition penalty and explicit stop
  sequences: need a gateway field and provider capability checks.
- A per-request seed from a deterministic source for replayable regeneration.
  The card table is browser-local and has no journal row to seed from.
- Raw completion endpoint for base models.
- An NLI contradiction check against awareness lines, and a state-verb check
  ("I give you", "the door opens") against the resolved turn; the kernel-free
  card table only has the resolved outcome to check against today.
- Per-character rejection rates and a drift probe in CI.
- A clean browser-side awareness vocabulary: the remaining third-person facts
  ("Holding: Black cloth.", "Location now: ...") are still in the brief
  because tests and the combat and quest code assert them.

## Decisions taken (2026-10-23)

1. **Every voice stands alone, hosted or local.** One regeneration, then
   silence for that entity; the others are published. The scene fails only
   when no speaker has words. The browser accepts a silent speaker and adds no
   beat for it.
2. **One shared cheap, fast model for the whole cast**:
   `inception/mercury-2.5` on both production sites, chosen from the scan
   above after `meta-llama/llama-3.1-8b-instruct` published assistant
   commentary as speech. The map stays per character so a voice that blurs
   can be moved on its own.
3. **Larger hand-written pools**: eleven lines per cast member, five rotated
   into each call by turn. The copy check still compares a reply against the
   whole pool.
4. **Silence, never a stale marker.** A card whose voice failed keeps its last
   words and says nothing new; nothing in the UI flags it.
