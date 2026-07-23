# CosyWorld 2.0 AI, Media, BYOK, And Combat Design

## Summary

CosyWorld should use AI as a world actor, not as a private chatbot.

`Chat` is the player-facing friendship action. It appears only when the avatar
has banked advancement and a nearby resident is eligible for a new Bond; playing
it spends one advancement point, creates that friendship, and passes the room
turn. It never accepts text or spends Orbs. Moderated player-authored room speech
uses the separate turn-exempt `say` action.

Every successful scene-card play arms one room dialogue heartbeat about three
seconds later. At most one heartbeat can be pending per room, so rapid card plays
do not create a reply backlog. The next resident in authored card order receives
the triggering event, recent played-card/log activity, recent room speech,
location memory, cast, goals, and personal continuity before proposing one
public reply.

Ruby High's quiz loop maps to CosyWorld's encounter loop. Where Ruby High offers quiz answers, CosyWorld offers rule actions: `Attack`, `Defend`, `Flee`, and `Use`. Combat and challenges can earn Orbs. The sole player-facing Orb sink is pooled community image generation.

## Source Findings

### Current V2

Relevant implementation points:

- `v2/orchestrator-rust/src/main.rs` already supports OpenAI-compatible text generation through `AiConfig`.
- `AiConfig` reads `COSYWORLD_AI_API_KEY`, `OPENROUTER_API_KEY`, or `OPENAI_API_KEY`.
- OpenRouter defaults to `https://openrouter.ai/api/v1` and `x-ai/grok-4.5`.
- `POST /actions/create-bond` is projected as `Chat` only when advancement and an eligible nearby resident are available. The legacy `/actions/chat` endpoint delegates to the same advancement-backed behavior.
- `POST /actions/say` is a separate, non-AI route: it takes player-typed `content` directly, moderates/sanitizes it, and commits it as a `message.created` room event with no LLM call involved. This is the human-typed room-speech path that `Chat` intentionally does not provide.
- Successful card commits atomically enqueue a delayed, durable room heartbeat. One pending/running heartbeat per room coalesces later cards.
- Resident replies are one-to-many world events. Their inference context includes the current card event and recent channel log, not only the latest spoken line.
- Chat has no Orb affordability check or ledger mutation; its authoritative cost is one advancement point.
- Generated cards use deterministic/local art as a safe fallback. Eligible avatars, runtime items, and familiar generated locations can replace it through a community-funded Replicate image job.
- The C kernel already has combat primitives for safe-room rejection, attack, defend, flee, and potion use.

### Legacy CosyWorld

Relevant migration points:

- `src/services/ai/openrouterAIService.mjs` has strong text and structured-output machinery, but its OpenRouter image generation and image composition methods are stubs unless the model is routed through Replicate.
- `src/services/ai/googleAIService.mjs` has a working `composeImageWithGemini` path and uploads generated images through S3.
- `src/services/tools/tools/SelfieTool.mjs` and `SceneCameraTool.mjs` already define the right media concepts: gather actor, location, and item references, compose a scene, upload it, then attach it to a world/social event.
- `src/services/battle/battleMediaService.mjs` already knows how to request 16:9 battle images with attacker, defender, and location references.
- `src/services/battle/combatEncounterService.mjs`, `battleService.mjs`, and `statService.mjs` are the D&D-shaped rules source, but v2 should keep final rule resolution in the C kernel.

### Ruby High

Relevant migration points:

- `../app-ruby-high/src/services/auth-service.ts` implements OpenRouter PKCE auth and opaque cookie identity. It deliberately does not persist the OpenRouter API key server-side.
- `../app-ruby-high/src/services/llm-provider.ts` centralizes OpenRouter/local model routing, headers, timeouts, and usage logging.
- `../app-ruby-high/src/services/avatar-chat.ts` streams one generated player avatar line and cleans unusable output.
- `../app-ruby-high/src/services/character-generation.ts` generates portraits and composite class/graduation photos through OpenRouter image models using `modalities: ["image", "text"]`.
- Ruby High's Merit Star quote/spend flow is useful historical input for atomic funding, but CosyWorld applies that pattern only to shared image generation, never Chat.

### OpenRouter Platform

Official OpenRouter docs confirm the integration shape:

