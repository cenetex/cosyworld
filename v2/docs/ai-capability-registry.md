# AI capability registry

CosyWorld selects operator-registry inference and per-character exact model
interactions through immutable, versioned capability facts. The registry is
execution metadata, never game authority: the card rules decide every outcome.
It may contain hundreds of candidates, while each generation pins exactly one
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
  ADR 0007, an
  image-only subject is a model-backed item device rather than a resident.
- `embeddings` and `rerank` rank existing records against a query. Under
  ADR 0010 a
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

`supported_parameters.temperature` is optional. Leave it out and the gateway
sends a request temperature as before. Set it to `false` for endpoints whose
provider catalog omits `temperature`, such as `openai/gpt-6-luna` and
`anthropic/claude-haiku-5.5`; the gateway and the browser card-call plan then
omit temperature for that model, including a registry `sampling.temperature`.
Discovered catalog entries record it from the provider's parameter list.

`data_policy` is truthful route metadata, not a production eligibility gate.
CosyWorld does not accept player-authored speech, prompts, microphone input, or
audio uploads; the global text pools receive only server-authored world input.
A production pool therefore keeps both ZDR and non-ZDR declared candidates.
When the pinned OpenRouter route declares `retention: "none"`, the gateway sends
`provider.data_collection: "deny"` and `provider.zdr: true`. Other routes send
neither field, so request policy never claims a guarantee the route lacks.

Every server OpenRouter request (chat, voice, batch, image and key
calls) names the app as `HTTP-Referer: https://lonelyforest.com` and
`X-Title`/`X-OpenRouter-Title: Lonely Forest` (`OPENROUTER_APP_REFERER` and
`OPENROUTER_APP_TITLE` in `ai_gateway.rs`), so OpenRouter stats show Lonely
Forest for production and `.dev` alike. Player-key calls from the browser send
the same title.

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
that circuit. HTTP 429 instead cools down only the exact endpoint-and-model
route, respecting a bounded `Retry-After`. A 5xx or a transport failure or
timeout opens that route only when it repeats: the third fault within sixty
seconds opens it for ten seconds. The route is then half-open for a minute:
calls pass, the first fault reopens it at once, and the first success closes
it. One slow or failed call therefore never blocks a model for every other
caller ([#2016](https://github.com/cenetex/cosyworld/issues/2016)). A final
400 or 404 after the documented request-shape fallbacks marks only that exact
route incompatible.

### The model bench

A model that keeps failing is benched, a tier above the route breaker
(`ai_bench.rs`). Its route opening three times within thirty minutes after 5xx
or transport faults, half-open reopens included, benches it. So do six card
voices on it within thirty minutes that end with no usable line: an empty
reply, or one the validator blocks on every attempt. A usable line clears
those strikes, so a busy model is not benched for being busy. HTTP 401, 402,
404 and 429 never bench a model.

A bench lasts six hours. Every call on the exact model then fails at once with
the retryable `ai_model_benched` code and no provider call, on every endpoint,
so the card voice's fallback chain skips it and its next model speaks
([card voices](../card-game/README.md)). Each model in that chain,
`COSYWORLD_CARD_FALLBACK_MODELS`, must be pinned in the registry for world
content, or card scenes are refused until it is. Benches are process-wide per
exact model, like the breaker, and live in memory: a restart clears them.
`COSYWORLD_AI_BENCH_ROUTE_OPENS` (default `3`),
`COSYWORLD_AI_BENCH_SILENT_VOICES` (`6`), `COSYWORLD_AI_BENCH_WINDOW_MINUTES`
(`30`) and `COSYWORLD_AI_BENCH_HOURS` (`6`) tune it; `0` turns a trigger, or
the bench, off, and an unreadable value keeps its default.

A bench ends on its own, then the model starts with no strikes. An operator
ends one early with `POST /moderation/ai/unbench` and body `{"model": "<id>"}`,
behind the moderation bearer token. `/meta.ai.benched` lists
`{model, since, until, reason, trips}` in unix seconds, with reason
`route_opens` or `silent_voices`; `/meta.card_voice.benches` counts benches.
Logs carry one `ai_model_benched` line per bench and one `ai_model_unbenched`
line per end, with cause `expired` (logged on the next read) or `operator`.

Readiness is revalidated both when offers are composed and when Chat or a model
interaction is submitted. Probing, account blocks, and route cooldowns withhold
affected AI offers without rerouting them; deterministic cards and `/health`
remain available. `/meta.ai.readiness` exposes only sanitized state, reason and
retry timing, blocked-route count, and next-probe delay. It never exposes a key
balance. `COSYWORLD_AI_LOW_CREDIT_THRESHOLD` accepts a finite value from 0
through 10000 (default `5`); a positive remaining balance below it reports the
non-blocking `ai_credits_low` warning, while exhaustion blocks AI routes.

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
