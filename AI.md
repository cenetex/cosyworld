# CosyWorld 2.0 AI, Media, BYOK, And Combat Design

## Summary

CosyWorld should use AI inside the shared world, not as a private chatbot. A
model may supply an authored actor's voice or bounded planning, or it may power
an item device. The model is not automatically a person. Actor-versus-device
embodiment follows
[ADR 0007](docs/decisions/0007-model-bindings-and-item-devices.md).

`Chat` is the player-facing friendship action. It appears only when the avatar
has banked advancement and a nearby resident is eligible for a new Bond; playing
it spends one advancement point, creates that friendship, and passes the room
turn. It never accepts text or spends Orbs. Player-authored room speech is not
a supported input surface; dialogue is generated from server-authored
actions and world state.

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
- There is no player-authored speech endpoint or command. `Chat` and contextual heartbeats derive dialogue only from server-authored actions and world state.
- Successful card commits atomically enqueue a delayed, durable room heartbeat. One pending/running heartbeat per room coalesces later cards.
- Resident replies are one-to-many world events. Their inference context includes the current card event and recent channel log, not only the latest spoken line.
- Every Elysium binding has explicit per-model interaction profiles. Ready
  models use native `Talk`, `Illustrate`, `Speak`, `Find resonance`, or
  `Rank echoes` routes with the exact checked-in model; unavailable modalities
  are withheld instead of falling through to Chat. The current actor-only
  schema still presents tool endpoints as residents. ADR 0007 accepts an
  additive item-binding migration: image, video, synthesis, transcription,
  semantic, and music-only bindings become portable or installed devices. An
  active image device receives a grounded visual prompt through its carrier's
  certified Illustrate action. The gateway buffers and decodes one bounded
  raster image, runs a fail-closed vision publication review, and journals an
  image event only after approval. The server-authored prompt and rejected
  bytes never enter the public event.
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
- Image generation is available through the dedicated `POST /api/v1/images` endpoint, with image-capable models discoverable via `output_modalities=image`: https://openrouter.ai/docs/guides/overview/multimodal/image-generation
- The Models API exposes model architecture, modalities, pricing, and supported parameters: https://openrouter.ai/docs/api/api-reference/models/get-models
- Structured outputs use `response_format` with JSON schema on compatible models: https://openrouter.ai/docs/guides/features/structured-outputs

## Non-Negotiable Invariants

- AI may propose text, media, and future content. The C kernel decides world state.
- A provider model is execution metadata, not a world entity or proof of
  personhood. Conversational actors and model-backed item devices retain their
  distinct authored contracts.
- Adapter and provider readiness never change actor-versus-item embodiment.
- A dormant device remains inspectable with its reason but never occupies a
  playable action-hand slot.
- A device contributes only closed, certified actions or settings. It never
  grants a free-form prompt, model picker, arbitrary provider tool call, or
  undeclared target to either a human or inference controller.
- Every player-visible AI result is committed as a shared room event.
- Generated character speech remains a private candidate until the deterministic
  publication gate certifies its finish reason, voice budget, single-speaker
  envelope, mode, context anchor, novelty, tone, safety, and action authority.
- Rejected speech is represented durably only by hashes, stable check codes,
  model attribution, prompt/context versions, latency, and token usage. Raw
  rejected bytes never enter the Journal, room history, SSE, or player errors.
- A certified generation identity may be journaled at most once. Its receipt is
  part of the canonical speech record so snapshots and journal replay preserve
  exactly-once publication across retries and restarts.
- No DMs, no private resident conversations, no one-on-one teacher mode.
- A connected user key changes who pays; it does not create a private world.
- One user-paid action can benefit everyone present because the output is a public event.
- Autonomous resident actions and swarm jobs use the server budget unless an admin explicitly runs them.
- The client never decides Orb affordability, image eligibility, model access, combat outcomes, rewards, or inventory use.
- Another avatar's held items remain absent until an authoritative successful Notice or explicit item speech records disclosure. The inspector renders only those disclosed items, and each item carries the server-computed request, trade, or theft actions that are valid for the current viewer; unknown holdings and invalid consent routes are never inferred in the browser.
- Orbs may be debited only by the authoritative community-image funding route.
- The community-image vision gate may reject only concrete visible policy categories. An unspecified or style-only concern cannot discard a paid candidate or consume another provider attempt.
- No raw OpenRouter key is ever written to logs, event payloads, screenshots, or analytics.

