# AI capability registry

CosyWorld selects operator-registry inference and pack-bound exact model
interactions through immutable, versioned capability facts. The registry and
interaction snapshots are execution metadata, never kernel authority. They may
contain hundreds of candidates, while each generation pins exactly one
candidate and sends only that model ID to the provider.

## Capabilities

- `voice` is conversational text. It is the broadest pool and may include small
  or unusual operational text models.
- `intent_json` is the bounded resident-intent contract. A candidate must
  declare JSON mode or structured output.
- `world_content` is strict structured content such as hidden pathway identity.
  A candidate must declare structured-output support.
- `image_generation` accepts text and produces an image. Exact-bound Elysium
  subjects use the same capability validation against their checked-in binding,
  rather than borrowing a model from a global text pool. Under
  [ADR 0007](../../docs/decisions/0007-model-bindings-and-item-devices.md), an
  image-only subject is a model-backed item device rather than a resident.
- `embeddings` and `rerank` rank existing records against a query. Under
  [ADR 0010](../../docs/decisions/0010-semantic-instruments-shape-memory.md) a
  binding of either kind powers a semantic instrument: an item whose holder gets
  a different ordering of the same history. The ranking is committed against an
  exact query event sequence and replay reads that commit, so no journal depends
  on the bound model and retiring one invalidates nothing.

Capabilities are independent. Discovery metadata is retained for inspection
but never grants eligibility. Only a normalized declared capability enters a
pool, and declaring a capability without its required text modalities and
parameters rejects the snapshot.

## Configuration

`COSYWORLD_AI_REGISTRY_JSON` contains a complete snapshot:

```json
{
  "schema_version": 1,
  "snapshot_version": "openrouter-2026-07-26.1",
  "declared": [
    {
      "requested_model_id": "provider/tiny-chat",
      "provider": "openrouter",
      "concrete_model": {
        "model_id": "provider/tiny-chat-2026-07-01",
        "revision": "2026-07-01"
      },
      "family": "tiny-chat",
      "size_class": "4b",
      "input_modalities": ["text"],
      "output_modalities": ["text"],
      "context_limit": 32768,
      "output_limit": 2048,
      "supported_parameters": {
        "structured_output": false,
        "json_mode": false,
        "tools": false,
        "seed": true,
        "stop": true
      },
      "data_policy": {
        "retention": "none",
        "training": "prohibited"
      },
      "prompt_adapter": {
        "id": "cosy-openai-chat",
        "version": "1"
      },
      "sampling": {
        "temperature": 0.8,
        "top_p": 0.95,
        "seed": 42,
        "stop": ["<END>"],
        "hard_output_cap": 160
      },
      "capabilities": ["voice"],
      "observations": {
        "input_cost_per_million": 0.05,
        "output_cost_per_million": 0.1,
        "latency_p50_ms": 280,
        "availability_ratio": 0.99,
        "gate_history": {
          "voice": {
            "passed": 91,
            "failed": 9,
            "last_gate_version": "voice-gate-3"
          }
        }
      }
    }
  ],
  "discovered": []
}
```

`declared` entries are operator-reviewed policy. `discovered` entries may
retain provider catalog modalities, limits, supported parameters, reported
capabilities, family/size hints, and observations, but remain ineligible until
a matching declaration exists. A matching declaration and discovery entry are
normalized into one candidate.

`data_policy` is truthful route metadata, not a production eligibility gate.
CosyWorld does not accept player-authored speech, prompts, microphone input, or
audio uploads; the global text pools receive only server-authored world input.
A production pool therefore keeps both ZDR and non-ZDR declared candidates.
When the pinned OpenRouter route declares `retention: "none"`, the gateway sends
`provider.data_collection: "deny"` and `provider.zdr: true`. Other routes send
neither field, so request policy never claims a guarantee the route lacks.

Production AI has no implicit registry fallback. When
`COSYWORLD_DEPLOY_PROFILE=production` and an AI credential or local AI endpoint
enables inference, startup requires `COSYWORLD_AI_REGISTRY_JSON` and rejects a
missing snapshot with operator recovery guidance. To run production with AI
disabled, omit `COSYWORLD_AI_API_KEY`, `OPENROUTER_API_KEY`, and
`OPENAI_API_KEY` and do not configure a loopback AI base URL. Development keeps
the legacy single-model fallback for local compatibility.

