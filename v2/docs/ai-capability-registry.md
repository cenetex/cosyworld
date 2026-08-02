# AI capability registry

CosyWorld selects text and image inference through immutable, versioned
capability facts. The operator registry snapshot is execution metadata, never
kernel authority. It may
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

## Pack-bound exact models and raw speech

AI cast worldpacks may bind a resident directly to one OpenRouter model through
the compiled `actor_model_bindings` resource. This is separate from the
operator registry pools. A text-output resident enters the voice router with an
immutable selection from the checked-in binding. A text-input, image-output
resident enters the image-generation route with that same exact-binding rule
and publishes an `image.created` event after bounded decoding and vision
review. Provider-side resolution remains visible in self-contained attribution.
Other non-text bindings fail unavailable instead of borrowing the global Voice
model.

Raw speech deliberately removes CosyWorld's character prompt and resident
planner. The request contains the bounded incoming user line as its sole
message; it omits system text, configured reasoning effort, sampling defaults,
tools, and response formats. OpenRouter requests set
`provider.data_collection: "deny"` and add `provider.zdr: true` for bindings
whose catalog snapshot confirms a zero-data-retention endpoint.

Image output uses OpenRouter's dedicated `POST /images` route. The candidate is
stored outside public asset routes, decoded with byte and dimension limits, and
reviewed from visible pixels. Only an approved candidate is copied to immutable
public storage and journaled. The event keeps its asset digest, URL, dimensions,
MIME type, provider/model attribution, prompt version, and context hash, but not
the raw prompt or rejected bytes. Production still rejects a pack binding that
lacks the required no-retention/no-training declaration before network I/O.

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

Production preserves the ordinary privacy boundary. A pack-bound model without
snapshot-confirmed zero-data-retention eligibility is rejected before network
I/O; development may exercise it while still requesting data-collection
denial.

## Privacy and attribution

In `COSYWORLD_DEPLOY_PROFILE=production`, a text candidate is eligible only
when its declaration explicitly says `retention: "none"` and training is
`"prohibited"` or `"contractual_opt_out"`. Missing or provider-default policy
fails before an HTTP client or prompt payload is constructed. Local development
permits unknown policy so provider fixtures and local sidecars remain usable.

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