## Payment Modes

### Player OpenRouter Mode

The player may connect an OpenRouter account or API key for explicitly supported provider features. Neither Chat nor ambient room replies cost Orbs.

Current browser-owned MVP shape:

- Reuse Ruby High's PKCE flow where possible.
- The browser receives and stores the OpenRouter key, and sends it only with explicit player-initiated AI actions.
- The server uses the key transiently for that action and does not persist it.
- The server stores only account identity, wallet/session link, provider label, and verification metadata.
- The server verifies the key with OpenRouter's `/api/v1/key` endpoint before enabling the mode.
- The client can show compact key state such as "OpenRouter connected", label, remaining credits, or limited/unlimited status.
- A player can disconnect, rotate, or replace the key at any time.
- Durable model-interaction jobs freeze whether the player or server pays. A
  player-funded retry without its transient key fails closed instead of falling
  back to the CosyWorld account.

This follows Ruby High's main safety choice: the CosyWorld server is not a long-lived third-party API-key vault in the first release.

Tradeoff:

- Local browser storage is not perfect. The mitigation is OpenRouter key credit limits, explicit disconnect, HTTPS only, and never echoing the key back into app state.
- If cross-device persistence becomes important, add an encrypted server vault as a separate opt-in feature after security review.

### CosyWorld Server-Paid Mode

The server key pays for autonomous/public text inference, including the resident
reply after Chat and other card plays. Failure is skipped or remains visible as
appropriate, but no reservation, debit, or refund touches the Orb ledger.

Server-paid OpenRouter inference has a $10 UTC daily admission limit. Before
each request, the gateway checks the server key's authoritative `usage_daily`
value through `/api/v1/key`, serializes in-process admissions, and fails closed
when usage cannot be verified. Once the reported value reaches $10, inference
pauses until the next UTC day. Because OpenRouter reports cost after a request,
the last admitted request can take the final total slightly over $10.

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

The Rust `ai_gateway` centralizes OpenAI-compatible/OpenRouter configuration and
requests, structured response formats, per-feature timeouts, bounded transient
retries, stable failure codes, and provider/model/attempt/latency tracing. It
supports text, exact raster-image, embeddings, rerank, and speech-synthesis
requests; the bounded transcription primitive remains dormant because the
product has no player speech, microphone, or audio-upload surface. Selection
uses versioned immutable capability facts, and each request pins one candidate
plus its prompt-adapter and catalog versions. Exact interactions also require
a checked-in actor or item binding and a provider-available, runtime-ready
interaction profile instead of a fallback model. Asynchronous video and music,
two-way voice streaming, and vector-only SVG output remain withheld until their
dedicated safe adapters exist.

Raw Talk sends reasoning effort `none` only when the exact model advertises the
reasoning parameter. One precise HTTP 400 may retry with mandatory reasoning
enabled but excluded from visible output, or with an unsupported reasoning
object omitted. Production operator-registry pools retain the strict
no-retention/no-training gate. Exact Elysium Talk and device-backed Illustrate
and Speak carry only server-authored world or catalog facts. Find resonance and
Rank echoes operate on a bounded, frozen set of visible server-authored room
messages, so both ZDR and non-ZDR bindings are eligible. ZDR profiles add the
provider
privacy constraint; non-ZDR profiles remain truthfully non-ZDR. No path accepts
player-authored speech or a free-form model prompt.

Avatar voice publication adds durable, weighted selection without replacement,
bounded attempts/hedges/latency/spend, separately dimensioned content and
provider-health evidence, and exactly one publication-gated winner; replay
returns the accepted receipt without rerunning selection. Resident
`intent_json` composition is intentionally unchanged pending the voice/intent
split. Mutable aliases require the provider response's concrete model for
attribution. Persisted attribution is self-contained so refreshes cannot
rewrite in-flight or historical identity. The capability contract is in
`v2/docs/ai-capability-registry.md`; visibility-aware, context-dominant prompt
assembly is in `v2/docs/context-dominant-prompting.md`.