Use `COSYWORLD_AI_CAPABILITY_MODELS_JSON` to pin configured defaults without
collapsing the pools:

```sh
COSYWORLD_AI_CAPABILITY_MODELS_JSON='{"voice":"provider/tiny-chat","intent_json":"provider/planner","world_content":"provider/strict-generator","image_generation":"provider/image-generator"}'
```

If no capability-specific model is configured, the gateway uses the legacy
`COSYWORLD_AI_MODEL` only when it is eligible for that capability, then falls
back to the first candidate in the capability pool. Direct capability requests
still pin one candidate. Avatar voice publication uses the bounded exploration
router described below.

## Runtime readiness and account probes

OpenRouter starts in a probing state. A background scheduler immediately calls
the bounded current-key `/key` endpoint, then repeats after five minutes while
ready or after one minute while degraded. HTTP 401 and 402 open an account-wide
circuit after the first failed call; only a later successful key probe closes
that circuit. HTTP 429, 5xx, and transport/timeouts instead cool down only the
exact endpoint-and-model route, respecting a bounded `Retry-After`. A final 400
or 404 after the documented request-shape fallbacks marks only that exact route
incompatible.

Readiness is revalidated both when offers are composed and when Chat or a model
interaction is submitted. Probing, account blocks, and route cooldowns withhold
affected AI offers without rerouting them; deterministic cards and `/health`
remain available. `/meta.ai.readiness` exposes only sanitized state, reason and
retry timing, blocked-route count, and next-probe delay. It never exposes a key
balance. `COSYWORLD_AI_LOW_CREDIT_THRESHOLD` accepts a finite value from 0
through 10000 (default `5`); a positive remaining balance below it reports the
non-blocking `ai_credits_low` warning, while exhaustion blocks AI routes.

## Bounded voice exploration

Avatar chat and its follow-up select `voice` candidates by deterministic
weighted sampling without replacement. The inspectable decision record includes
Beta-smoothed publication-gate evidence, stable actor/family affinity, family
novelty, provider health, expected latency and cost, the nonzero exploration
floor, and the derived random/key values. Content evidence is keyed by resolved
model and revision, prompt-adapter ID and version, speech mode, and feature.
Endpoint availability and cooldown are stored separately, so transport failure
cannot count as a content failure.

The router is bounded by:

- `COSYWORLD_AI_VOICE_MAX_ATTEMPTS` (1–10, default 2); this is also the
  maximum response-pool size;
- `COSYWORLD_AI_VOICE_HEDGE_WIDTH` (1–10 and no greater than attempts, default
  1);
- `COSYWORLD_AI_VOICE_LATENCY_CEILING_MS` (default 12000);
- `COSYWORLD_AI_VOICE_SPEND_CEILING_MICRODOLLARS` (default 2000);
- `COSYWORLD_AI_VOICE_UNKNOWN_COST_MICRODOLLARS` (default 250); and
- `COSYWORLD_AI_VOICE_EXPLORATION_FLOOR_BPS` (default 500, or 5%).

Each generation is a durable leased job in the orchestrator SQLite store.
Every provider request is pinned to one selected candidate with provider-local
retries disabled. All responses completed inside the configured bounds pass
through the publication gate. Safety, grounding, envelope, completion,
repetition, speech mode, prose-quality, and action-authority checks remain hard
failures. The rotating beat-form check remains recorded in the receipt but is a
ranking preference, so sentence shape alone cannot turn a safe grounded Chat
into a visible failure. Certified responses are ranked deterministically by
scene-anchor depth, beat-form fit, novelty against recent dialogue, and lexical
diversity; candidate ID is the stable final tie-break. The highest ranked
response wins one atomic compare-and-set. Duplicate or restarted work returns
the accepted text and receipt without selecting again; an expired lease
receives at most one named retry. Exhausted bounds return a stable typed
unavailable code. Rejected candidates persist hashes, evidence, and decision
metadata, never raw output bytes. The existing publication journal precondition
remains the single writer for the final world-visible line.

