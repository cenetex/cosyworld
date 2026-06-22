# CosyWorld 2.0 Engineering Plan

## Current MVP Amendment

The current MVP removes human-authored speech and branch choice sheets from the product path. The browser and default CLI expose `Chat` as one contextual button. Pressing it calls a server action that validates the actor session, composes authoritative room context, generates one in-character line for the player's avatar through the configured LLM or deterministic fallback, commits that avatar line through the C kernel as a shared message event, then schedules the resident reply through the same world-event path.

The current MVP also has durable economy/accounting tables. `orb_ledger` projects committed avatar grants, rule rewards, and server-paid Chat spends from journaled actions. `ai_usage_ledger` records player-avatar Chat payer mode, provider, model, status, source event id, Orb delta, and latency without storing user OpenRouter keys.

Automatic Orb rewards are claim-key gated by actor/context, so replaying the same Listen/combat/flee outcome cannot mint duplicate rewards. `/state` exposes whether the current room's `Listen` reward remains claimable; when Chat is unaffordable and no player OpenRouter payer is connected, the one-button browser shell prefers `Listen` before AI setup only while it can still produce a reward claim.

Older branch-service, message-composer, and `/messages` sections in this document are retained as historical exploration only. They are not current MVP requirements unless explicitly reintroduced.

## Summary

CosyWorld 2.0 should convert the current web prototype into a durable chat-server/MUD architecture with generated human avatars, a shared global world, server-authored avatar chat, autonomous residents, discoverable items, and item-based avatar evolution.

The current prototype in `src/services/web/server/routes/cosyworld.js` is a useful sketch: one location, seed residents, `/state`, `/messages`, and `/move`. It should not become the long-term domain layer. The route should become a thin web transport over existing CosyWorld services plus a new web-native world facade.

## Current Findings

The existing system already has most of the hard primitives:

- `LocationService` persists channel-backed locations.
- `MapService` stores avatar positions and updates `dungeon_positions` plus `avatars.channelId` atomically.
- `ConversationManager` builds channel context, summaries, memory, and AI responses.
- `ResponseCoordinator` selects responders, applies turn limits, and uses locks.
- `TurnScheduler` handles ambient ticks and suppression after human messages.
- `MemoryService` stores avatar memories and narrative history.

The prototype bypasses these primitives by keeping route-local state, route-local prompts, synchronous fanout, and a hardcoded movement stub. That is acceptable for a spike, but CosyWorld 2.0 should fold the prototype back into the existing service architecture.

## Design Principles

- Routes validate, authorize, and serialize. Services own world behavior.
- Locations are channels, but web APIs should not leak Discord objects.
- Humans must have generated avatars before they can press Chat.
- The world is shared and global by default.
- Avatars, items, and locations resolve through a shared card registry rather than bespoke image fields.
- The client renders a server-derived primary action state instead of hardcoding `Chat`.
- Dialogue history and room events are separate concepts.
- AI response selection has one gate.
- Movement is a reducer over world state, not a text-only effect.
- Branch choices are not part of the MVP product path; Chat is server-authored avatar speech.
- Item ownership and avatar evolution are world systems, not local UI badges.
- Prompts are assembled from authoritative current state each turn.
- Streaming is append-only and replayable.
- Starter content is seeded data, not module constants.

## V2 Engine Direction

The long-term design should separate a deterministic rules engine from transport and AI orchestration.

Recommended split:

- `v2/core-c`: deterministic world and rules kernel written in C.
- `v2/orchestrator-rust`: HTTP, SSE/WebSocket, auth/session, persistence, timers, AI calls, media, moderation, and adapter code written in Rust.
- Existing Node services: reference implementation and migration source, not the final v2 runtime boundary.

The C core should have no network, database, filesystem, model, media, Discord, or wall-clock dependencies. It receives an action plus a world snapshot or shard, validates it, resolves rules, and returns events plus a patch.

Shape:

```c
// Shape, not final ABI.
cw_result cw_world_apply(
  cw_world *world,
  const cw_action *action,
  cw_rng_seed seed,
  cw_event_buffer *events,
  cw_patch_buffer *patch
);
```

The Rust orchestrator owns durability and IO:

- Load snapshot or shard.
- Submit action to C.
- Persist emitted events.
- Persist or rebuild world state.
- Stream events to clients.
- Ask AI actors to propose actions.
- Submit AI proposals back through the same C validator.
- Resolve card metadata, NFT provenance, and media URLs for visible world objects.

Costly choice: do not let AI or UI mutate world state directly. All meaningful state changes, including chat messages that open branches, item pickup, item use, movement, evolution, combat, and recovery, should pass through the reducer.

## Card Registry And Target Ownership Chain

CosyWorld should treat cards as the presentation and provenance layer for every visible world entity. The current MVP can use seed/local cards plus the optional external bridge; the target ownership layer is a **native signed provenance log** rather than external NFTs.

The ownership substrate is the one proven in the sibling `signal` project (see [`signal/docs/decentralization-synthesis.md`](../signal/docs/decentralization-synthesis.md)): Ed25519 identity (`client/identity.h`), content-addressed assets with `parent_merkle` provenance (`shared/types.h`), a per-authority signed append-only event log (`server/chain_log.h`, a 184-byte signed header + payload), and `signal_verify` to validate the chain. CosyWorld's C kernel is architecturally a Signal station authority, so `chain_log` can be shared. Crypto stack matches Signal: TweetNaCl (Ed25519), SHA-256 content addressing. External NFTs are an optional bridge resolver, not the ownership layer.

The C kernel should only store stable numeric ids, actor/item/location type flags, state, and rule-relevant fields. It should not parse NFT metadata, know image URLs, or understand wallet ownership. The signed card log is a Rust/service concern; the kernel emits the world events that mints and transfers are *bound to* (`because: event_id`).

The Rust orchestrator should resolve kernel ids into card projections:

```json
{
  "card_id": "rati",
  "display_name": "Rati",
  "role": "teacher",
  "rarity": "super-rare",
  "title": "Signal Studies Pass",
  "blurb": "Hold the signal. Build the world.",
  "aspect": "tall",
  "source": "ruby_high_first_bell",
  "asset_status": "on_chain",
  "set_number": "FB-011",
  "profile_id": "rati-signal-studies-pass",
  "subject": "Signal Studies",
  "image_url": "/assets/cards/rati.png",
  "chain_image_uri": "https://gateway.irys.xyz/..."
}
```

Projection rules:

- Actors use tall card art and are rendered as round portraits in compact UI.
- Items use square card art and are rendered as square command images.
- Locations use wide card art and are rendered as rectangular location tabs and travel buttons.
- Native cards: a card *type* id is `sha256(definition)`; a card *instance* is `{type, serial, mint_event}` with `parent_merkle` provenance. Ownership is a fold over the signed `card_events` log — latest signed transfer to a pubkey wins.
- External Ruby High First Bell cards can be imported from `hall-pass-card-catalog.ts` and `nft-arweave-assets.ts` through the bridge and projected into native cards; they are never required to own a base-game card.
- CosyWorld seed cards use the same schema with `asset_status: "seed_art"` or `asset_status: "pending_art"` until the card pipeline mints them natively.
- Identity is an Ed25519 keypair held by the client. Ownership, transfers, reveal receipts, and provenance are Rust/service concerns; the kernel never sees raw wallet data.
- Bridge wallet ownership (when used) filters access to expansion locations; it must not instantiate private rooms. If two wallets own `location-science-lab`, both avatars move into the same `Science Class` location id and see the same shared chat/event feed.
- AI inference is one-to-many at the location level. A resident response is a world event broadcast to all present humans, not a direct message generated separately per user.
- Client-provided card ids and ownership claims are not authoritative. The server recomputes ownership from the signed log and verifies signatures; query/body card ids are ignored unless an explicit local dev flag is enabled.

This gives v2 one asset/content contract for avatars, items, locations, evolution requirements, native chain ownership, and optional NFT-bridged collections.

## Economy And Pack Integration

The v2 economy should be Rust-orchestrated and C-kernel validated.

Resource split:

- `Orbs`: fungible off-chain play currency in the v2 SQLite/event ledger.
- `Cards`: native chain-owned world objects in the signed provenance log; minted, gifted, and traded without a wallet.
- `Intricately Carved Wooden Boxes`: optional external NFTs that can be burned to mint a native card pack (bridge only).

The C kernel should stay wallet-blind. It can validate challenges, item use, combat, movement, and message creation. It should not store Orb balances, wallet addresses, NFT asset ids, Solana signatures, pack metadata, payment prices, or the card log.

In the native ownership phase, Rust should own:

- Ed25519 player identity sessions and the card provenance log (mint / transfer / gift / swap), each event signed by the authority key.
- Ownership recomputation from the log and signature verification (shared `signal_verify`).
- Card pack creation and opening, minting native cards bound to the reveal event.
- Poem-claim commit-reveal state and validation; world-gate incantation checks.
- Orb ledger mutations and Chat affordability checks.
- Arweave/Irys anchoring of card art and definitions.
- Optional NFT bridge: trusted ownership feed hydration, Box ownership projection, Box burn prepare/confirm, projection of held NFTs into native cards.
- Idempotency across every irreversible ownership and economy action.

Target native ownership data model. The current MVP bridge may keep wallet-shaped fields until these tables replace it:

```sql
CREATE TABLE orb_ledger (
  idempotency_key TEXT PRIMARY KEY,
  wallet_address TEXT,
  actor_id INTEGER,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  source_event_id TEXT,
  balance_after INTEGER NOT NULL,
  metadata_json TEXT,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE wooden_box_receipts (
  box_asset_address TEXT PRIMARY KEY,
  owner_wallet_address TEXT NOT NULL,
  status TEXT NOT NULL,
  burn_signature TEXT UNIQUE,
  metadata_uri TEXT,
  pack_id TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE avatar_pack_openings (
  idempotency_key TEXT PRIMARY KEY,
  owner_pubkey TEXT NOT NULL,
  box_asset_address TEXT,          -- null for in-world (non-bridge) packs
  pack_id TEXT NOT NULL,
  reveal_seed TEXT NOT NULL,
  catalog_hash TEXT NOT NULL,
  card_instance_pubs_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

-- Native ownership chain (mirrors signal/server/chain_log.h)
CREATE TABLE card_events (
  event_seq INTEGER PRIMARY KEY,        -- append-only
  kind TEXT NOT NULL,                   -- mint | transfer | gift | swap
  card_instance_pub TEXT NOT NULL,      -- content-addressed instance id
  from_pubkey TEXT,                     -- null for mint
  to_pubkey TEXT NOT NULL,
  parent_merkle TEXT NOT NULL,          -- provenance lineage
  because_event_id TEXT,                -- world event the mint/transfer is bound to
  authority_pubkey TEXT NOT NULL,       -- uint8_t[32] in the binary log
  signature TEXT NOT NULL,              -- Ed25519 over the header+payload
  arweave_uri TEXT,                     -- anchored art/definition
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE poem_claims (
  claim_id TEXT PRIMARY KEY,
  card_instance_pub TEXT NOT NULL,
  commit_hash TEXT,                     -- sha256(poem + claimer_pubkey), set on commit
  claimed_by_pubkey TEXT,               -- set on reveal; null until claimed
  status TEXT NOT NULL,                 -- open | committed | claimed | spent
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
```

Ownership is not stored as a balance; it is recomputed by folding `card_events` and verifying signatures. The `wooden_box_receipts` table is bridge-only and may be absent on shards that disable external NFTs.

Target route shape. Current bridge pack opening remains `/nft/packs/open` until native packs land:

```text
GET  /economy
POST /actions/combat
POST /cards/gift            # signed transfer, free, first-class
POST /cards/trade           # world-bound, co-signed, atomic swap
POST /cards/claim-commit    # commit hash(poem + pubkey)
POST /cards/claim-reveal    # reveal poem, bind card once
POST /packs/open            # mint native cards (in-world or bridge-fed)
POST /nft/boxes/burn-prepare   # optional external bridge
POST /nft/boxes/burn-confirm   # optional external bridge
POST /nft/packs/open           # current bridge pack route, deprecated once /packs/open exists
```

`POST /actions/chat` should become an atomic economy action:

1. Validate actor session, room access, target, rate limit, suspension, and Orb affordability.
2. Reserve or prepare a one-Orb spend under an idempotency key.
3. Generate the server-authored avatar line.
4. Commit the line through `CW_ACTION_SAY`.
5. Commit the Orb spend tied to the message event.
6. Schedule the resident reply as the same one-to-many room event flow.

If validation fails, no Orb spend is recorded. If AI fails before any avatar line commits, the spend is not recorded or is refunded. If deterministic fallback commits a valid line, the spend is valid because the shared world action happened.

If the request includes a verified player OpenRouter payer, the same action uses that payer instead of spending Orbs. The output remains a public shared room event. The player payer covers the explicit action they initiated, normally the player-avatar line plus the immediate resident reply. It must not pay for autonomous ambient residents, swarm jobs, or unrelated users' future actions.

Ruby High integration should be an adapter, not a runtime dependency:

- Reuse the protected CosyWorld wallet-card export as the ownership feed base.
- Extend the feed with Box NFTs, pack receipts, card status, and card roles.
- Reuse Solana prepare/submit/confirm phasing from Ruby High billing routes.
- Reuse Core pack metadata/update patterns for unopened/opened packs.
- Reuse card burn verification patterns for Box burn verification.
- Reuse pack reveal provenance concepts: catalog hash, commitment, seed, proof.
- Keep Ruby High account/card UI patterns in account surfaces only; normal room play remains transcript plus one contextual command.

Legacy CosyWorld migration boundaries:

- `ItemService` informs item instances, soulbound charges, consumables, and evolution gifts.
- `QuestService` informs non-typed Orb-earning challenges.
- `CombatEncounterService` informs D&D stats and encounter outcomes.
- `claims.js` informs wallet ownership checks but not the Orb ledger; legacy `orbGate` means collection ownership.
- `pricingService`, `x402Service`, and marketplace services remain external payment rails. They can later sell Boxes or bundles, but they must not become the in-world Orb ledger.

### Aggregate Resident Placement

Resident NPC placement is a global daily calculation over wallet/card ownership:

```text
for each resident avatar card:
  for each wallet holding that avatar card:
    for each unique location card in the same wallet:
      score[location] += 1
  if score is empty:
    resident.location = cosy-cottage
  else:
    winners = locations with max(score)
    resident.location = winners[day_index % winners.length]
```

Important constraints:

- Count wallet-location sets, not raw duplicate cards in one wallet, unless a future economy explicitly chooses weighted copies.
- Only card ids map to world location ids; wallet addresses and raw chain metadata stay outside the C kernel.
- The Cosy Cottage is always public for human entry. A `cosy-cottage` card can count as a resident-placement vote, but it must never become required to enter the lobby.
- Placement is global. It is not recalculated per requesting player.
- The daily result should be committed as a system world action when the scheduler is productionized, so event replay and user-visible presence remain auditable.
- The current v2 prototype applies the overlap placement at boot from a server-owned ownership snapshot. `COSYWORLD_DEPLOY_PROFILE=production` hydrates the same `OwnershipIndex` from Ruby High's protected remote wallet/card export and refuses to start if dev-only ownership shortcuts are enabled.

## AI Gateway And OpenRouter Player Payer

V2 should extract the current inline Rust AI calls into an `ai_gateway` module before adding more model usage.

Current state:

- `AiConfig` supports one server-side OpenAI-compatible key.
- `POST /actions/chat` generates a player-avatar line and schedules a resident reply.
- Player OpenRouter key verification, transient player-paid Chat, server-paid Orb fallback, and AI usage ledger rows are implemented in the MVP.
- Model capability discovery and real image/media generation are not implemented in v2 yet.

Target boundary:

- `ai_gateway` owns provider routing, OpenRouter headers, timeouts, model selection, key verification, request retries, usage accounting, and media/image calls.
- Domain routes own auth, room access, focus target validation, and idempotency.
- The C kernel owns whether the resulting world action is legal.

Recommended payer modes:

```text
player_openrouter_transient
player_openrouter_vaulted
cosyworld_orbs
cosyworld_system
admin_system
local_fallback
```

For the first slice, prefer `player_openrouter_transient`, matching Ruby High's PKCE/key pattern:

- The player connects OpenRouter through OAuth or pastes a key in a development-only flow.
- The server verifies the key with OpenRouter's `/api/v1/key`.
- The browser sends the key only with explicit player-initiated AI actions.
- The server uses the key transiently and does not persist it.
- The server stores only account/session identity and non-secret verification metadata.
- A future server key vault is a separate security project, not a quiet extension of the account table.

Recommended tables:

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
```

Recommended routes:

```text
GET  /ai/account
POST /ai/openrouter/verify
POST /ai/openrouter/disconnect
GET  /ai/models
POST /actions/chat
```

`POST /actions/chat` becomes:

1. Validate actor session, suspension, focus target, room access, rate limit, and in-flight lock.
2. Resolve payer: verified player OpenRouter key or Orb affordability.
3. Reserve Orb spend only for server-paid Chat.
4. Generate the avatar line through `ai_gateway`.
5. Commit `CW_ACTION_SAY`.
6. Generate and commit the immediate resident reply under the same action payer.
7. Finalize AI usage and Orb ledger records idempotently.
8. Broadcast the shared events.

The current async resident scheduler should keep server-paid ambient use, but player-paid Chat should either complete the immediate resident reply inside the same request or store only a short-lived in-memory payer reference with a strict TTL. Do not write a player API key into the event store.

## AI Media Pipeline

Real images should move through a v2 `media_jobs` pipeline.

The legacy Node system already has the media concepts:

- `SelfieTool` for avatar/location/item photos.
- `SceneCameraTool` for multi-avatar location scenes.
- `BattleMediaService` for attacker/defender/location combat scenes.
- `GoogleAIService.composeImageWithGemini` for reference-based composition.

Ruby High already has the OpenRouter response pattern:

- request `modalities: ["image", "text"]`;
- pass reference images as `image_url` content parts;
- read `choices[0].message.images[0].image_url.url`;
- upload data URLs to stable object storage when configured.

Recommended tables:

```sql
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
```

First intents:

- `avatar_portrait`
- `avatar_card_art`
- `avatar_photo`
- `room_scene`
- `combat_scene`
- `evolution_card_art`
- `pack_reveal`

Provider order:

1. OpenRouter image model discovered with `output_modalities=image`.
2. OpenRouter text+image model for reference composition.
3. Existing Gemini composition fallback.
4. Deterministic placeholder.

Player-paid media must clearly become public card/world media when attached to a shared avatar, event, or location.

## Proposed Service Boundaries

### `CosyWorldService`

New web-native facade for room state and actions.

Responsibilities:

- Bootstrap seed world data.
- Resolve the requesting player's avatar gate.
- Generate and persist human avatars.
- Fetch current room state.
- Compute the current primary action state.
- Persist player messages.
- Append room events.
- Open, resolve, and expire dialogue branches.
- Discover, transfer, and consume items.
- Check avatar evolution requirements.
- Request NPC responses.
- Move avatars and players.
- Shape API responses for the web client.

Dependencies:

- `locationService`
- `avatarService`
- `mapService`
- `conversationManager`
- `responseCoordinator`
- `turnScheduler`
- `memoryService`
- `databaseService`
- `eventBus` or a lightweight local event stream adapter
- `itemService`

### `PlayerAvatarService`

New or extended service for human embodiment.

Responsibilities:

- Create a human avatar before chat is allowed.
- Store avatar identity, portrait, description, current location, and owner/session.
- Sanitize public avatar display names at the server boundary; fallback to a neutral traveler name for unsafe, reserved, or prompt-injection-like input.
- Return the existing avatar for returning users.
- A signed wallet session should recover the linked live human actor and mint a fresh actor session without committing a duplicate `actor.created` event.
- Place the avatar into The Cosy Cottage on first creation.
- Keep display identity separate from auth/session internals.

### `ActionStateService`

Small policy service that decides what the primary action surface should do.

The web client should render this state directly:

```js
{
  label: 'Chat',
  kind: 'chat',
  disabled: false,
  reason: null,
  options: []
}
```

Possible states:

- `create_avatar`
- `chat`
- `choose_branch`
- `give_item`
- `travel`
- `continue`
- `wait`

When multiple options are available, the state should still have one primary surface. Pressing it opens a temporary action sheet with the options.

### `WorldChannelAdapter`

Transport-neutral adapter that lets existing chat services operate on web channels.

The existing services often expect Discord-like channel and message objects. Instead of pushing Discord details into web routes, define small ports:

```js
// Shape, not final code.
const channel = {
  id: 'cosy-cottage',
  name: 'The Cosy Cottage',
  type: 'web-location',
  guildId: 'cosyworld',
};

