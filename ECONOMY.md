# CosyWorld Economy And Legacy NFT Migration

## Summary

ADR 0006 accepts a wallet-optional core with one narrow external bridge:
supported avatar NFTs may register or recover one durable autonomous actor.
Wallet ownership does not grant actor control, world items, place access,
progression, rewards, or private media.

- `Orbs`: non-transferable, off-chain game currency held in the v2 account ledger. Their only player spend is community image generation for shared world subjects.
- `Linked avatars`: an optional allowlisted adapter verifies an avatar NFT and binds it idempotently to one canonical actor. The actor is autonomous by default and keeps the same identity and history across custody changes.
- AI provider accounts and server budgets are operational concerns, not a second in-world price for conversation. Chat is public and Orb-free, but is an advancement-backed friendship action rather than an always-available free verb.

Intricately Carved Wooden Boxes, pack reveals, keepsake collections, item/location
NFTs, wallet-gated places, native transferable card ownership, and collection
item materialization have no player or ordinary-runtime surface. Their durable
rows remain read-only replay and operator-audit data; they are not ownership
grants and must not receive new feature work.

## Source Findings

### Legacy CosyWorld

Relevant systems:

- `src/services/item/itemService.mjs` already models world items, ownership, loose location items, soulbound charges, consumable use, and combat heal effects. V2 should migrate the item and item-use concepts, not the Mongo document shape.
- `src/services/quest/questService.mjs` models quest conditions such as `ITEM_AT_LOCATION` and `ITEM_OWNED_BY_AVATAR`. This is the right source material for Orb-earning challenges.
- `src/services/battle/combatEncounterService.mjs` contains D&D-shaped turn/combat mechanics, rate limits, HP/AC/damage, and encounter cleanup. V2 should pull combat rules into the C kernel and award Orbs from committed outcomes.
- `src/services/web/server/routes/claims.js` has an `orbGate` claim policy, but that gate means "hold an Orb NFT collection token." It is not a fungible game-currency ledger and should not be reused as the new Orbs balance.
- `src/services/payment/pricingService.mjs`, `src/services/payment/x402Service.mjs`, and `src/services/payment/marketplaceService.mjs` are external payment rails using USDC/x402 or service marketplace pricing. They should stay outside the in-world Orb economy.
- `src/services/crossmint/crossmintService.mjs` and token routes are useful migration references for inventorying and archiving legacy avatar/item/location NFT issuance; they are not templates for new pack/burn product work.

Migration reading: legacy CosyWorld knows how to make the game objects interesting. It does not yet have the right economy boundary for a shared MMO.

### Ruby High

Relevant systems:

- `../app-ruby-high/src/routes/billing.ts` has Solana pack purchase phases: quote, submit, confirm. It verifies payment and records pack mint idempotently.
- `../app-ruby-high/src/routes/nft.ts` has `sync-packs`, `open-pack`, `mint-card-prepare`, `mint-card-submit`, `burn-prepare`, and `burn-confirm`.
- `../app-ruby-high/src/services/core-pack-nfts.ts` handles Core pack NFTs, pack metadata, owned pack discovery, mint verification, and opened-pack metadata updates.
- `../app-ruby-high/src/services/hall-pass-nfts.ts` handles card mint/burn transaction building, ownership lookup, and burn verification.
- `../app-ruby-high/src/services/ruby-high-service.ts` has the durable account-side mutations: `recordHallPassPackMint`, `openHallPassPack`, `convertBurnedHallPassCardsToHallPasses`, and `cosyWorldWalletCards`.
- `../app-ruby-high/src/viewer-parts/card-burn-selector.ts`, `billing-products.ts`, `pack-mint-progress.ts`, and `account-hall-pass-cards-panel.ts` show the right UX boundary: card pack and burn operations live in an account/card surface, not inside the primary world transcript.

Migration reading: Ruby High's ownership, idempotency, and proof patterns remain
useful for verified avatar custody and legacy receipt audit. CosyWorld does not
recreate pack/burn or broad collection logic in the C kernel.

## Product Model

### Orbs

Orbs are non-transferable off-chain game currency for the first production slice.

Rules:

- A wallet or account has an Orb balance in the v2 Rust ledger.
- The C kernel may emit rule outcomes that cause Orb awards, but it does not own the wallet ledger.
- Orbs are awarded only from committed game events: challenge solved, puzzle solved, encounter resolved, daily room contribution, or world goal contribution.
- Orbs never pay for Chat, Say, Listen/Notice, combat, travel, access, success, progression, resident heartbeats, or any other ordinary world verb.
- An eligible world subject may receive one community-funded image at each level.
- The total pooled price of that image is exactly its level in Orbs: level 1 costs 1, level 2 costs 2, and so on.
- Contributions are journaled per avatar and capped at the remaining pooled price. Once fully funded, retries never take more Orbs.
- The generation prompt includes public history through the funding event, so later-level images can visibly evolve with the card's story.
- Generated media belongs to the shared card, not to the contributor. Paying does not grant ownership, power, access, or editorial authority.
- Failed validation, unavailable providers, duplicate contributions, generation retries, and already-completed levels spend nothing.
- P0 Orbs are not on-chain, not transferable, and not a payment rail. Later bridges can be designed explicitly.

Current v2 implementation:

- `orb_ledger` is append-only and idempotent by committed action/event key.
- Avatar creation and successful challenge/combat/flee rewards are projected into `orb_ledger`; `community_image_generation` is the sole negative ledger reason for new actions.
- Automatic rule rewards are claim-key gated by actor/context, so replaying the same Listen/combat/flee outcome does not mint duplicate Orbs.
- `ai_usage_ledger` records system-funded resident inference and community image jobs as `community_orbs`, with feature, status, source event id, Orb delta, and latency.
- Player OpenRouter keys remain transient. The ledger records payer mode, not secrets.
- The optional linked-avatar feed is server-authenticated and supplies only
  allowlisted avatar custody to gameplay. Legacy Box, pack, and card fields may
  still parse for compatibility/audit but are absent from `/state` and cannot
  grant play.
- Development reset clears projected events, action journal, sessions, wallet links, suspensions, Orb ledger rows, and AI usage rows together.

UI implication:

- `Chat` appears only when banked advancement can begin a friendship with an eligible nearby resident. Its cost is one advancement point, never an Orb.
- Ordinary moderated `Say` remains available without advancement. Other successful scene cards can invite one system-funded resident reply on the room heartbeat.
- Generated avatar, item, and familiar generated-location card modals show the current level's pooled image progress. Contributing uses the existing card surface; it does not add a currency dashboard to the play scene.
- A fully funded or failed job can be nudged/retried without another debit. A completed card says that its next image unlocks at the next level.
- The Orb balance can be visible as compact status text, but it must not turn the MUD into a dashboard.

### Linked Avatar Bridge

Rules:

- Linking a wallet is optional and ordinary play never requires it.
- A protected allowlisted adapter, never browser claims, verifies network,
  collection authority, asset id, current custody, and the authored actor
  profile.
- One verified asset registers or recovers exactly one durable actor and one
  immutable first-link receipt.
- The actor arrives through its authored worldpack threshold when presence
  permits; otherwise it remains offstage.
- The actor is autonomous by default. Wallet custody grants association and
  chronicle visibility, not direct commands or mechanical advantage.
- Transfer, unlink, revocation, or stale ownership changes association only at
  a safe boundary. The actor's identity, Journal, Bonds, advancement, and
  world inventory persist.
- Only reviewed cosmetic appearance fields may refresh. Metadata cannot author
  prompts, personality, mechanics, items, access, rewards, or pack ids.

### Legacy Box And Pack Receipt Archive

The `wooden_box_receipts` and `avatar_pack_openings` tables preserve shipped
history. They may be replayed, reconciled, retained, searched, and resolved by
protected moderation tooling. There is no player burn/open route, Box or pack
projection, collection control, card grant, resident-placement vote, or access
effect. No archive row is merged into current linked-avatar ownership.

### Shared World Item Scarcity

Each authored world-item id is one shard-local object. Resident desires, attachments, evolution requirements, and recipe inputs can deliberately overlap; they are reasons to move and negotiate over the shared object, not separate reservations or promises that every demand can be satisfied at once. Giving, trading, evolution placement, and crafting preserve their input objects, so the same singleton can support several stories in sequence. The browser shows a sought item's authoritative current availability beside the resident's fallible memory, making current contention legible.

Legacy wallet keepsakes never inflate this count and are being archived. The worldpack inspector's `world_item_economy` audit reports only kernel-owned world supply against authored demand.