- Authentication uses Bearer tokens, and API keys can have credit limits and OAuth flows: https://openrouter.ai/docs/api/reference/authentication
- Key credit/rate information can be checked with `GET https://openrouter.ai/api/v1/key`: https://openrouter.ai/docs/api/reference/limits
- Image generation is available through Chat Completions and Responses, with image-capable models discoverable via `output_modalities=image`: https://openrouter.ai/docs/guides/overview/multimodal/image-generation
- The Models API exposes model architecture, modalities, pricing, and supported parameters: https://openrouter.ai/docs/api/api-reference/models/get-models
- Structured outputs use `response_format` with JSON schema on compatible models: https://openrouter.ai/docs/guides/features/structured-outputs

## Non-Negotiable Invariants

- AI may propose text, media, and future content. The C kernel decides world state.
- Every player-visible AI result is committed as a shared room event.
- No DMs, no private resident conversations, no one-on-one teacher mode.
- A connected user key changes who pays; it does not create a private world.
- One user-paid action can benefit everyone present because the output is a public event.
- Autonomous resident actions and swarm jobs use the server budget unless an admin explicitly runs them.
- The client never decides Orb affordability, image eligibility, model access, combat outcomes, rewards, or inventory use.
- Orbs may be debited only by the authoritative community-image funding route.
- No raw OpenRouter key is ever written to logs, event payloads, screenshots, or analytics.

## Payment Modes

### Player OpenRouter Mode

The player may connect an OpenRouter account or API key for explicitly supported provider features. Neither Chat nor ambient room replies cost Orbs.

Recommended MVP shape:

- Reuse Ruby High's PKCE flow where possible.
- The browser receives and stores the OpenRouter key, and sends it only with explicit player-initiated AI actions.
- The server uses the key transiently for that action and does not persist it.
- The server stores only account identity, wallet/session link, provider label, and verification metadata.
- The server verifies the key with OpenRouter's `/api/v1/key` endpoint before enabling the mode.
- The client can show compact key state such as "OpenRouter connected", label, remaining credits, or limited/unlimited status.
- A player can disconnect, rotate, or replace the key at any time.

This follows Ruby High's main safety choice: the CosyWorld server is not a long-lived third-party API-key vault in the first release.

Tradeoff:

- Local browser storage is not perfect. The mitigation is OpenRouter key credit limits, explicit disconnect, HTTPS only, and never echoing the key back into app state.
- If cross-device persistence becomes important, add an encrypted server vault as a separate opt-in feature after security review.

### CosyWorld Server-Paid Mode

The server key pays for autonomous/public text inference, including the resident
reply after Chat and other card plays. Failure is skipped or remains visible as
appropriate, but no reservation, debit, or refund touches the Orb ledger.

Community image generation is different: the server validates a level-scoped shared funding pool before starting Replicate. One card gets one generation at each level, the pooled Orb price equals that level, and retries after full funding are free.

### Payer Matrix

| Feature | Player OpenRouter | CosyWorld Server Key | Orb Cost |
| --- | --- | --- | --- |
| Player presses `Chat` | no | no inference required to create the Bond | 0 Orbs; 1 advancement |
| Delayed resident heartbeat | no | yes, when configured | 0 |
| Community card image (avatar/item/location) | future option | yes, when configured | pooled total equals card level |
| Combat narration | no by default | yes | free or included in combat |
| Combat rewards | no | no | awards Orbs |
| Ambient residents | no | yes | no player cost |
| Swarm content proposal | no | yes | no player cost |
| Admin content generation | admin key | server key | no player cost |

## AI Gateway

The Rust `ai_gateway` centralizes OpenAI-compatible/OpenRouter configuration and requests, structured response formats, per-feature timeouts, bounded transient retries, stable failure codes, and provider/model/attempt/latency tracing. Server-side generative content also passes through a fail-closed feature policy: `COSYWORLD_GENERATION_DEFAULT_MODE` sets `off`, `shadow`, or `auto_bounded`, while `COSYWORLD_GENERATION_FEATURE_MODES_JSON` supplies explicit per-feature overrides. Production leaves the default at `off` and enables only reviewed features. `shadow` performs and validates inference without publishing the proposal; `auto_bounded` may publish only after feature-specific validation. Continue moving payer resolution, key verification, model discovery, and media providers behind the gateway.