A ten-response pool must opt in to both the attempt and spend limits. For
example, set `COSYWORLD_AI_VOICE_MAX_ATTEMPTS=10` and size
`COSYWORLD_AI_VOICE_SPEND_CEILING_MICRODOLLARS` for the selected model. Use
`COSYWORLD_AI_VOICE_HEDGE_WIDTH` to choose how much of that pool may run
concurrently. Production defaults remain conservative so enabling ranking does
not silently jump every chat to ten provider calls.

Resident intelligence uses the same bounded Voice router for public prose.
Decision beats make one separate `intent_json` request containing only the
triggering public event, bounded continuity/goals, and the exact current
planner-eligible candidate IDs plus their state revision. The declared
`resident-planner-offers-v1` policy is closed over reachable move, pickup, drop,
give, trade, and use-item offers. Other legal kinds, including search, stay in
deterministic hands; pickups needing an inventory exchange are excluded until
the schema can name the exact outgoing item. The strict response may echo only
a candidate ID/revision, closed speech act, and proposal reason.
Conversation-only beats and directly controlled proxy reactions skip the
planner.

Planner failure does not consume the Voice budget and degrades to rejected or
absent intent with no action. Before a pending action is journaled, the server
re-enumerates and compares the full authoritative candidate identity and fields.
The C kernel remains the only mutation authority. Journaled planning,
publication, causality, and eventual decision links replay without inference;
raw planner reasoning remains only in the planning trace and is never copied
into projected action state or promoted to world truth. Matching execution
durably records committed or rejected disposition; a newer accepted generation
supersedes the prior one, while a rejected new attempt does not mutate it.

## Pack-bound exact models and interaction profiles

An exact model is execution configuration, not automatically a resident.
[ADR 0007](../../docs/decisions/0007-model-bindings-and-item-devices.md)
requires a worldpack to declare whether the binding embodies an authored actor
or powers an item device. The current compatibility resource
`actor_model_bindings` supports actors only. The accepted additive direction is
`item_model_bindings` for portable, equipped, or installed items, normalized at
runtime with actor bindings into one discriminated exact-binding contract.
Actor packs may use `complete` coverage or an `explicit` subset. Unlisted actors
in an explicit pack use the ordinary configured controller route; a listed
actor remains pinned to its requested model. Binding IDs are pack-owned, so
several actors may deliberately share that model without sharing an identity.

The separate checked-in interaction-profile snapshot gives every binding one or
more explicit profiles. Each profile pins its endpoint, accepted inputs,
outputs, required parameters, defaults, provider availability, endpoint ZDR
fact, asynchronous/streaming behavior, and runtime-adapter status. An offer
requires both `provider_available` and `runtime_adapter_supported`, the exact
configured route, an eligible active subject, and the applicable runtime policy
gates. It always sends the binding's requested model ID; an unsupported model
never borrows the global Voice model or masquerades as Talk. The frozen
provider-availability snapshot also withholds a route observed to have no exact
endpoint, while runtime readiness suppresses newly failing routes between
snapshots. Readiness never changes the subject's actor-or-item embodiment.

`Talk` backs the existing bounded actor Chat exchange. Raw Talk deliberately
removes CosyWorld's character prompt and resident planner. Its sole message is the
bounded preceding server-generated dialogue line; it omits system text, tools,
response formats, and player input. If the catalog says the model accepts the
unified reasoning parameter, the first request asks for reasoning effort
`none`; other raw models receive no reasoning object. A precise HTTP 400 saying
that reasoning is mandatory gets one compatibility retry with reasoning enabled
but excluded from the visible response. A reasoning-control unsupported or
unrecognized HTTP 400 gets one retry with the reasoning object omitted. No
other provider error activates these shape fallbacks, and the normal retry loop
does not multiply them.

The other ready native profiles are device affordances unless their subject is
also an explicitly authored conversational actor:

- `Illustrate` calls the exact image route with a prompt derived only from the
  frozen actor, source device, location, and scene. The candidate is stored outside public
  asset routes, decoded with byte and dimension limits, and reviewed from
  visible pixels. Only an approved raster image is copied to immutable public
  storage and journaled. The event keeps its asset digest, URL, dimensions,
  MIME type, provider/model attribution, prompt version, and context hash, but
  not the prompt or rejected bytes.