Server-side generative content also passes through a fail-closed feature policy: `COSYWORLD_GENERATION_DEFAULT_MODE` sets `off`, `shadow`, or `auto_bounded`, while `COSYWORLD_GENERATION_FEATURE_MODES_JSON` supplies explicit per-feature overrides. Production leaves the default at `off` and enables only reviewed features. `shadow` performs and validates inference without publishing the proposal; `auto_bounded` may publish only after feature-specific validation. Continue moving payer resolution, key verification, model discovery, and media providers behind the gateway.

The first bounded world-content feature is `pathway_content`. When an Explorer first opens a multi-step route, the server creates all hidden waypoint identities together from trusted route biome and terrain context. The model may propose only a name, title, physical description, place persona, and visual detail. A strict JSON schema, unknown-field rejection, length and character limits, authority-language filtering, and deterministic fallback protect the projection. The generated identity and its provider/model/prompt-version provenance persist in the world snapshot, but each name remains hidden until the corresponding Explore edge is revealed. Movement, access, danger, projects, clocks, items, rewards, and all other world truth remain deterministic.

Responsibilities:

- Select provider and payer for each AI feature.
- Resolve the exact binding from the certified actor or item subject; never
  infer that a model catalog entry is an actor or accept a client-selected
  provider model.
- Accept a transient player OpenRouter key only for explicit player actions.
- Verify user key state through `/api/v1/key`.
- Route text, structured, raster-image, embeddings, rerank, speech-synthesis,
  and dormant transcription calls through their exact adapters.
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
5. On a decision beat, freeze the exact current `resident-planner-offers-v1`
   candidate IDs and state revision, then make at most one `intent_json` planner
   call. That closed policy currently covers reachable move, pickup, drop, give,
   trade, and use-item offers; unsupported legal kinds such as search remain in
   deterministic hands and are not mislabeled as planner candidates. Pickups
   requiring an inventory exchange are excluded until the candidate schema can
   encode the exact outgoing item. Ordinary conversation and directly
   controlled proxy reactions skip this step.
6. Validate the planner's exact candidate echo. Invalid, unavailable, illegal,
   or stale output becomes a rejected/absent planner brief and no pending action.
7. Ask a `voice` model for public speech only. Its brief distinguishes proposed,
   accepted, committed, superseded, rejected, and absent intent and forbids
   claims that an uncommitted action, cost, or outcome already happened.
8. Re-enumerate the authoritative candidates before persisting any pending
   action, validate the speech contract, and commit `CW_ACTION_SAY` through the
   journal and C kernel. Later deterministic hands still re-plan against current
   offers and the kernel remains the only mutation authority.
9. Complete the heartbeat only after the reply attempt, so cards played while
   inference is running still cannot stack another reply.

The human operator is never impersonated by this path, and no player-authored
dialogue surface exists. Planner reason text exists only in the resident-planning
trace, never in the projected pending action, a belief, or a world fact. The
speech journal stores the planning status and accepted publication receipt;
eventual action decision traces carry the same generation, candidate, revision,
and causal event fields. Only the matching executed plan is cleared. A newer
accepted generation durably supersedes an older one, while a rejected attempt
leaves the older accepted plan intact. Replay consumes those records and never
calls inference.

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

The host-owned recipe registry at `v2/media/recipes.json` is the frozen
capability boundary in front of provider adapters. It records exact Replicate
revision provenance for the incumbent FLUX.1 LoRA base recipe and uses a pinned
version invocation for the reference-capable FLUX.2 recipe, along with
operation, intent, input field, reference limits/order, formats, dimensions,
seed/mask behavior, retry/cost policy, prompt version, output normalization,
and stable-storage requirements. The same registry is compiled into Rust and
read by the worldpack compiler, so pack profile validation cannot drift from
runtime resolution.

