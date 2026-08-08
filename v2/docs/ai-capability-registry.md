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
- `image_generation` accepts text and produces an image. Elysium residents use
  the same capability validation against their exact checked-in actor binding,
  rather than borrowing a model from a global text pool.

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
through the hard publication gate. Certified responses are ranked
deterministically by scene-anchor depth, novelty against recent dialogue, and
lexical diversity; candidate ID is the stable final tie-break. The highest
ranked response wins one atomic compare-and-set. Duplicate or restarted work
returns the accepted text and receipt without selecting again; an expired lease
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

AI cast worldpacks may bind a resident directly to one OpenRouter model through
the compiled `actor_model_bindings` resource. The separate checked-in
`actor_interaction_profiles` snapshot gives every binding one or more explicit
interaction profiles. Each profile pins its endpoint, accepted inputs, outputs,
required parameters, defaults, provider availability, endpoint ZDR fact, and
runtime-adapter status. An offer requires both `provider_available` and
`runtime_adapter_supported`, the exact configured route, and the applicable
runtime policy gates. It always sends the binding's requested model ID; an
unsupported model never borrows the global Voice model or masquerades as Talk.

`Talk` backs the existing bounded Chat exchange. Raw Talk deliberately removes
CosyWorld's character prompt and resident planner. Its sole message is the
bounded preceding server-generated dialogue line; it omits system text, tools,
response formats, and player input. If the catalog says the model accepts the
unified reasoning parameter, the first request asks for reasoning effort
`none`; other raw models receive no reasoning object. A precise HTTP 400 saying
that reasoning is mandatory gets one compatibility retry with reasoning enabled
but excluded from the visible response. A reasoning-control unsupported or
unrecognized HTTP 400 gets one retry with the reasoning object omitted. No
other provider error activates these shape fallbacks, and the normal retry loop
does not multiply them.

The other ready native profiles are:

- `Illustrate` calls the exact image route with a prompt derived only from the
  frozen resident, location, and scene. The candidate is stored outside public
  asset routes, decoded with byte and dimension limits, and reviewed from
  visible pixels. Only an approved raster image is copied to immutable public
  storage and journaled. The event keeps its asset digest, URL, dimensions,
  MIME type, provider/model attribution, prompt version, and context hash, but
  not the prompt or rejected bytes.
- `Speak` is offered only when the snapshot pins an authoritative provider
  voice and MP3 output. Its input is a server-authored line of at most 280
  characters derived from frozen resident and location facts. The resulting
  content-addressed audio is durably recovered and published with its digest,
  MIME type, exact attribution, and transcript.
- `Find resonance` sends one frozen model descriptor and eight deterministic
  neighboring descriptors to the exact embeddings endpoint, computes cosine
  similarity locally, and publishes only the top three coarse matches.
- `Rank echoes` sends the same server-authored descriptor set to the exact
  rerank endpoint and publishes the provider's top three matches. Neither
  semantic action journals its prompt, embedding vectors, or raw scores.

There is no player-authored speech or model prompt in any of these paths. The
browser sends only the acting avatar and target resident certified by the
current offer. It exposes no microphone, audio upload, arbitrary text, or
prompt field.

Every other advertised modality still has a truthful profile and an explicit
reason it is withheld. `Transcribe` has a bounded exact STT gateway primitive,
but its action adapter stays dormant because CosyWorld accepts no human speech
or audio upload. Asynchronous video, mixed audio/text voice chat, and music
composition remain unavailable until their persistence and streaming adapters
exist. Vector-only image models remain unavailable until a safe SVG rasterizer
exists. These profiles are not rerouted through Chat.

Exact interactions carry only server-authored world text. Production therefore
allows both ZDR and non-ZDR exact bindings. A profile whose snapshot says its
endpoint is ZDR sends OpenRouter `provider.data_collection: "deny"` and
`provider.zdr: true`; a non-ZDR profile sends no false privacy constraint. The
profile metadata preserves that truthful fact and does not turn it into an
eligibility claim. The stricter no-retention/no-training gate for
operator-registry pools remains unchanged.

Publication remains mandatory but uses a thin raw gate: envelope integrity,
non-empty and bounded output, terminal provider finish, repetition/duplicate
protection, and public safety still apply. Character voice, grounding,
single-speaker, prompt-language, proposed-action, and scenery-agency checks do
not. Raw replies can therefore identify their model or discuss prompts without
becoming world authority. The deterministic C kernel and journal still own all
state mutation.

Raw mode does not remove the ordinary spatial observation model; it only keeps
that state out of the provider prompt. Elysium gives every exact-model avatar
one private void and one local void token, so the normal room boundary limits
belief observation and exchange without a provider-specific engine shortcut.

## Privacy and attribution

In `COSYWORLD_DEPLOY_PROFILE=production`, an operator-registry text candidate
is eligible only when its declaration explicitly says `retention: "none"` and
training is `"prohibited"` or `"contractual_opt_out"`. Missing or
provider-default policy fails before an HTTP client or prompt payload is
constructed. Local development permits unknown policy so provider fixtures and
local sidecars remain usable.

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
- the data-policy declaration used for eligibility.

The pinned selection owns its candidate and snapshot version, so a later
catalog refresh cannot change an in-flight request. Persisted attribution does
not depend on the live registry; removed and unknown historical models remain
inspectable during replay.