The first bounded world-content feature is `pathway_content`. When an Explorer first opens a multi-step route, the server creates all hidden waypoint identities together from trusted route biome and terrain context. The model may propose only a name, title, physical description, place persona, and visual detail. A strict JSON schema, unknown-field rejection, length and character limits, authority-language filtering, and deterministic fallback protect the projection. The generated identity and its provider/model/prompt-version provenance persist in the world snapshot, but each name remains hidden until the corresponding Explore edge is revealed. Movement, access, danger, projects, clocks, items, rewards, and all other world truth remain deterministic.

Responsibilities:

- Select provider and payer for each AI feature.
- Accept a transient player OpenRouter key only for explicit player actions.
- Verify user key state through `/api/v1/key`.
- Route text, structured, image, and image-composition calls.
- Discover model capabilities through OpenRouter's Models API.
- Record usage without secrets.
- Normalize OpenRouter errors into product decisions.
- Enforce timeouts and feature-specific failure policy. Dialogue fails closed without substitute speech; structured content and media may use explicitly authored or deterministic non-dialogue fallbacks.
- Attach model, payer mode, feature, latency, token/image usage, and event ids to `ai_usage_ledger`.

Suggested feature ids:

- `dialogue.avatar_line`
- `dialogue.resident_reply`
- `combat.director`
- `combat.narration`
- `avatar.character_sheet`
- `media.avatar_portrait`
- `media.avatar_photo`
- `media.room_scene`
- `media.combat_scene`
- `world.summary`
- `world.swarm.proposal`
- `world.swarm.curator`

Suggested payer modes:

- `player_openrouter_transient`
- `player_openrouter_vaulted`
- `community_orbs`
- `cosyworld_system`
- `admin_system`

Deterministic placeholders remain valid for non-dialogue media previews, but they are not an AI payer mode and never substitute for avatar or resident speech.

## Text Generation

### Card-Driven Room Dialogue

For every successful scene-card commit:

1. Commit the deterministic card outcome and durable player-tick observation in
   one transaction.
2. Arm the room's next heartbeat for roughly three seconds later. If that room
   already has a pending or running heartbeat, do not add another.
3. Choose the next active resident in stable authored card order, continuing
   after the resident who most recently spoke.
4. Build authoritative channel context from the triggering card/event, up to ten
   recent room-log entries, recent spoken lines, current cast and location,
   durable room memory, goals, economy facts, and resident continuity.
5. Ask AI for one bounded resident proposal. The direct event is answered first;
   newer log facts override older ones.
6. Validate the resident's speech contract and commit the accepted `CW_ACTION_SAY`
   through the journal and C kernel.
7. Complete the heartbeat only after the reply attempt, so cards played while
   inference is running still cannot stack another reply.

The human operator is never impersonated by this path. Human dialogue is the
moderated `say` action.

### Structured Decisions

Use structured outputs for planners and directors, not for final character voice.

Good uses:

- choose which resident should respond;
- pick a combat narration beat;
- propose swarm content JSON;
- classify a media job intent;
- summarize a room history.

Bad uses:

- raw world mutation;
- final dice outcomes;
- item grants;
- wallet/economy decisions.

The C kernel and Rust validators must reject invalid or impossible proposals.

## Image And Media Generation

### Media Job Service

Add a v2 `media_jobs` pipeline. Do not block the one-button chat loop on slow image work unless the current action explicitly asks for a photo.

Media intents:

- `avatar_portrait`: 1:1 usable crop for the player avatar and card top square.
- `avatar_card_art`: tall card art for minted or pack-revealed avatars.
- `avatar_photo`: 1:1 or 4:5 in-world selfie/photo.
- `room_scene`: 16:9 or wide room establishing image.
- `combat_scene`: 16:9 attacker/defender/location composition.
- `evolution_card_art`: tall card or level-up art.
- `pack_reveal`: card-pack reveal media.

Recommended provider path:

1. OpenRouter image model discovered through `output_modalities=image`.
2. OpenRouter text+image model for reference-based composition.
3. Existing Google Gemini composition fallback for multi-reference scenes.
4. Deterministic local placeholder only when no configured media provider exists.

Ruby High already demonstrates the OpenRouter response parsing shape:

- request `modalities: ["image", "text"]`;
- pass reference images as `{ type: "image_url", image_url: { url } }` content parts;
- read `choices[0].message.images[0].image_url.url`;
- upload data URLs to stable object storage when available.

CosyWorld should generalize that into Rust rather than copying the Ruby High TypeScript directly.

### Image Ownership

