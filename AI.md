# CosyWorld 2.0 AI, Media, BYOK, And Combat Design

## Summary

CosyWorld should use AI as a world actor, not as a private chatbot.

The `Chat` verb specifically never types for the human — pressing `Chat` asks the server to author one in-character line for the player's avatar, commit it as a shared room event, then optionally commit one resident reply. (This document originally said "the human still never types" as a blanket claim; that stopped being true once `POST /actions/say` shipped as a separate, moderated, player-typed room-speech path. `say` bypasses AI generation entirely — the player's literal text is broadcast, subject to sanitization — while `Chat` remains the AI-authored path described below.) The payer for a `Chat` AI turn can be either:

- the player's connected OpenRouter account, which costs no Orbs inside CosyWorld;
- the CosyWorld server key, which costs Orbs.

"Unlimited" means unlimited by CosyWorld's Orb gate. It does not bypass OpenRouter credits, rate limits, model availability, or the player's own key limits.

Ruby High's quiz loop maps to CosyWorld's encounter loop. Where Ruby High offers quiz answers, CosyWorld offers rule actions: `Attack`, `Defend`, `Flee`, and `Use`. Combat and challenges earn Orbs. Chat spends Orbs only when the player is using the CosyWorld server key.

## Source Findings

### Current V2

Relevant implementation points:

- `v2/orchestrator-rust/src/main.rs` already supports OpenAI-compatible text generation through `AiConfig`.
- `AiConfig` reads `COSYWORLD_AI_API_KEY`, `OPENROUTER_API_KEY`, or `OPENAI_API_KEY`.
- OpenRouter defaults to `https://openrouter.ai/api/v1` and `x-ai/grok-4.5`.
- `POST /actions/chat` validates the actor session, builds an `AvatarChatPlan`, generates one player-avatar line, commits it through `CW_ACTION_SAY`, then schedules one resident reply.
- `POST /actions/say` is a separate, non-AI route: it takes player-typed `content` directly, moderates/sanitizes it, and commits it as a `message.created` room event with no LLM call involved. This is the human-typed room-speech path that `Chat` intentionally does not provide.
- Resident replies are already one-to-many world events.
- Server-paid player-avatar Chat spends one Orb only after a committed message event, and the spend is projected into `orb_ledger`.
- Player OpenRouter Chat stores no key server-side and records only non-secret usage metadata in `ai_usage_ledger`.
- Generated player avatar art is currently deterministic local SVG, not real AI media.
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
- Ruby High's Merit Star chat quote/spend flow is the closest product analogue to CosyWorld's future Orb-paid chat.

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
- The client never decides Orb affordability, model access, combat outcomes, rewards, or inventory use.
- No raw OpenRouter key is ever written to logs, event payloads, screenshots, or analytics.

## Payment Modes

### Player OpenRouter Mode

The player connects an OpenRouter account or API key and can use `Chat` without spending Orbs.

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

If no player OpenRouter key is available, `Chat` uses the CosyWorld server key and spends Orbs.

Rules:

- The Orb spend is tied to a committed public avatar line.
- Failed validation spends nothing.
- If AI fails before a shared avatar line commits, spend nothing or refund the reservation.
- No deterministic dialogue fallback is permitted. If inference fails before a shared avatar line commits, the action fails and spends nothing.
- The immediate resident reply is included in the same action budget. The player should not be charged twice for one press.
- If no key and not enough Orbs, `Chat` should disappear or become an earning action such as `Challenge`, `Spar`, `Listen`, `Practice`, or `Notice`.

### Payer Matrix

| Feature | Player OpenRouter | CosyWorld Server Key | Orb Cost |
| --- | --- | --- | --- |
| Player presses `Chat` | yes | yes, when configured | 0 with player key, 1 with server key |
| Immediate resident reply | same payer as `Chat` | same action budget | included |
| Avatar portrait generation | optional player payer | fallback for starter grants | 0 with player key, higher Orb cost with server key |
| Combat narration | no by default | yes | free or included in combat |
| Combat rewards | no | no | awards Orbs |
| Ambient residents | no | yes | no player cost |
| Swarm content proposal | no | yes | no player cost |
| Admin content generation | admin key | server key | no player cost |

## AI Gateway

The first Rust `ai_gateway` slice is live for text inference. It centralizes OpenAI-compatible/OpenRouter configuration and requests, per-feature timeouts, bounded transient retries, stable failure codes, and provider/model/attempt/latency tracing. Continue moving payer resolution, key verification, usage-ledger writes, model discovery, and media providers behind it before adding more model calls.

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
- `cosyworld_orbs`
- `cosyworld_system`
- `admin_system`