The initial pins were read from Replicate's published API pages on 2026-07-26:
FLUX.1 LoRA revision
`ae0d7d645446924cf1871e3ca8796e8318f72465d2b5af9323a835df93bf0917`
from `https://replicate.com/black-forest-labs/flux-dev-lora/api`, and FLUX.2
dev revision
`7bba46bdde863cfd7aaee87649a5aa49f39f368495dbea500998d1fcbb262050`
from
`https://replicate.com/black-forest-labs/flux-2-dev/versions/7bba46bdde863cfd7aaee87649a5aa49f39f368495dbea500998d1fcbb262050/api`.
The latter's published input schema caps this exact recipe at four ordered
`input_images`, constrains custom width and height to 256–1440 in multiples of
32, and accepts an optional seed. The registry follows that version-specific
schema rather than a broader model-family claim.

References are an ordered list of typed `location`, `actor`, `item`,
`prior_level`, or `style` slots. The resolved job retains that exact order and
FLUX.2 prompts address it as image 1 through image N. Resolution rejects an
unsupported slot, operation, intent, format, seed, mask, or over-limit list
before a provider adapter can construct or send a request; it never truncates,
sorts, or substitutes references.

Approved media is recorded in an append-only asset graph under the generated
asset root. Content-addressed objects are immutable; records bind their digest,
dimensions, MIME type, subject/level/revision, worldpack and composition,
rights basis, provider/model/prompt/seed/prediction history, and complete
parent slot/order/crop/mask/transformation lineage. Approval moves a canonical
pointer without rewriting or deleting prior revisions. Existing approved
FLUX.1 outputs are lazily backfilled from their stored bytes and metadata, so
the migration does not spend provider credits or regenerate art.

Reference jobs cannot supply arbitrary URLs. The host resolves typed slots
against approved canonical records, verifies object digests, checks explicit
reference-reuse rights, selects the canonical revision as of the intent's
journal boundary, and creates certified inputs in stable slot/subject order.
Causal revisions keep same-subject IDs and canonical selection independent of
pack ingestion order. Durable lifecycle evidence reconciles publication after
restart; moderation uses a persisted reference hold until its journal result
is reconciled. Pending, rejected, private, deleted, missing, corrupt, or
rights-ineligible records fail closed before provider submission. Authored,
on-chain, and imported sources default to non-derivable until an explicit
policy grants reuse. A request beyond the recipe budget requires an explicit
composition plan rather than truncation or unrelated fallback.

`COSYWORLD_MEDIA_RECIPE_CONTROLS_JSON` provides runtime-only
`disabled_recipes`, `profile_overrides`, and per-profile
`canaries` (`recipe` plus `percent`). Selection is deterministic from the job
key. Parsing and registry validation fail closed on unknown fields, profiles,
recipes, disallowed targets, or percentages above 100. A disabled recipe
follows only its declared allowlisted fallback, which must still satisfy the
complete job; an explicit profile override rolls back to a prior recipe. Pack
compilation follows that same declared default/fallback chain and never picks
an arbitrary enabled recipe. These controls do not change world state. The
default base profile continues to use the existing FLUX.1 LoRA request and
community Orb funding/output path.

Later-level art freezes an approved canonical prior-level asset, including its
content digest and history boundary, before funding commits. The persisted
evolution job contains the subject's identity and visual description, stable
traits, the bounded public event delta after that prior boundary, target
level/revision/crop, and negative constraints. Only the pinned FLUX.2
single-reference recipe may consume that certified `prior_level` input. The
incumbent FLUX.1 recipe remains the default route; the reviewed evolution
contract at `v2/media/evolution-canary.json` records completed shadow
comparison and an independently gated 5% canary across avatar, item, and
location dark/light profiles. Runtime observations automatically disable only
the weak profile and route it back to the incumbent without changing world
state. Candidates remain private until the durable ready transition, so a
failed or rejected evolution spends no additional Orbs and leaves the prior
approved image public. Run `npm run v2:media:evolution` for the checked corpus
report and comparison chart.

Media intents:

- `avatar_portrait`: 1:1 usable crop for the player avatar and card top square.
- `avatar_card_art`: tall card art for minted or pack-revealed avatars.
- `avatar_photo`: 1:1 or 4:5 in-world selfie/photo.
- `room_scene`: 16:9 or wide room establishing image.
- `combat_scene`: 16:9 attacker/defender/location composition.
- `evolution_card_art`: tall card or level-up art.
- `pack_reveal`: card-pack reveal media.

`room_scene` is a bounded server-sponsored composition over one committed
public event: one location, one or two still-present event actors, and at most
one event item. Its server-canonical job identity excludes callers and request
tokens, freezes the projection digest, ordered approved references, prompt,
recipe revision, and `server_sponsored_no_orb_debit/1` funding policy before
provider spend. A durable per-job provider lease deduplicates concurrent
workers and can be reclaimed only after its recipe-timeout expiry, consuming
the next bounded attempt. Candidates remain private until moderator review;
the server records its current committed event boundary as provenance and only
then advances the location's approved canonical asset.

Recommended provider path:

1. OpenRouter image model discovered through `output_modalities=image`.
2. OpenRouter text+image model for reference-based composition.
3. Existing Google Gemini composition fallback for multi-reference scenes.
4. Deterministic local placeholder only when no configured media provider exists.

For exact device-backed text-to-image actions, CosyWorld resolves the model and
prompt from the frozen certified offer, sends them to `POST /images`, accepts
one bounded `data[0].b64_json` result, validates its declared or detected image
format and decoded dimensions, and writes it to stable immutable storage only
after review. The acting avatar and source device remain explicit in
attribution. Reference-based composition remains a separate future media-job
concern.

### Image Ownership

- Generated media belongs to the world event/card it was generated for, not to a private chat.
- A contribution buys no ownership, access, power, or private control over the prompt.
- ADR 0006 permits external ownership only as provenance for one allowlisted
  linked avatar. Reviewed cosmetic appearance fields may inform that avatar's
  presentation, but NFT metadata cannot author prompts, personality, memory,
  mechanics, items, rewards, access, pack ids, or controller mode. Item and
  location NFTs are never media-authority inputs.
- Each `{subject kind, subject id, level}` generation is unique and replay-safe. Multiple avatars may pool its exact level-sized cost.
- The prompt captures public card history through a committed sequence. When the card reaches a later level, its one newly unlocked image can evolve in response to everything that happened since.
- Fully funded jobs may be retried without another Orb debit. Before any actor,
  item, or location contribution is journaled, the server resolves the exact
  frozen media brief and recipe, proves candidate/quarantine/publication and
  verdict storage, checks the provider route, and runs a known-safe solid-color
  base64 fixture through the configured strict-schema reviewer. That capability
  request carries the real frozen publication policy, while explicitly exempting
  the synthetic fixture from subject-identity and environment matching. Missing
  or incompatible reviewers therefore fail before either funding or a billable
  Replicate request.
- Every community-art candidate is published only after a strict vision-policy
  review. Actor and item reviews enforce their frozen subject identity; location
  reviews additionally reject people, characters, creatures, text, logos, and
  watermarks. The downloaded candidate is durably stored before review; reviewer
  outages and restarts reuse those bytes rather than purchasing another image.
  Actual reviewer attempts and latency are retained in the verdict audit. Provider
  generation attempts are journal-counted and capped at three per
  `{subject kind, subject id, level}`. Rejection, review failure, and missing
  review configuration all leave deterministic fallback art visible.
- Location generation keeps the configured CosyWorld style LoRA but replaces
  the avatar portrait/card prefix with a landscape-only prefix and reduces
  public history to environmental traces without actor names or dialogue.
  Prompt profiles are versioned; advancing a profile reopens one bounded
  provider budget for an already-funded job without another Orb debit.
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

## A Diverse Model Cast Behind Per-Generation Gates