## Integration Points

### C Kernel

Keep the C kernel deterministic and wallet-blind.

Add only rule-safe concepts:

- Challenge result events.
- Puzzle result events.
- Optional `CW_OFFER_CHALLENGE` and `CW_ACTION_CHALLENGE` once challenges exist.
- Optional world events for `PACK_REVEALED` only if the reveal materially changes world state.

Do not add:

- Wallet addresses.
- NFT mint addresses.
- Solana transactions.
- Ruby High pack metadata.
- Orb balances.
- Payment pricing.

The kernel validates game actions. The Rust orchestrator decides account ledger effects around those actions.

### Rust Orchestrator

Rust is the economy authority for v2.

Add services/modules:

- `economy`: Orb balance, idempotent ledger mutations, spend/award policies.
- `ai_gateway`: player OpenRouter payer verification, AI usage ledger entries, model routing, and media calls.
- `avatar_links`: signed wallet sessions, allowlisted avatar ownership verification, exactly-once actor binding, custody association, and safe offstage policy.
- Legacy receipt archive: read-only Box/pack/materialization replay,
  reconciliation, retention, and protected moderation inspection.
- `challenges`: one-button challenge selection, kernel submission, Orb awards.

Update existing flows:

- `/state` returns compact economy state plus level-scoped `community_art` funding on eligible generated cards. Legacy Chat-cost fields remain zero-valued for client compatibility.
- `/actions/create-bond` is presented as `Chat` and requires avatar session, room access, an eligible nearby resident, turn legality, rate limit, and one advancement point. Legacy `/actions/chat` delegates to that contract. Neither path checks or spends Orbs.
- `/actions/fund-image` validates the session, visible eligible card, current level, remaining pooled cost, and contributor balance, then proves the exact frozen media recipe, provider route, candidate/quarantine/publication storage, verdict store, and vision-review capability before atomically journaling one Orb. Preflight failures return a stable `error_code` and record zero Orb delta.
- Community generation completion/failure is journaled separately; the image asset becomes the card's current art only after the ready event commits.
- `/world` and room state include newly granted avatar cards through the same card projection map.
- `/meta` exposes economy feature flags without secrets.

Avatar-link routes are narrow, protected, and adapter-owned. The ordinary
economy/AI/action routes below remain normal product surface:

```text
GET  /economy
GET  /ai/account
POST /ai/openrouter/verify
POST /ai/openrouter/disconnect
POST /actions/combat
```

### Linked-Avatar Ownership Feed

The v2 adapter consumes a bearer-protected server export of verified,
allowlisted avatar assets and current owner wallets. It does not consume
browser card claims. Box, pack, item, location, pass, and general-card records
are ignored for gameplay even when an older provider shape includes them.

The deployed Ruby High-compatible endpoint is:

```text
/api/apps/ruby-high/nft/internal/cosyworld/wallet-cards
```

Use the `COSYWORLD_AVATAR_OWNERSHIP_FEED_*` configuration names. Older
`COSYWORLD_ENTITLEMENT_FEED_*` and Ruby High aliases remain accepted during
operator migration, but do not change the avatar-only contract.

### SQLite/Event Store

Orb and AI usage tables are active economy state. The Box/pack tables below are
retained historical schema and accept no new player mutations.

Suggested tables:

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
  source_event_id TEXT,
  orb_delta INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  latency_ms INTEGER,
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
  owner_wallet_address TEXT NOT NULL,
  box_asset_address TEXT,
  pack_id TEXT NOT NULL,
  reveal_seed TEXT NOT NULL,
  catalog_hash TEXT NOT NULL,
  card_ids_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);