- Generated media belongs to the world event/card it was generated for, not to a private chat.
- A contribution buys no ownership, access, power, or private control over the prompt.
- Each `{subject kind, subject id, level}` generation is unique and replay-safe. Multiple avatars may pool its exact level-sized cost.
- The prompt captures public card history through a committed sequence. When the card reaches a later level, its one newly unlocked image can evolve in response to everything that happened since.
- Fully funded jobs may be retried without another Orb debit. Provider-unavailable requests fail before funding.
- Current implementation stores a durable funding/status projection and serves the ready shared asset from the generated-card route. A generalized object-store-backed `media_jobs` service remains the scaling step.

## Combat Replaces Quizzes

Ruby High asks a question and offers `A/B/C/D`. CosyWorld enters an encounter and offers rules actions.

The basic loop:

1. The player has no Orbs or chooses a risky room/challenge.
2. The primary action becomes `Challenge`, `Spar`, or `Enter`.
3. The C kernel starts or joins an encounter.
4. The player focuses one of the combat actions.
5. The single primary command executes the focused action: `Attack`, `Defend`, `Flee`, or `Use`.
6. The C kernel rolls and emits auditable combat events.
7. AI may narrate the result, but cannot change the result.
8. Completing, winning, surviving, or cleverly resolving the encounter awards Orbs.
9. The player can contribute earned Orbs to a generated card's next community image.

### One-Button Combat UX

The resting screen still has one submit button.

Combat may show a compact focus rail:

- `Attack`
- `Defend`
- `Flee`
- `Use`

The focused rail item changes the one primary command label. Pressing the command executes that action. If the selected action needs a target or item, open a temporary action sheet. The sheet is not a quiz and not a text composer.

Default priorities:

- Low HP biases focus to `Defend` or `Flee`.
- Holding a usable item makes `Use` available.
- No usable item hides or disables `Use`.
- The Cosy Cottage remains safe and should reject combat actions.

### Orb Rewards

Initial reward shape:

- `Listen` or `Notice`: small daily/cooldown reward, usually 1 Orb.
- `Challenge` completion: 1 to 3 Orbs.
- Combat win or peaceful resolution: 2 to 5 Orbs.
- Flee: no reward or 1 survival Orb if the encounter was dangerous.
- Item/evolution milestone: one-time reward.

Rewards must come from committed kernel events. The AI cannot directly mint Orbs.

## Self-Expanding Swarm

The swarm should expand content, not mutate live code.

Roles:

- `observer`: reads world telemetry, room gaps, and stalled loops.
- `cartographer`: proposes locations and exits.
- `encounter_smith`: proposes challenge/combat templates.
- `dialogue_composer`: proposes resident voice decks and ambient beats.
- `photographer`: creates media prompts/jobs for cards and scenes.
- `balancer`: simulates reward/cost effects.
- `curator`: rejects incoherent, unsafe, duplicate, or off-theme content.
- `registrar`: writes approved content packs to the manifest/event store.

Pipeline:

1. Observe a gap or content need.
2. Generate a typed candidate JSON document.
3. Validate schema.
4. Simulate candidate actions against a C-kernel sandbox.
5. Price rewards and costs.
6. Generate optional media.
7. Curate through a second model and deterministic policy checks.
8. Stage as a content pack.
9. Require human/admin approval for new production-visible locations, cards, or economy rewards.
10. Activate by content manifest version, not by live code mutation.

The running server may load new content packs. It must never let the swarm rewrite the C kernel, Rust orchestrator, wallet verification, or economy ledger logic in production.

## Data Model Additions

```sql
CREATE TABLE ai_account_links (
  wallet_address TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_user_hash TEXT,
  label TEXT,
  key_limit_json TEXT,
  verified_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE ai_usage_ledger (
  idempotency_key TEXT PRIMARY KEY,
  wallet_address TEXT,
  actor_id INTEGER,
  feature TEXT NOT NULL,
  payer_mode TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  image_count INTEGER,
  openrouter_generation_id TEXT,
  source_event_id TEXT,
  orb_delta INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  latency_ms INTEGER,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE media_jobs (
  idempotency_key TEXT PRIMARY KEY,
  intent TEXT NOT NULL,
  payer_mode TEXT NOT NULL,
  actor_id INTEGER,
  wallet_address TEXT,
  source_event_id TEXT,
  prompt_json TEXT NOT NULL,
  reference_cards_json TEXT,
  status TEXT NOT NULL,
  result_asset_id TEXT,
  error_code TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE media_assets (
  asset_id TEXT PRIMARY KEY,
  intent TEXT NOT NULL,
  url TEXT NOT NULL,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  sha256 TEXT,
  provider TEXT,
  model TEXT,
  source_job_id TEXT,
  metadata_json TEXT,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE content_candidates (
  candidate_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  proposer TEXT NOT NULL,
  content_json TEXT NOT NULL,
  validation_json TEXT,
  simulation_json TEXT,
  media_json TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
```