- `Speak` is offered only when the snapshot pins an authoritative provider
  voice and MP3 output. Its input is a server-authored line of at most 280
  characters derived from frozen actor, device, and location facts. The resulting
  content-addressed audio is durably recovered and published with its digest,
  MIME type, exact attribution, and transcript. The avatar speaks through the
  voicebox; the device or model does not become the speaker.
- `Find resonance` freezes the latest visible room message as its query and up
  to eight earlier visible room messages as its corpus. It sends those texts to
  the exact embeddings endpoint, computes cosine similarity locally, and
  publishes the three closest earlier messages with event references and
  coarse score bands. The request stays pinned to the catalog model ID; when
  OpenRouter returns the serving backend's implementation ID instead,
  attribution preserves both the pinned requested ID and that truthful
  resolved ID.
- `Rank echoes` sends the same frozen room-message query and corpus to the
  exact rerank endpoint and publishes its top three earlier messages. Equal
  scores are resolved by stable event sequence. Neither semantic action
  journals a free-form prompt, embedding vectors, or raw scores, and neither
  action is offered until at least four earlier messages are available.

There is no player-authored speech or model prompt in any of these paths. The
browser submits only the current certified offer for the acting avatar and its
bound actor or item subject. It exposes no microphone, audio upload, arbitrary
text, model picker, provider tool, or prompt field.

Every other advertised modality still has a truthful profile and an explicit
reason it is withheld. `Transcribe` has a bounded exact STT gateway primitive,
but its action adapter stays dormant because CosyWorld accepts no authorized
human speech or audio upload. Asynchronous video and music composition remain
unavailable until their persistence adapters exist. A genuine two-way voice
profile may embody an actor only under an explicit actor contract and an
implemented streaming adapter. Vector-only image models remain unavailable
until a safe SVG rasterizer exists. These profiles are not rerouted through
Chat.

A dormant item remains visible and inspectable with this sanitized reason but
does not occupy either current action-hand slot. Provider or adapter recovery
can make the item's certified offer eligible; it cannot convert the item into
an avatar.

Exact interactions carry only server-authored world text. Production therefore
allows both ZDR and non-ZDR exact bindings. A profile whose snapshot says its
endpoint is ZDR sends OpenRouter `provider.data_collection: "deny"` and
`provider.zdr: true`; a non-ZDR profile sends no false privacy constraint. The
profile metadata preserves that truthful fact and does not turn it into an
eligibility claim. Operator-registry text pools follow the same rule because
their prompts are also server-authored.

Publication remains mandatory but uses a thin raw gate: envelope integrity,
non-empty and bounded output, terminal provider finish, repetition/duplicate
protection, and public safety still apply. Character voice, grounding,
single-speaker, prompt-language, proposed-action, and scenery-agency checks do
not. Raw replies can therefore identify their model or discuss prompts without
becoming world authority. The deterministic C kernel and journal still own all
state mutation.

Raw mode does not remove the ordinary spatial observation model; it only keeps
that state out of the provider prompt. In the accepted Elysium migration,
conversational actors retain private voids while each tool-only binding powers
the existing local Void Token as a curious device. The normal room, custody,
equipment, installed-item, and access boundaries limit observation and use
without a provider-specific engine shortcut. Actor canonical references retired
by that migration cannot silently become item references.

## Data policy and attribution

Production requires an explicit registry and still validates declared
capabilities, modalities, parameters, and model identity before making a
request. Retention and training declarations do not reject an otherwise valid
candidate: they describe what the selected route actually guarantees and are
preserved in attribution. This keeps non-ZDR models usable without laundering
them as ZDR.

Mutable aliases set `"mutable_alias": true` and omit `concrete_model`. The
provider response must then contain a different, concrete `model` value.
Missing or alias-only attribution fails closed. Fixed model requests also
prefer the returned provider model so provider fallbacks are recorded as the
model that actually ran.

Every successful selection produces self-contained attribution with:

- registry and attribution schema versions;
- capability, requested model, concrete returned model/revision, and provider;
- family and size class when known;
- prompt-adapter ID and version; and
- the selected route's data-policy declaration.

The pinned selection owns its candidate and snapshot version, so a later
catalog refresh cannot change an in-flight request. Persisted attribution does
not depend on the live registry; removed and unknown historical models remain
inspectable during replay.