```

Historical external transaction signatures remain unique. Active mutations are
idempotent by stable action or media-job keys. Do not store raw player
OpenRouter API keys in these tables.

### Browser UX

Keep the MUD first.

Rules:

- The transcript stays the main event.
- No chat composer.
- No permanent economy panel.
- At most three dealt action cards plus shuffle at rest; no system may replace the hand except required onboarding or an urgent safety gate.
- Economy operations appear only when focused through a small card or settings
  affordance.
- If one card needs a target or mode choice, show a temporary action sheet and return to the dealt hand after selection.

Primary command examples:

```text
Create Avatar
Chat
Challenge
Attack
Defend
Flee
Use
Listen
Give Item
Travel
Continue
```

### Avatar Adapter

Do not import another application as the runtime. The adapter reuses only a
bearer-protected custody export and maps allowlisted avatar assets to authored
actor profiles. It performs no burn, mint, pack, location-access, item-supply,
or resident-placement operation.

### Legacy Migration

Migrate concepts, not old runtime coupling:

- From `items`: item types, soulbound charges, location ownership, consumable effects, evolution item instances.
- From `quests`: condition model and daily challenge generation.
- From `combat`: stats, action cooldowns, encounter outcomes, and combat-derived Orb awards.
- From `claims`: wallet signature and collection policy ideas, but not `orbGate` as Orbs.
- From `payment`: external purchase rails remain outside the in-world Orb ledger. They do not sell Boxes, item/location NFTs, access, or progression in the accepted core product.
- From Discord routes: none of the v2 economy should depend on Discord channel objects.

## Migration Plan

### Stage 0: Schema And Fixtures

- Add this economy doc to the v2 contract.
- Keep Orb seed fixtures. Legacy Box/avatar-pack fixtures remain only until
  #682/#685 replace them with linked-avatar and archival-migration coverage.

### Stage 1: Orbs Ledger

Current status: implemented for the MVP text loop.

- Added the `orb_ledger` table.
- Returned Orb balance from `/state`.
- Returned whether the current room's `Listen` reward is still claimable from `/state`.
- New avatars receive a starter grant.
- Listen/combat/flee outcomes can award Orbs from committed events.
- Added claim keys for automatic rule rewards so repeated identical actor/context outcomes are idempotent.
- `Chat`, resident heartbeats, and repeat `Listen` spend no Orbs; Chat spends one advancement point.
- Eligible generated cards pool exactly one Orb per contribution until the level-sized image price is met.
- Tests cover image-only Orb spends, level-sized pooled funding, advancement-backed Chat, free Listen, heartbeat coalescing, ledger projection, reward claim idempotency, and reset cleanup.

### Stage 2: AI Payer Separation

Current status: Chat is advancement-backed and Orb-free; the delayed resident reply is system-funded. The browser no longer exposes player-key setup in the normal play surface. AI usage remains non-secret and auditable. Any future player-provider connection must not reintroduce an Orb gate for ordinary verbs.

### Stage 3: Combat Challenge Loop

- Convert Ruby High quiz inspiration into non-typed combat/world encounters.
- Use `Attack`, `Defend`, `Flee`, and `Use` instead of `A/B/C/D`.
- Use one primary command plus a compact focus rail; at most use temporary action sheets for target/item choice.
- Award Orbs from committed combat/challenge outcomes.
- Keep challenge content tied to location, resident, item, and stat context.
Current status: partially implemented in the Moonlit Trail sparring loop. The remaining work is richer encounter lifecycle and balancing.

### Stage 4: Legacy Archival And Removal

Current status: player/runtime removal landed; historical audit retained.

- Box burn, pack open, collection materialization, and unmaterialization routes
  are absent.
- Ordinary state and browser/terminal surfaces expose no Box, pack, owned-card,
  wallet-pass, kept-close, or materialization controls.
- Startup and refresh may compare protected provider snapshots with historical
  rows and append `economy_reconciliation_runs`; historical rows are never
  promoted into current ownership.
- Protected moderators can inspect and resolve reconciliation anomalies.
- Existing materialized-item migration receipts remain replayable and
  auditable without accepting new item-materialization mutations.
- Retention and alerting cover duplicate signatures, contradictory historical
  ownership, and unreadable receipts; no collection product is rebuilt around
  the archive.

## Invariants

- The Cosy Cottage remains public.
- Wallet ownership never unlocks, owns, or controls a shared room, item, action, reward, or resident.
- Human players do not type chat.
- AI speech is one-to-many through room events.
- Orbs are spent only for committed community image generation.
- Automatic Orb rewards are claim-gated by stable actor/context keys.
- Player OpenRouter payment changes payer only, never room visibility.
- New Box burns and pack reveals have no player route.
- Historical Box/pack receipts remain idempotent, replayable, and auditable through migration.
- One supported avatar asset maps to one actor; retries, restarts, wallets, and custody transfers cannot clone it.
- The C kernel never parses wallet data.