If server-side key vaulting is added later, put it in a separate table with envelope encryption and a different security review. Do not quietly add raw keys to `ai_account_links`.

## API Surface

```text
GET  /ai/account
POST /ai/openrouter/verify
POST /ai/openrouter/disconnect
GET  /ai/models
POST /actions/create-bond
POST /actions/chat  # legacy alias for advancement-backed Chat
POST /actions/fund-image
POST /actions/combat
GET  /media/jobs/:id
GET  /economy
```

`/state` should include:

```json
{
  "ai": {
    "mode": "player_openrouter",
    "connected": true,
    "label": "OpenRouter",
    "can_chat": false,
    "chat_cost_orbs": 0
  },
  "economy": {
    "orbs": 3,
    "chat_payer": "advancement"
  },
  "primaryAction": {
    "kind": "create_bond",
    "label": "Chat"
  }
}
```

Orb balance does not affect Chat. Without banked advancement, it is absent:

```json
{
  "ai": {
    "mode": "cosyworld_system",
    "connected": false,
    "can_chat": false,
    "chat_cost_orbs": 0
  }
}
```

## Implementation Plan

### Stage 1: AI Gateway Boundary

- Extract current Rust AI calls into `ai_gateway`.
- Keep current env-key behavior working.
- Record system payer mode for resident heartbeat replies.
- Add usage logging without secrets.
- Add model capability discovery cache.

### Stage 2: Player OpenRouter Connection

- Reuse Ruby High PKCE concepts or an explicit key paste dev flow.
- Verify key with `/api/v1/key`.
- Return compact connection state in `/state`.
- Send a player key only with explicitly supported media actions.

### Stage 3: Community-Funded Card Images

Current status: first end-to-end slice implemented.

- `orb_ledger` remains the authoritative balance ledger; `community_image_generation` is the only new negative mutation reason.
- Eligible generated card projections expose level, required/funded/remaining Orbs, status, and history sequence.
- `POST /actions/fund-image` pools one Orb per press, caps the pool at the card level, and schedules generation only when fully funded.
- Ready art replaces the card image with a level cache key; failure and restart-safe retries never charge twice.
- Chat, room heartbeats, and repeat Listen have no Orb spend path.

### Stage 4: Combat-As-Earning Loop

- Convert the current Moonlit Trail sparring primitives into `/actions/combat`.
- Project `Attack`, `Defend`, `Flee`, and `Use` through the one-button focus rail.
- Award Orbs from committed encounter outcomes.
- Replace the old "challenge/listen as quiz-like reward" concept with combat/challenge encounters.

Current status: partially implemented. Moonlit Trail exposes `Attack`, `Defend`, `Flee`, and meaningful potion `Use`; richer encounter lifecycle and a single `/actions/combat` facade remain future work.

### Stage 5: Generalized Media Jobs

- Port Ruby High's OpenRouter portrait/composition response parsing into Rust.
- Add `media_jobs` and `media_assets`.
- Move the current community card-image worker behind a durable, provider-neutral queue and object storage.
- Generate combat scene media asynchronously from committed combat events.

### Stage 6: Swarm Content

- Add `content_candidates`.
- Add schema validation and kernel sandbox simulation.
- Stage content packs for human/admin approval.
- Activate only approved manifest versions.

## Open Decisions

- Whether player OpenRouter mode should be allowed to contribute provider credit instead of Orbs to the same public pool. Recommendation: defer; one level-based currency rule is clearer.
- How non-avatar collectibles gain levels. Recommendation: make level an authoritative card/evolution property, never infer it from Orb contributions.
- Whether OpenRouter key storage should remain browser-only. Recommendation: browser-only MVP; encrypted vault later only if cross-device "connected" state matters.
- Whether resident reply should wait in the same request to reuse a transient key. Recommendation: finish avatar line plus immediate resident reply within the same action transaction for player-key turns; keep async scheduling for server-paid ambient turns.