const message = {
  id,
  channelId: 'cosy-cottage',
  author: {
    id: playerId,
    username: displayName,
    bot: false,
  },
  content,
  createdTimestamp,
};
```

Discord and web should become two transports over the same world concepts.

### `RoomEventService`

New or folded into `CosyWorldService`.

Responsibilities:

- Append non-dialogue room events.
- Replay events after an event id with a bounded default and hard explicit cap.
- Build recent room event synopses for prompts.
- Keep event log bounded and summarizable.

Room events are not chat messages. They include movement, enter, leave, idle, door-locked, memory-noted, response-requested, and response-created.

### `BranchService`

New service for branching dialogue state.

Responsibilities:

- Open branches from NPC dialogue, room events, item discoveries, or exits.
- Persist pending branch options.
- Resolve one selected option.
- Expire stale branches.
- Emit room events for branch open, choice selected, and branch resolved.
- Expose branch state to prompt composition.

Branches are not quiz questions. They are world choices.

### `EvolutionService`

New service for avatar evolution tracks.

Responsibilities:

- Store per-avatar evolution levels and requirements.
- Check item uniqueness and ownership.
- Consume or mark items when used.
- Emit evolution world events.
- Update avatar state, art references, abilities, branches, or movement preferences after evolution.

Rule baseline:

- Level 2 requires two unique required items.
- Later levels can require more unique items or stricter item classes.
- An item instance can only satisfy one requirement unless marked reusable.

## Stats and Combat Kernel

The existing battle system already contains a compact D&D-shaped ruleset. V2 should preserve the mechanics but move rule resolution into the C core.

### Existing Mechanics to Preserve

From `StatService`:

- Six ability scores: strength, dexterity, constitution, intelligence, wisdom, charisma.
- HP derived from Constitution at creation time.
- Base stats are immutable.
- Damage, healing, buffs, debuffs, defending, hidden state, and cooldowns are modeled as modifiers or conditions.
- Effective stats are base stats plus active modifiers.

From `BattleService`:

- Attack roll: d20 plus Strength modifier.
- Armor class: 10 plus defender Dexterity modifier, plus a defend bonus when defending.
- Critical hit on natural 20.
- Damage: d8 plus Strength modifier, doubled damage dice on critical, minimum 1.
- Damage is tracked as a damage counter rather than mutating base HP.
- Knockout and death are state transitions, not chat-only narration.

From `CombatEncounterService`:

- Encounters are scoped to a location/channel.
- Combatants roll initiative using d20 plus Dexterity modifier.
- The encounter has round number, initiative order, current turn index, conditions, current HP, and end reasons.
- Turn actions include challenge/start encounter, attack, defend, hide, flee, and item use.
- End reasons include one combatant remaining, all defending, max rounds, idle, and flee.

From `PotionTool`:

- Items can have charges, cooldown/recharge, and a world-changing effect such as revival.

### C Core Data Model

The core should own these structs conceptually:

```c
typedef struct {
  int8_t strength;
  int8_t dexterity;
  int8_t constitution;
  int8_t intelligence;
  int8_t wisdom;
  int8_t charisma;
  int16_t hp_base;
  uint8_t level;
} cw_stat_block;

typedef struct {
  cw_id source_event;
  cw_id target_actor;
  uint16_t stat_or_condition;
  int16_t value;
  uint64_t expires_at_tick;
} cw_modifier;

