# AI capability registry

CosyWorld selects text inference through an immutable, versioned registry
snapshot. The registry is execution metadata, never kernel authority. It may
contain hundreds of candidates, while each generation pins exactly one
candidate and sends only that model ID to the provider.

## Capabilities

- `voice` is conversational text. It is the broadest pool and may include small
  or unusual operational text models.
- `intent_json` is the bounded resident-intent contract. A candidate must
  declare JSON mode or structured output.
- `world_content` is strict structured content such as hidden pathway identity.
  A candidate must declare structured-output support.

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

Use `COSYWORLD_AI_CAPABILITY_MODELS_JSON` to pin configured defaults without
collapsing the pools:

```sh
COSYWORLD_AI_CAPABILITY_MODELS_JSON='{"voice":"provider/tiny-chat","intent_json":"provider/planner","world_content":"provider/strict-generator"}'
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

- `COSYWORLD_AI_VOICE_MAX_ATTEMPTS` (1–3, default 2);
- `COSYWORLD_AI_VOICE_HEDGE_WIDTH` (1–3 and no greater than attempts, default 1);
- `COSYWORLD_AI_VOICE_LATENCY_CEILING_MS` (default 12000);
- `COSYWORLD_AI_VOICE_SPEND_CEILING_MICRODOLLARS` (default 2000);
- `COSYWORLD_AI_VOICE_UNKNOWN_COST_MICRODOLLARS` (default 250); and
- `COSYWORLD_AI_VOICE_EXPLORATION_FLOOR_BPS` (default 500, or 5%).

Each generation is a durable leased job in the orchestrator SQLite store.
Every provider request is pinned to one selected candidate with provider-local
retries disabled. The first publication-gate pass wins an atomic compare-and-set
and cancels remaining hedges. Duplicate or restarted work returns the accepted
text and receipt without selecting again; an expired lease receives at most one
named retry. Exhausted bounds return a stable typed unavailable code. Rejected
candidates persist hashes, evidence, and decision metadata, never raw output
bytes. The existing publication journal precondition remains the single writer
for the final world-visible line.

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