Deterministic placeholders remain valid for non-dialogue media previews, but they are not an AI payer mode and never substitute for avatar or resident speech.

## Text Generation

### Chat Turn

`POST /actions/chat` should become an economy-aware AI transaction:

1. Validate actor session, wallet/session, room access, focus target, rate limit, suspension, and in-flight lock.
2. Resolve payer:
   - valid player OpenRouter key means no Orb spend;
   - otherwise require Orb affordability.
3. Build authoritative room context.
4. Generate one player-avatar line.
5. Sanitize and validate it.
6. Commit `CW_ACTION_SAY` through the C kernel.
7. Generate or schedule one resident reply under the same payer budget.
8. Commit the resident reply through the C kernel.
9. Record AI usage and Orb ledger changes idempotently.
10. Broadcast the committed world events.

The user never provides dialogue text. The prompt should continue saying that the human operator is silent.

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
- Player-key-generated portraits can still be public once attached to the avatar/card.
- The UI should show that using a player key for avatar art creates public game media.
- Media jobs must be idempotent by source event id and intent.

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
9. The player can spend Orbs on future `Chat` if they are not using their own OpenRouter key.

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
POST /actions/chat
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
    "can_chat": true,
    "chat_cost_orbs": 0
  },
  "economy": {
    "orbs": 3
  },
  "primaryAction": {
    "kind": "chat",
    "label": "Chat"
  }
}
```

When not connected and out of Orbs:

```json
{
  "ai": {
    "mode": "cosyworld_orbs",
    "connected": false,
    "can_chat": false,
    "chat_cost_orbs": 1
  },
  "primaryAction": {
    "kind": "challenge",
    "label": "Challenge"
  }
}
```

## Implementation Plan

### Stage 1: AI Gateway Boundary

- Extract current Rust AI calls into `ai_gateway`.
- Keep current env-key behavior working.
- Add payer mode to avatar chat and resident reply.
- Add usage logging without secrets.
- Add model capability discovery cache.

### Stage 2: Player OpenRouter Connection

- Reuse Ruby High PKCE concepts or an explicit key paste dev flow.
- Verify key with `/api/v1/key`.
- Return compact connection state in `/state`.
- Send player key only with explicit `Chat` or media actions.
- Ensure resident reply uses the same action payer without persisting the key.

### Stage 3: Orbs For Server-Paid Chat

Current status: implemented for the MVP text loop.

- Added `orb_ledger`.
- Added Orb balance to `/state`.
- Charged one Orb only for server-paid committed `Chat`.
- Added ledger and reset tests.

### Stage 4: Combat-As-Earning Loop

- Convert the current Moonlit Trail sparring primitives into `/actions/combat`.
- Project `Attack`, `Defend`, `Flee`, and `Use` through the one-button focus rail.
- Award Orbs from committed encounter outcomes.
- Replace the old "challenge/listen as quiz-like reward" concept with combat/challenge encounters.

Current status: partially implemented. Moonlit Trail exposes `Attack`, `Defend`, `Flee`, and meaningful potion `Use`; richer encounter lifecycle and a single `/actions/combat` facade remain future work.

### Stage 5: OpenRouter Media

- Port Ruby High's OpenRouter portrait/composition response parsing into Rust.
- Add `media_jobs` and `media_assets`.
- Generate player avatar portraits when the player uses their key or spends the configured Orb amount.
- Generate combat scene media asynchronously from committed combat events.

### Stage 6: Swarm Content

- Add `content_candidates`.
- Add schema validation and kernel sandbox simulation.
- Stage content packs for human/admin approval.
- Activate only approved manifest versions.

## Open Decisions

- Whether player OpenRouter mode should also cover optional image jobs by default. Recommendation: yes, but show that the resulting image becomes public world/card media.
- Whether a server-paid Chat costs exactly 1 Orb forever. Recommendation: start at 1 Orb for text, 3 to 5 Orbs for player-requested media, and tune from usage.
- Whether OpenRouter key storage should remain browser-only. Recommendation: browser-only MVP; encrypted vault later only if cross-device "connected" state matters.
- Whether resident reply should wait in the same request to reuse a transient key. Recommendation: finish avatar line plus immediate resident reply within the same action transaction for player-key turns; keep async scheduling for server-paid ambient turns.