typedef struct {
  cw_id encounter_id;
  cw_id location_id;
  uint8_t state;
  uint16_t round;
  uint16_t current_turn_index;
  cw_id initiative_order[CW_MAX_COMBATANTS];
} cw_combat_encounter;
```

`current_hp` should be derived from `hp_base - damage_modifiers + healing_modifiers` unless profiling proves it should be cached. If cached, every change must still emit enough events to rebuild it exactly.

### C Core Actions

Add first-class action kinds:

- `CW_ACTION_GENERATE_OR_ASSIGN_STATS`
- `CW_ACTION_ABILITY_CHECK`
- `CW_ACTION_START_ENCOUNTER`
- `CW_ACTION_JOIN_ENCOUNTER`
- `CW_ACTION_ROLL_INITIATIVE`
- `CW_ACTION_ATTACK`
- `CW_ACTION_DEFEND`
- `CW_ACTION_HIDE`
- `CW_ACTION_FLEE`
- `CW_ACTION_USE_ITEM`
- `CW_ACTION_APPLY_MODIFIER`
- `CW_ACTION_CLEAR_CONDITION`
- `CW_ACTION_EVOLVE_ACTOR`
- `CW_ACTION_END_TURN`

The UI and AI should not call `BattleService`-style side effects. They should propose one of these actions. The core validates whether the actor is present, alive, not knocked out, in turn, holding the item, able to target the defender, and allowed by the location.

### Core Events

The existing event names are a good starting point:

- `combat.encounter.started`
- `combat.initiative.rolled`
- `combat.turn.started`
- `combat.attack.attempt`
- `combat.attack.hit`
- `combat.attack.miss`
- `combat.damage.applied`
- `combat.knockout`
- `combat.death`
- `combat.defend`
- `combat.hide.success`
- `combat.hide.fail`
- `combat.flee.attempt`
- `combat.flee.success`
- `combat.flee.fail`
- `combat.encounter.ended`
- `item.used`
- `stat.modifier.added`
- `condition.added`
- `condition.removed`

Every dice event should include the die, raw roll, modifier, total, DC or armor class, and seed/correlation id needed for audit.

### Deterministic Dice

The current Node dice service uses cryptographic randomness, which is fair but not replayable. V2 should make dice deterministic inside the core:

- Rust obtains entropy for the action seed.
- C derives all rolls from the seed with a fixed PRNG.
- C emits each roll as an event.
- Replaying the event log can trust emitted rolls, while debugging can rerun the reducer with the same seed.

This keeps combat fair enough for a cozy shared world while making bugs reproducible.

### Rust Orchestration

Rust owns:

- Encounter timers and turn deadlines.
- SSE/WebSocket fanout.
- Persistence of events and snapshots.
- AI narrative requests before combat, after rounds, and after encounter end.
- Battle recap media generation if kept.
- Safe-location routing after flee or knockout.
- Moderation and rate limits.

Rust should never decide whether an attack hit, whether an item can be used, or whether evolution requirements are satisfied. It can choose when to ask for an action and how to present the resulting events.

### Primary Action Projection

The C core can return action offers for the current actor:

```js
{
  primaryAction: {
    kind: "act",
    label: "Act",
    options: [
      { kind: "attack", label: "Attack", targetIds: ["skull"] },
      { kind: "defend", label: "Defend" },
      { kind: "hide", label: "Hide" },
      { kind: "use_item", label: "Use" }
    ]
  }
}
```

Rust can project this into the one-button UI rule. The resting button still shows one label. Multiple options appear only inside a temporary sheet.

Combat is the Ruby High quiz replacement. The UI should never render `A/B/C/D` choices or a typed answer field for this loop. In an encounter, Rust projects a compact focus rail for `Attack`, `Defend`, `Flee`, and `Use`; whichever rail item is focused becomes the single primary command. The MVP already lets a held potion become `Use` when a damaged target is present. If future `Use` actions need richer item/target choice, the primary command can open a temporary action sheet, then collapse back to the one-button state.

Orb rewards should be derived from committed combat/challenge events:

- `combat.encounter.ended` with victory or peaceful resolution can award 2 to 5 Orbs.
- `combat.encounter.ended` after a small sparring challenge can award 1 to 3 Orbs.
- `combat.flee.success` usually awards no Orbs, except a small survival reward for dangerous encounters.
- `ability_check.rolled` can award a small cooldown-gated `Listen` or `Notice` reward when no combat is available.

AI may narrate combat results after the kernel commits events. It must not decide hits, damage, HP, rewards, item use, or encounter end state.

## Domain Model

### Location

Extend location seed data beyond the current channel-backed shape:

```js
{
  channelId: 'cosy-cottage',
  slug: 'cosy-cottage',
  name: 'The Cosy Cottage',
  type: 'web-location',
  description,
  imageUrl,
  facts: [
    'Firelit cottage',
    'Rain-soft windows',
    'Shelves of storybooks',
    'A low doorway waits for future paths'
  ],
  exits: [],
  starterMessages: [],
  idleDeck: [],
  safetyProfile: 'cozy'
}
```

### Avatar

Seed Rati, Whiskerwind, and Skull as normal `avatars` records.

Add or normalize fields:

- `slug`
- `displayName`
- `channelId`
- `speechMode`
- `persona`
- `responsePolicy`
- `safetyProfile`
- `status`
- `color`
- `icon`

Speech modes:

- `prose` for Rati.
- `emoji_only` for Whiskerwind.
- `emote_only` for Skull.

### Human Avatar

Human player avatars should use the same broad avatar language where possible, but with ownership and privacy fields.

```js
{
  _id,
  ownerId,
  sessionId,
  slug,
  displayName,
  kind: 'human',
  portraitUrl,
  description,
  channelId: 'cosy-cottage',
  inventoryId,
  createdAt,
  lastSeenAt
}
```

Chat actions should use the human avatar id as the actor id. A request without a generated human avatar should receive an avatar-required response, not a chat composer state.

### Primary Action State

The server should include the current action state in `/state`.

```js
{
  primaryAction: {
    kind: 'create_avatar',
    label: 'Create Avatar',
    options: [],
    target: null,
    disabled: false
  }
}
```

The server derives the state from:

- Whether the player has a human avatar.
- Whether a branch is pending.
- Whether the player has an item that can satisfy a request.
- Whether a valid travel action is selected.
- Whether the room is waiting for an in-progress event.

Priority order:

1. `create_avatar`
2. `wait`
3. `choose_branch`
4. `give_item`
5. `travel`
6. `chat`

The priority order can evolve, but the client should not own it.

### Message

Use the existing `messages` collection for durable dialogue.

Required fields:

- `channelId`
- `authorId`
- `authorName`
- `authorType`: `player`, `avatar`, `location`, `system`
- `kind`: `speech`, `emote`, `system`
- `content`
- `createdAt`
- `transport`: `web` or `discord`
- `isSelf` for the requesting client, computed at read time rather than stored globally

### Room Event

Use a separate `room_events` collection.

```js
{
  eventId,
  channelId,
  kind,
  actorId,
  actorType,
  text,
  payload,
  createdAt
}
```

Kinds:

- `room.opened`
- `player.entered`
- `player.avatar.created`
- `avatar.entered`
- `avatar.left`
- `avatar.moved`
- `avatar.autonomy.started`
- `avatar.autonomy.completed`
- `avatar.evolved`
- `message.created`
- `response.requested`
- `response.created`
- `branch.opened`
- `branch.option.selected`
- `branch.resolved`
- `branch.expired`
- `item.discovered`
- `item.picked_up`
- `item.given`
- `item.consumed`
- `idle`
- `door.locked`
- `memory.noted`
- `location.updated`

`message.created` may be mirrored as a room event for stream ordering, but durable dialogue remains in `messages`.

### Branch

Branches represent temporary in-world choices.

```js
{
  branchId,
  channelId,
  playerAvatarId,
  openedBy: {
    actorId,
    actorType
  },
  prompt,
  options: [
    {
      optionId,
      label,
      intent,
      requirements,
      effects
    }
  ],
  status: 'pending',
  expiresAt,
  createdAt,
  resolvedAt
}
```

Branch statuses:

- `pending`
- `resolved`
- `expired`
- `cancelled`

Branches should not be stored in dialogue history as system prompts. They should be summarized into the prompt stack from authoritative branch state.

### Item

Items are world objects.

```js
{
  itemId,
  slug,
  name,
  description,
  itemClass,
  unique: true,
  reusable: false,
  locationId,
  holderId,
  holderType,
  discoveredAt,
  discoveredBy,
  evolutionTags: ['rati', 'storycraft']
}
```

Item locations and holders are global. If one player picks up a unique global item, it should no longer be available in that location unless the design marks it as instanced or renewable.

### Inventory

Inventories belong to human avatars and possibly NPC avatars.

```js
{
  inventoryId,
  ownerId,
  ownerType: 'human_avatar',
  itemIds: [],
  updatedAt
}
```

### Evolution Track

Evolution tracks define what an avatar needs and what changes afterward.

```js
{
  avatarId,
  currentLevel: 1,
  levels: [
    {
      level: 2,
      requiredUniqueItems: 2,
      acceptedItemSlugs: ['moonwool', 'story-button'],
      consumedItemIds: [],
      rewards: {
        status,
        promptPatch,
        imageUrl,
        unlockedBranches: []
      }
    }
  ]
}
```

Evolution should update world state through `EvolutionService`, then emit `avatar.evolved`.

## API Design

### REST

```http
GET /api/cosyworld/state?locationId=cosy-cottage
POST /api/cosyworld/avatar
GET /api/cosyworld/locations/:locationId/messages?after=:eventId
GET /api/cosyworld/locations/:locationId/events?after=:eventId
POST /api/cosyworld/messages
POST /api/cosyworld/branches/:branchId/select
POST /api/cosyworld/items/:itemId/pick-up
POST /api/cosyworld/items/:itemId/give
POST /api/cosyworld/avatars/:avatarId/move
POST /api/cosyworld/players/me/move
```

`POST /api/cosyworld/avatar`:

```json
{
  "seed": "cozy wanderer with bright boots",
  "style": "storybook"
}
```

Response:

```json
{
  "avatar": {
    "id": "hav_...",
    "displayName": "Mara Brightboots",
    "description": "A rain-ready wanderer with a careful smile.",
    "portraitUrl": "/..."
  },
  "state": {
    "primaryAction": {
      "kind": "chat",
      "label": "Chat"
    }
  }
}
```

`POST /api/cosyworld/messages`:

```json
{
  "locationId": "cosy-cottage",
  "content": "Is there a story about that doorway?"
}
```

If the requester has no human avatar:

```json
{
  "error": "avatar_required",
  "primaryAction": {
    "kind": "create_avatar",
    "label": "Create Avatar"
  }
}
```

Response:

```json
{
  "accepted": true,
  "messageId": "msg_...",
  "eventId": "evt_..."
}
```

NPC responses should not block the write response. They arrive over the event stream.

`POST /api/cosyworld/branches/:branchId/select`:

```json
{
  "optionId": "ask-rati-doorway-story"
}
```

`POST /api/cosyworld/items/:itemId/give`:

```json
{
  "targetAvatarId": "rati",
  "reason": "evolution"
}
```

### SSE

Start with Server-Sent Events.

```http
GET /api/cosyworld/stream?locationId=cosy-cottage
Last-Event-ID: evt_...
```

Benefits:

- Simple browser client.
- Works with standard HTTP auth/cookies.
- Supports replay by `Last-Event-ID`.
- Fits append-only room timelines.

Use WebSockets later only if bidirectional low-latency presence, typing, or multiplayer cursors become necessary.

### Client State

The client should consume server state as an ordered event log:

- Initial `state` snapshot.
- Append events from SSE.
- Reconcile by `eventId`.
- Reconnect with `Last-Event-ID`.

Polling can remain as a fallback during migration.

## Response Selection

The prototype currently generates Rati, Whiskerwind, and Skull replies for every user message. 2.0 should replace that with `ResponseCoordinator`.

Policy:

- Direct mention or reply selects the referenced avatar when eligible.
- Ordinary room speech selects zero or one avatar.
- Ambient ticks select zero or one avatar.
- Opening beat can include all starter residents.
- Cooldowns prevent repeated selection of the same resident.
- Locks prevent duplicate responses in concurrent requests.

The max response count should default to one.

## Autonomous Avatar Runtime

Autonomous avatars should use the same world reducers as human-triggered actions.

Autonomy loop:

1. Scheduler proposes an avatar action.
2. Policy checks cooldowns, current location, branch sensitivity, and safety.
3. Action reducer validates the action.
4. Reducer updates state.
5. Room events explain what happened.
6. Optional response request is sent through `ResponseCoordinator`.

Allowed autonomous actions:

- idle in place
- move to an unlocked location
- inspect a room fact
- search for an item
- react to an unresolved room event
- open a low-stakes branch
- request an item needed for evolution

Disallowed without explicit product approval:

- consuming a player's item
- completing major branches without player input
- opening new locations
- evolving without the required items
- flooding room timelines

Autonomy must be legible. If a player returns after autonomous actions, the room timeline should explain the important changes.

## Branching Dialogue Runtime

Branching dialogue is stateful and server-owned.

Branch open flow:

1. NPC, room event, item, or player message creates a branch proposal.
2. `BranchService` validates option count, requirements, and expiry.
3. `room_events` receives `branch.opened`.
4. `/state` exposes `primaryAction.kind = choose_branch`.
5. The client opens options only when the user activates the primary action.

Branch resolution flow:

1. User selects an option.
2. `BranchService` checks requirements.
3. Effects apply through reducers: message, item, movement, relationship, room fact, or evolution request.
4. Branch becomes `resolved`.
5. Room event and optional NPC response are emitted.

Branches should be scoped to a player avatar unless explicitly marked global. The existence of a branch can be inspired by global room state, but each player should not be blocked by another player's unresolved personal choice.

## Prompt Composition

Copy the Ruby High lesson conceptually: dialogue and volatile room events are separate.

Prompt stack per NPC response:

1. Static avatar identity and speech contract.
2. Current room block from authoritative location state.
3. Current cast block from avatars in the room.
4. Current relevant branch state.
5. Relevant visible item and evolution state.
6. Recent room events since this avatar last spoke.
7. Relevant memories and room summaries.
8. This-turn directive.
9. Dialogue-only recent message history.

Do not append old directives, tool notes, or movement facts as durable system messages in chat history.

### Example Prompt Blocks

Room block:

```text
Current location: The Cosy Cottage (#cosy-cottage)
Facts:
- Firelit cottage
- Rain-soft windows
- Shelves of storybooks
- Low doorway waiting for future paths
Open exits: none
```

Cast block:

```text
Residents here:
- Rati: host, knitting by the hearth, prose speech
- Whiskerwind: symbolic resident, emoji-only
- Skull: silent wolf, emote-only
```

Recent events block:

```text
Recent room events:
- Traveler tried the low doorway; it did not open.
- The kettle began to sing.
```

This-turn directive:

```text
THIS TURN: Respond as Rati only. Under 45 words. Do not speak for Whiskerwind or Skull.
```

Branch block:

```text
Pending branch for Mara Brightboots:
- Ask Rati for a story about the doorway.
- Offer to find warmer yarn.
- Sit with Skull and listen.
```

Item/evolution block:

```text
Visible item hints:
- Rati is looking for moonwool and story-button to reach level 2.
- The player is holding moonwool.
```

## Output Validation

Add lightweight post-generation validation before messages are persisted.

Rati:

- Non-empty prose.
- No role prefix like `Rati:`.
- Does not speak for other residents.
- Under configured length unless explicitly asked for a longer story.

Whiskerwind:

- Emoji-only.
- No letters.
- 3 to 6 emoji preferred.

Skull:

- Third-person emote.
- No quoted speech.
- No first-person inner monologue.

If validation fails:

- Retry once with a stricter directive.
- Fall back to deterministic safe output.

Moderation audit:

- Operator event replay must be token-protected.
- Operator replay can see all rooms, but player `/events` and `/stream` stay visibility-filtered.
- Audit replay should stay bounded by default and by hard cap.
- Operators need a token-protected actor suspension path that clears active sessions and rejects future public actions for that actor.

## Movement Design

Movement should use `MapService.updateAvatarPosition()` for avatars.

Reducer flow:

1. Validate actor and destination.
2. Load current location.
3. Load requested destination or exit.
4. If blocked, append `door.locked` or `move.blocked` room event.
5. If valid, atomically update position.
6. Append departure event to old location.
7. Append arrival event to new location.
8. Record location memory.
9. Request optional resident reaction through `ResponseCoordinator`.

For the first release, The Cosy Cottage has no open exits. The low doorway is a fact, not a usable destination.

## Item and Evolution Design

Items should be manipulated only through reducers.

Item pickup flow:

1. Validate that the item exists and is visible or discoverable.
2. Validate whether the item is global, instanced, renewable, or already held.
3. Move the item to the player's inventory.
4. Emit `item.picked_up`.
5. Recompute primary action state.

Item give flow:

1. Validate player avatar and held item.
2. Validate target avatar and requirement.
3. Transfer or consume the item.
4. Emit `item.given`.
5. Ask `EvolutionService` whether requirements are now satisfied.
6. If satisfied, evolve the avatar and emit `avatar.evolved`.

Evolution flow:

1. Load avatar evolution track.
2. Load consumed or offered unique items.
3. Check the next level requirement.
4. Apply avatar updates atomically.
5. Record level change.
6. Emit a room event.
7. Request an optional resident reaction.

For level 2, the baseline requirement is two unique avatar-specific items.

## Persistence

Collections:

- `locations`
- `avatars`
- `human_avatars`
- `dungeon_positions`
- `messages`
- `room_events`
- `branches`
- `items`
- `inventories`
- `evolution_tracks`
- `response_locks`
- `presence`
- existing memory collections

Indexes:

```js
locations:        { channelId: 1 } unique
avatars:          { slug: 1 } unique where present
human_avatars:    { ownerId: 1 } unique where present
human_avatars:    { sessionId: 1 } unique where present
dungeon_positions:{ avatarId: 1 } unique
messages:         { channelId: 1, createdAt: 1 }
room_events:      { channelId: 1, eventId: 1 } unique
room_events:      { channelId: 1, createdAt: 1 }
branches:         { playerAvatarId: 1, status: 1, createdAt: -1 }
branches:         { expiresAt: 1 } ttl
items:            { slug: 1 }
items:            { locationId: 1, discoveredAt: 1 }
items:            { holderType: 1, holderId: 1 }
inventories:      { ownerType: 1, ownerId: 1 } unique
evolution_tracks: { avatarId: 1 } unique
presence:         { channelId: 1, avatarId: 1 } unique
response_locks:   { expiresAt: 1 } ttl
```

## Seed Data

The v2 MVP keeps seed actor/item/location labels and level 2 evolution tracks in `v2/orchestrator-rust/src/seed_content.json`. Rust validates that file at startup/test time and still lets the C kernel enforce rules by stable ids.

For the legacy/production content pipeline, add a seed script, for example:

```text
scripts/seed-cosyworld-2.mjs
```

It should upsert:

- The Cosy Cottage location.
- Rati avatar.
- Whiskerwind avatar.
- Skull avatar.
- Starter positions in `dungeon_positions`.
- Opening room events/messages.
- Starter item definitions and hidden item placements.
- Level 2 evolution tracks for Rati, Whiskerwind, and Skull, matching the v2 seed manifest.

The seed script must be idempotent.

## Web UI Architecture

The web client should be rewritten around a room shell:

- `RoomView`
- `Timeline`
- `Message`
- `ResidentPresence`
- `PrimaryAction`
- `AvatarCreationSheet`
- `InventoryPeek`

Resting UI:

- Exactly one primary action surface.
- No permanent refresh button.
- No permanent send button.
- No permanent name input.
- No permanent location list for the one-location release.

Primary action:

- Renders from server `primaryAction`.
- Shows `Create Avatar` until human avatar creation.
- Shows `Chat` in normal play.
- Shows `Give Item`, `Travel`, `Attack`, `Defend`, `Flee`, `Continue`, or `Wait` when the server says that state is active.
- Commits the focused contextual action directly through the server action endpoint.

Chat:

- Does not open a text composer.
- Calls `/actions/chat` with actor/session and target actor id.
- Shows pending state while the server authors the avatar line.
- Restores focus intentionally after the action resolves.

Future location navigation should happen through room state and movement, not through always-visible sidebar buttons.

## Migration Plan

### Phase 0: Preserve Prototype

Keep the current static UI and `/api/cosyworld` route available while building the service layer behind it.

### Phase 1: Seed Durable World

- Add location/avatar seed script.
- Persist The Cosy Cottage and starter residents.
- Persist starter item definitions and level 2 evolution tracks.
- Keep API response shape compatible with current UI.

### Phase 2: Human Avatar Gate

- Add human avatar creation endpoint.
- Persist human avatars and inventories.
- Add server-derived primary action state.
- Block chat writes until the requester has a human avatar.

### Phase 3: Persist Messages

- Replace module-global `messages` with `messages` collection reads/writes.
- Add `room_events` collection.
- Return state from DB.

### Phase 4: Add SSE

- Add stream endpoint.
- Emit events for posted messages and system events.
- Keep polling fallback.

### Phase 5: Coordinator Responses

- Route message response requests through `ResponseCoordinator`.
- Add web channel/message adapter.
- Stop synchronous all-NPC fanout.

### Phase 6: Movement Reducer

- Replace `/move` stub with movement service.
- Use `MapService.updateAvatarPosition()`.
- Emit blocked movement for unopened paths.

### Phase 7: Primary Action UI

- Replace the three-column prototype with the room shell.
- Enforce the primary action surface.
- Add avatar creation and command-only contextual actions.
- Verify desktop and mobile with browser screenshots.

### Phase 8: Items, Evolution, Future Branches

- Add item pickup and give APIs.
- Add level 2 evolution reducers.
- Keep branch state and selection APIs out of the MVP unless explicitly reintroduced.

### Phase 9: Autonomous Avatar Expansion

- Add autonomous movement and item-seeking.
- Add exits and a second location only after the one-room loop is stable.

### Phase 10: Native Ownership Chain

- Add Ed25519 client identity and the `card_events` signed log (share `signal/server/chain_log.h`).
- Mint seed cards natively; recompute ownership by folding the log; verify with shared `signal_verify`.
- Add `/cards/gift` (free) and world-bound `/cards/trade` (co-signed, atomic), preserving `parent_merkle` lineage.
- Add poem claims (commit-reveal) and world-gate incantations.
- Anchor card art/definitions to Arweave.
- Keep the external NFT bridge (Box burn → native pack) optional and behind the trusted ownership feed. Run federated (authority = operator, quorum 1); leave the P2P quorum endpoint for later.

## Testing Plan

### Unit Tests

- Seed script idempotency.
- Human avatar generation gate.
- Primary action state priority.
- Location fetch by channel id.
- Avatar position updates.
- Room event ordering.
- Server-authored avatar Chat planning and commit.
- Rejection of client-authored speech.
- Duplicate in-flight Chat rejection.
- Item pickup, handoff, and uniqueness.
- Evolution requirement checks.
- Response selection max one responder.
- Mention selection.
- Whiskerwind emoji-only validator.
- Skull emote-only validator.
- Rati does not speak for others.
- Prompt stack excludes stale system directives.

### Route Tests

- `GET /state` returns The Cosy Cottage.
- `GET /state` returns `Create Avatar` before human avatar creation.
- `POST /avatar` creates a human avatar and inventory.
- `POST /actions/chat` rejects requests without a matching actor session.
- `POST /actions/chat` rejects requests without enough Orbs once Orb costs are enabled.
- `POST /actions/chat` spends zero Orbs when a verified player OpenRouter payer is used.
- `POST /actions/chat` records exactly one idempotent Orb spend when a server-authored avatar line commits.
- Automatic Orb rewards are recorded once per stable actor/context claim key.
- `/state` reports whether the current room's `Listen` reward remains claimable.
- The browser prefers a zero-Orb earning action such as `Listen` over AI setup only while the server reports it as claimable.
- `POST /actions/chat` commits a server-authored avatar line before resident response.
- `POST /actions/chat` returns `409` with no events when a Chat turn is already in flight for the actor.
- `POST /actions/say` returns `410` for disabled client-authored speech.
- `POST /actions/combat` exposes `Attack`, `Defend`, `Flee`, and `Use` without quiz-answer UI.
- `POST /actions/combat` awards Orbs only from committed combat/challenge outcomes.
- `POST /actions/give-item` can trigger evolution.
- Local Box burn confirmation is idempotent by burn signature and Box asset id; production confirmation verifies a Solana/Core burn for the Box asset, connected wallet, and configured collection before writing the same idempotent receipt.
- Pack opening grants the same cards on duplicate confirmation.
- `/state` includes a wallet-scoped account projection for active Boxes, unopened packs, recent burn receipts, and recent pack reveals; the browser shows it only through the top economy focus.
- SSE replay returns missed events.
- Blocked movement emits room event.
- Invalid content is rejected.

### Integration Tests

- Full Chat turn with one server-authored avatar line and at most one NPC response.
- Reload preserves room history.
- Response lock prevents duplicate NPC replies.
- Ambient tick is sparse and does not interrupt active room turns.
- Movement records memory.
- Item discovery is shared globally.
- Level 2 evolution requires two unique items.
- Autonomous avatar action emits legible room events.

### Browser Tests

- Desktop resting UI has exactly one primary action surface.
- Mobile resting UI has exactly one primary action surface.
- New-user UI starts at `Create Avatar`.
- No chat composer is present in normal play.
- Pressing `Chat` shows a pending state, commits a server-authored avatar line, and returns to one-button mode.
- Pressing `Give Item` commits the focused item handoff directly through the primary command.
- Contextual actions return to the latest server-derived primary action state.
- Text does not overlap at mobile widths.
- Timeline remains readable over background art.

## Observability

Log and measure:

- Message accepted latency.
- Avatar creation latency and failure rate.
- Time to first NPC response.
- NPC selected per turn.
- Validation failures by speech mode.
- Primary action state transitions.
- Branch open/resolve/expire counts.
- Item discovery, pickup, and give counts.
- Evolution attempts and successes.
- Orb grants, spends, balances, and rejection reasons.
- Box burn prepare/confirm attempts and duplicate receipts (bridge only).
- Card mint / gift / trade / swap events, signature-verify failures, and ownership-fold mismatches.
- Poem claim commits, reveals, front-run rejections, and double-claim attempts.
- Pack opens, reveal provenance, and card mint counts.
- Autonomous avatar actions per hour.
- SSE reconnects.
- Room event replay counts.
- Response lock contention.
- Provider failures and fallback usage.

## Open Questions

- What is the initial player identity model: anonymous session, local display name, or authenticated account? The native chain wants an Ed25519 keypair per player — when is it generated, where is it stored, and how is it recovered?
- Should the card log start as a single operator-signed authority (federation, quorum 1), and what is the concrete trigger to revisit the P2P quorum endpoint?
- Are claim poems authored per card, drawn from a curated pool, or generated? What entropy floor keeps them un-guessable while still memorable?
- Should world-gate incantations be discoverable through play (like the cosy MUD command discovery), or seeded as known lore?
- Should human avatars use `dungeon_positions` immediately, or should that table stay NPC-only until movement expands?
- Which parts of The Cosy Cottage timeline are globally public before moderation is ready?
- How much of Discord channel history should interoperate with web room history?
- Should future non-dialogue text input exist anywhere, or should all product play remain command-only?
- Are unique items truly global, or should some item classes be per-player instances?
- Can autonomous NPCs pick up evolution items, or only request them from humans?
- What is the first evolution reward for Rati, Whiskerwind, and Skull?
- What is the initial `Chat` Orb cost, and do new avatars receive starter Orbs?
- The backend records Box burn and pack open as separate idempotent events; the UX can present them as one guided flow later.
- Which avatar cards are eligible in the first CosyWorld pack catalog?

## Implementation Notes

- Avoid editing unrelated legacy pages while building the room shell.
- Keep old admin/config routes outside the main product entrypoint.
- Use feature flags if needed: `COSYWORLD_V2_ENABLED`, `COSYWORLD_SSE_ENABLED`.
- Add separate flags for branches, items, evolution, and autonomy if rollout needs guardrails.
- Keep the seed content data-driven so world designers can add future locations without editing route code.
- Treat the current generated cottage image as a useful placeholder asset, not a final dependency.
- Keep Orbs off-chain until a specific bridge is designed.
- Keep Box burns and pack reveals idempotent before exposing them to real wallets.