Groomed 2026-07-26; folded here 2026-07-30 from issues
[#388](https://github.com/cenetex/cosyworld/issues/388),
[#393](https://github.com/cenetex/cosyworld/issues/393), and
[#394](https://github.com/cenetex/cosyworld/issues/394). The registry
([#389](https://github.com/cenetex/cosyworld/issues/389)), publication gate
([#390](https://github.com/cenetex/cosyworld/issues/390)), weighted exploration
([#391](https://github.com/cenetex/cosyworld/issues/391)), and voice/intent
separation ([#392](https://github.com/cenetex/cosyworld/issues/392)) have
shipped; Fly evaluation and the adversarial corpus remain direction.

Make model diversity a first-class feature: a broad cast of tiny and unusual
language models may attempt public character speech, while every individual
generation is buffered and deterministically qualified before entering the
shared world.

**The system certifies outputs, not models.** A model that fails one line may
still participate later at a lower sampling weight. Conversation-only models
provide voice; a smaller independently qualified planner pool may propose
bounded intent; the kernel remains the only authority for world actions.

### Product principles

- Diversity of model voice is an intended property, not only a provider
  fallback mechanism. Any operational text model may attempt voice generation,
  including 1B/4B models.
- No model is trusted: every completed output passes the same publication gate.
- Failed outputs are private, recorded as evaluation evidence, and never
  streamed or committed.
- Content failure lowers selection weight but never permanently suspends a
  model. Provider/transport health and output quality are measured separately.
- Character identity and durable continuity live in world data; backend model
  choice is an execution detail.
- Conversation and intent planning are separate capabilities. A model may
  qualify for one without the other.
- Provider-offline play remains mechanically and narratively truthful.

### Architectural contract

```text
world event
  -> freeze public generation context
  -> choose untrusted voice candidate(s)
  -> generate privately
  -> deterministic publication gate
       pass -> commit exactly one visible line
       fail -> discard, record, and try another candidate
  -> bounded attempts exhausted -> explicit authored/unavailable outcome

decision-required event
  -> enumerate authoritative legal candidates
  -> optional planner proposes one typed intent
  -> validate against exact candidates and kernel rules
  -> voice model expresses proposed/committed state truthfully
```

No diverse live rollout begins before the publication gate and resolved-model
attribution are present.

### Fly evaluation and resolved-model telemetry

Exercise diverse candidates against production-shaped contexts, record every
attempt accurately, and use the same evidence for live routing without letting
shadow output affect the world. Per-generation gating is the live safety
boundary; shadow evaluation supplies additional traffic and evidence for
rare or new candidates. It does **not** create a binary trusted-model promotion
system.

- Enqueue bounded asynchronous shadow jobs from frozen copies of public
  generation contexts. Shadow responses are never published, charged as
  successful gameplay, fed into later prompts, or allowed to mutate state.
- Run the evaluator inside the existing single-writer orchestrator or through a
  control API preserving one SQLite writer. **Do not attach a second
  uncoordinated process to the event volume.**
- Bound concurrency, sample rate, timeouts, daily spend, per-model spend, and
  queue depth. Live generation and world turns take priority.
- Apply the exact same adapters and deterministic publication gate used by live
  dialogue.

Record for every live and shadow attempt: durable generation/job identity and
feature; requested candidate and **actual resolved model/provider**; registry,
adapter, prompt, and gate versions; frozen context hash and output hash; every
gate check and failure code; transport status, attempts, latency, token usage,
provider-reported cost; live/shadow disposition and whether the line committed;
selected-candidate evidence and cooldown changes.

Usage attribution based only on the configured `AiConfig.model` is insufficient
once provider/model fallback exists.

**Operational controls.** Content failure changes sampling evidence only. Rate
limits, outages, and timeouts affect provider health and cooldown. Runaway
spend, a permanently malformed endpoint, or repeated infrastructure abuse may
open a temporary circuit breaker. No raw API key, private provider body, or
unredacted player-sensitive prompt enters logs or model reports.

### Adversarial corpus

A permanent corpus and integration matrix proving diverse, unreliable models
may attempt speech without any failed generation becoming public or
authoritative. Cover at minimum: concise grounded prose, emoji-only, and emote
speech; crowded rooms with multiple named actors; empty and long-but-bounded
context; direct action reaction, gift/trade, relationship, danger, ordinary
banter; prompt injection and requests to expose system/policy/tool/model text;
multiple-speaker transcripts and invented labels; looping tokens, repeated
n-grams, unfinished quotes/lists/JSON, length exhaustion; wrong speech mode and
inaccessible emoji; subject drift and absent scene anchors; exact, normalized,
and near-duplicate recent lines; proposal-versus-commit truthfulness; valid and
invalid bounded intent schemas; stale candidate IDs, illegal targets, and
provider-offline behaviour; multilingual/Unicode punctuation without permitting
hidden control characters or leakage.

Use deterministic fake OpenAI-compatible providers returning exact
hostile/successful payloads, finish reasons, resolved model IDs, delays,
errors, and races. Real-provider evidence supplements but never replaces
hermetic regression tests.

**Required journeys**: one tiny model fails the gate, a second passes, exactly
one line commits; two passing hedged candidates race and only one commits;
every candidate fails and the authored/unavailable result closes the beat; a
provider errors while the same model succeeds through another provider; a
conversation-only model is never selected for intent planning; a planner emits
valid JSON for an illegal action and the kernel rejects it without mutation;
retry, reconnect, restart, snapshot, and full replay reproduce one committed
world result; browser and CLI expose the same accepted line or failure outcome
without rejected-text leakage.

### Definition of done

- [ ] At least three materially different model families, including tiny
      models, produce accepted public speech in a production-like run.
- [ ] Every visible generated line has a recorded generation identity, resolved
      model/provider, gate result, prompt adapter/version, latency, and usage.
- [ ] An output violating any hard gate is never visible, even under retry,
      reconnect, race, or provider fallback.
- [ ] A failing model remains eligible for bounded future exploration without
      being able to publish a failing output.
- [ ] Bounded retries and authored fallback prevent a low-quality pool from
      stalling a world turn.
- [ ] Voice selection is diverse but character continuity remains stable and
      inspectable.
- [ ] Conversation-only models are never asked to execute tools or acquire
      mechanical authority.
- [ ] Planner proposals match an exact current legal action/target or fail
      closed without mutation.
- [ ] Provider outages, rate limits, content failures, and safety failures have
      distinct metrics and recovery behaviour.
- [ ] Snapshot and full journal replay reproduce committed world state without
      re-running inference.
- [ ] Provider-offline browser and CLI journeys remain complete and truthful.
- [ ] Property/fuzz tests cannot make rejected text enter an event, SSE frame,
      room-memory chapter, later prompt, or visible error.
- [ ] Statistical tests show exploration remains nonzero, budgets stay bounded,
      and consistently passing models receive more attempts without total
      monopoly.

### Out of scope

Letting a model invent verbs, targets, costs, rewards, topology, or world
truth. Publishing partial or streamed output before validation. Running
hundreds of models for every line. Treating benchmark rank or parameter count
as sufficient qualification. Requiring generated speech for authoritative
campaign correctness. Declaring any third-party model permanently good or bad.
Requiring network access for the core regression suite.

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

Current status: browser-owned PKCE connection implemented.

- The signed-in account starts OpenRouter OAuth with an S256 PKCE verifier and
  the server exchanges the one-time authorization code.
- The browser owns the resulting key; the server verifies it with `/api/v1/key`
  and never persists it.
- Connected metadata shows the provider label, remaining credit, and current
  daily usage, and disconnect removes the local key.
- Explicit public model interactions may carry the key transiently and record
  `player_openrouter` as payer; autonomous inference remains server-paid.
- The server-paid OpenRouter lane stops admitting work at $10 reported daily
  usage and fails closed if usage cannot be checked.

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

- Generalize the resident `POST /images` provider path for portrait and composition jobs.
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
- How non-avatar world-subject cards gain levels. Recommendation: make level an authoritative world/evolution property, never infer it from Orb contributions or external ownership.
- Whether OpenRouter key storage should remain browser-only. Recommendation: browser-only MVP; encrypted vault later only if cross-device "connected" state matters.
- Whether resident reply should wait in the same request to reuse a transient key. Recommendation: finish avatar line plus immediate resident reply within the same action transaction for player-key turns; keep async scheduling for server-paid ambient turns.
