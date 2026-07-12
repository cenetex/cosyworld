# CosyWorld 2.0 Economy And NFT Integration

## Summary

CosyWorld should use two currency-like resources with different trust models:

- `Orbs`: fungible, off-chain game currency held in the v2 account ledger. Orbs are earned by solving challenges, completing puzzles, winning small encounters, or advancing world goals. Server-paid Chat spends Orbs because `Chat` consumes shared AI/world attention.
- `Intricately Carved Wooden Boxes`: wallet-owned NFTs. A Box is an irreversible burn voucher. Burning one creates an avatar card pack in the Ruby High card-pack style; opening that pack reveals avatar cards from the CosyWorld/Ruby High world catalog.
- Player OpenRouter connection: an alternate AI payer. A connected player OpenRouter account makes explicit player-initiated Chat/media cost zero Orbs inside CosyWorld, while the resulting output remains a public shared-world event.

This is deliberately not one generic wallet balance. Orbs are MMO play energy. Boxes are on-chain collectible inventory. Avatar cards, item cards, and location cards remain shared-world inputs, not private instances.

## Source Findings

### Legacy CosyWorld

Relevant systems:

- `src/services/item/itemService.mjs` already models world items, ownership, loose location items, soulbound charges, consumable use, and combat heal effects. V2 should migrate the item and item-use concepts, not the Mongo document shape.
- `src/services/quest/questService.mjs` models quest conditions such as `ITEM_AT_LOCATION` and `ITEM_OWNED_BY_AVATAR`. This is the right source material for Orb-earning challenges.
- `src/services/battle/combatEncounterService.mjs` contains D&D-shaped turn/combat mechanics, rate limits, HP/AC/damage, and encounter cleanup. V2 should pull combat rules into the C kernel and award Orbs from committed outcomes.
- `src/services/web/server/routes/claims.js` has an `orbGate` claim policy, but that gate means "hold an Orb NFT collection token." It is not a fungible game-currency ledger and should not be reused as the new Orbs balance.
- `src/services/payment/pricingService.mjs`, `src/services/payment/x402Service.mjs`, and `src/services/payment/marketplaceService.mjs` are external payment rails using USDC/x402 or service marketplace pricing. They should stay outside the in-world Orb economy.
- `src/services/crossmint/crossmintService.mjs` and token routes are useful migration references for legacy avatar/item/location NFT issuance, but the v2 pack and burn path should follow Ruby High's Solana/Core pattern.

Migration reading: legacy CosyWorld knows how to make the game objects interesting. It does not yet have the right economy boundary for a shared MMO.

### Ruby High

Relevant systems:

- `../app-ruby-high/src/routes/billing.ts` has Solana pack purchase phases: quote, submit, confirm. It verifies payment and records pack mint idempotently.
- `../app-ruby-high/src/routes/nft.ts` has `sync-packs`, `open-pack`, `mint-card-prepare`, `mint-card-submit`, `burn-prepare`, and `burn-confirm`.
- `../app-ruby-high/src/services/core-pack-nfts.ts` handles Core pack NFTs, pack metadata, owned pack discovery, mint verification, and opened-pack metadata updates.
- `../app-ruby-high/src/services/hall-pass-nfts.ts` handles card mint/burn transaction building, ownership lookup, and burn verification.
- `../app-ruby-high/src/services/ruby-high-service.ts` has the durable account-side mutations: `recordHallPassPackMint`, `openHallPassPack`, `convertBurnedHallPassCardsToHallPasses`, and `cosyWorldWalletCards`.
- `../app-ruby-high/src/viewer-parts/card-burn-selector.ts`, `billing-products.ts`, `pack-mint-progress.ts`, and `account-hall-pass-cards-panel.ts` show the right UX boundary: card pack and burn operations live in an account/card surface, not inside the primary world transcript.

Migration reading: Ruby High already has the pack, burn, ownership, idempotency, and proof patterns. CosyWorld should consume or adapt those patterns, not recreate them in the C kernel.

## Product Model

### Orbs

Orbs are non-transferable off-chain game currency for the first production slice.

Rules:

- A wallet or account has an Orb balance in the v2 Rust ledger.
- The C kernel may emit rule outcomes that cause Orb awards, but it does not own the wallet ledger.
- Orbs are awarded only from committed game events: challenge solved, puzzle solved, encounter resolved, daily room contribution, or world goal contribution.
- Server-paid Chat costs Orbs. The server can render `Chat` only when the avatar is allowed to speak and the account has either a verified player OpenRouter payer or enough Orbs.
- Player OpenRouter-paid Chat spends zero Orbs, but still records AI usage and commits public room events.
- The player's OpenRouter payer covers only the explicit action they initiated, normally the player-avatar line plus the immediate resident reply.
- The player's OpenRouter payer is not used for ambient resident beats, autonomous swarm jobs, admin content generation, or other players' later actions.
- Failed validation does not spend Orbs.
- A successful server-paid inferred avatar line spends Orbs after it commits. Failed or unavailable inference emits no substitute speech and spends nothing.
- If AI fails before any shared avatar line is committed, the spend is rolled back or never committed.
- P0 Orbs are not on-chain, not transferable, and not a payment rail. Later bridges can be designed explicitly.

Current v2 implementation:

- `orb_ledger` is append-only and idempotent by committed action/event key.
- Avatar creation, successful challenge/combat rewards, flee rewards, and server-paid Chat spends are projected into `orb_ledger`.
- Automatic rule rewards are claim-key gated by actor/context, so replaying the same Listen/combat/flee outcome does not mint duplicate Orbs.
- `ai_usage_ledger` records player-avatar Chat usage with feature, payer mode, provider, model, status, source event id, Orb delta, and latency.
- Player OpenRouter keys remain transient. The ledger records payer mode, not secrets.
- Trusted ownership feeds can include active Wooden Boxes and unopened avatar packs; `/state` exposes compact counts and asset ids without trusting client query params.
- Development reset clears projected events, action journal, sessions, wallet links, suspensions, Orb ledger rows, and AI usage rows together.

UI implication:

- The normal room button remains `Chat`.
- When the player has no Orbs, the primary command becomes a world-appropriate earning action such as `Listen`, `Challenge`, `Practice`, or `Notice`, not a shop button.
- If a zero-Orb room exposes a still-claimable `Listen` reward, the one-button browser shell prefers `Listen` and hides the `Connect AI` fallback from the command rail.
- Once that actor/location Listen reward claim is spent, the shell stops presenting `Listen` as a recovery command and can fall back to `Connect AI` until another real earning action is available.
- When the player has a verified OpenRouter payer, `Chat` stays available even at zero Orbs.
- When the player has neither OpenRouter payer nor enough Orbs, the primary command should route toward earning Orbs through `Challenge`, `Spar`, `Listen`, `Practice`, or `Notice`.
- The Orb balance can be visible as compact status text, but it must not turn the MUD into a dashboard.

### Intricately Carved Wooden Boxes

Boxes are NFTs and should be treated as scarce wallet assets.

Rules:

- A Box is discovered from the wallet ownership feed, not trusted from client query params.
- A Box can be focused in an account/inventory surface.
- The action is `Open Box` or `Burn Box`, depending on the final copy. The backend semantics are burn-first.
- Burning a Box requires wallet signature, on-chain verification, and an idempotent burn receipt.
- A burn creates an avatar card pack receipt. The pack can be immediately opened by the same UX flow, but the backend should keep pack creation and pack reveal as separate events.
- Opening the pack reveals avatar cards from the world catalog with provenance: catalog hash, reveal seed, box asset, burn signature, card ids, and timestamps.
- Duplicate burn confirmations are harmless and return the previous result.
- Burned Boxes never re-enter the active ownership index.

UI implication:

- Box operations are account/inventory moments, not normal room chat controls.
- The main transcript can show a compact room event after a pack reveal, for example: `[System] Lantern Stitch opened a Wooden Box. Three avatar cards joined the world archive.`
- The one-button room rule still holds. If the player focuses a Box, the one contextual button can become `Open Box`; otherwise it remains world play.

### Avatar Cards From Packs

Avatar cards are collectible and world-influencing, but they do not create private NPC copies.

Rules:

- A card for Rati, Whiskerwind, Skull, or future residents contributes to global placement voting when paired with location cards in the same wallet.
- Resident actors remain single global world actors. Two wallets holding Rati do not create two Ratis.
- Avatar cards can unlock cosmetics, relationship affordances, evolution hints, or placement influence.
- Location cards unlock entry to the shared location channel.
- Item cards can seed item availability or crafting/evolution opportunities, but item instances used in the kernel remain explicit world objects.

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
- `wallet_assets`: signed wallet sessions, ownership feed hydration, Box/card/location projections.
- `packs`: Box burn prepare/confirm, pack creation, pack open/reveal, card grants.
- `challenges`: one-button challenge selection, kernel submission, Orb awards.

Update existing flows:

- `/state` returns compact economy state: Orb balance, Box count, unopened pack count, whether `Chat` is affordable, and whether Chat will spend Orbs.
- `/state` returns compact AI payer state: OpenRouter connection state, verified label or limit metadata, and current server-paid Chat cost.
- `/actions/chat` requires avatar session, room access, target validity, rate limit, and either verified OpenRouter payer or Orb affordability before generating a line.
- `/actions/chat` records AI usage for both payer modes.
- `/actions/chat` records the Orb spend and the committed message under one idempotency key only for server-paid Chat.
- `/world` and room state include newly granted avatar cards through the same card projection map.
- `/meta` exposes economy feature flags without secrets.

Recommended new routes:

```text
GET  /economy
GET  /ai/account
POST /ai/openrouter/verify
POST /ai/openrouter/disconnect
POST /actions/combat
POST /nft/boxes/burn-prepare
POST /nft/boxes/burn-confirm
POST /nft/packs/open
```

The route names can change, but the phases should not collapse into an unaudited one-shot mutation.

### Ownership Feed

The current v2 `OwnershipIndex` already consumes Ruby High-style wallet card exports. Extend the feed contract rather than adding a second source of truth.

Needed additions:

- `boxes`: active Box NFTs by wallet with asset address, metadata URI, serial, collection, and status.
- `packs`: unopened/opened avatar packs by wallet with asset address or receipt id.
- `card_status`: active, redeemed, burned, opened, revoked.
- `roles`: avatar, location, item, special, box, pack.
- `source`: Ruby High, CosyWorld seed, CosyWorld chain collection.

Existing Ruby High export endpoint to build from:

```text
/api/apps/ruby-high/nft/internal/cosyworld/wallet-cards
```

The feed should remain bearer-protected in production. The client never supplies authoritative ownership.

### SQLite/Event Store

Add append-only tables before adding gameplay that spends or burns assets.

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

All external transaction signatures should be unique where applicable. Every mutation should be idempotent by a stable key derived from the signed transaction, chat action, media job, or pack id. Do not store raw player OpenRouter API keys in these tables.

### Browser UX

Keep the MUD first.

Rules:

- The transcript stays the main event.
- No chat composer.
- No permanent economy panel.
- At most three dealt action cards plus shuffle at rest; no system may replace the hand except required onboarding or an urgent safety gate.
- Economy/account operations appear only when focused through a small account/card/inventory affordance.
- The account surface can borrow Ruby High's card selector and pack progress patterns, but should be visually tuned to CosyWorld's terminal MUD shell.
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
Open Box
Continue
```

### Ruby High Adapter

Do not import Ruby High as the runtime. Build an adapter around its proven mechanics:

- Reuse ownership export shape and bearer-protected remote hydration.
- Reuse Solana prepare/submit/confirm phasing.
- Reuse Core pack metadata/update patterns for unopened/opened pack art.
- Reuse Hall Pass card burn verification patterns for Box burn verification.
- Reuse pack reveal provenance concepts: catalog hash, commitment, seed, proof.
- Reuse account/card UI patterns only in account surfaces, not the room transcript.

CosyWorld-specific changes:

- Burn object is a Wooden Box NFT, not a Ruby High Hall Pass card.
- Burn output is an avatar card pack, not Hall Passes.
- Pack card catalog is the CosyWorld world catalog, including Ruby High-sourced characters where appropriate.
- Revealed cards feed back into shared resident placement and access projections.

### Legacy Migration

Migrate concepts, not old runtime coupling:

- From `items`: item types, soulbound charges, location ownership, consumable effects, evolution item instances.
- From `quests`: condition model and daily challenge generation.
- From `combat`: stats, action cooldowns, encounter outcomes, and combat-derived Orb awards.
- From `claims`: wallet signature and collection policy ideas, but not `orbGate` as Orbs.
- From `payment`: external purchase rails only. USDC/x402 can later sell Boxes or premium bundles, but it must not be the in-world Orb ledger.
- From Discord routes: none of the v2 economy should depend on Discord channel objects.

## Migration Plan

### Stage 0: Schema And Fixtures

- Add this economy doc to the v2 contract.
- Add seed fixture entries for Orbs, Boxes, and avatar packs.
- Extend smoke-owned wallet fixtures with one active Box.

### Stage 1: Orbs Ledger

Current status: implemented for the MVP text loop.

- Added the `orb_ledger` table.
- Returned Orb balance from `/state`.
- Returned whether the current room's `Listen` reward is still claimable from `/state`.
- New avatars receive a starter grant.
- Listen/combat/flee outcomes can award Orbs from committed events.
- Added claim keys for automatic rule rewards so repeated identical actor/context outcomes are idempotent.
- Server-paid `Chat` spends one Orb only after the avatar line commits.
- The one-button browser shell routes zero-Orb players toward in-world earning actions before AI setup, but only while the focused action can still produce a reward claim.
- Tests cover committed spends, ledger projection, reward claim idempotency, zero-Orb earning-action UX, and reset cleanup.

### Stage 2: OpenRouter Player Payer

Current status: implemented as a browser-held key MVP.

- Added OpenRouter key connection state in the browser.
- Verified player keys with OpenRouter's `/api/v1/key`.
- Recorded AI usage without storing raw player keys in SQLite.
- Allowed verified player-paid `Chat` with zero Orb spend.
- Kept autonomous ambient and swarm work on the server budget.
- Still missing: PKCE/vaulted cross-device account link.

### Stage 3: Combat Challenge Loop

- Convert Ruby High quiz inspiration into non-typed combat/world encounters.
- Use `Attack`, `Defend`, `Flee`, and `Use` instead of `A/B/C/D`.
- Use one primary command plus a compact focus rail; at most use temporary action sheets for target/item choice.
- Award Orbs from committed combat/challenge outcomes.
- Keep challenge content tied to location, resident, item, and stat context.
Current status: partially implemented in the Moonlit Trail sparring loop. The remaining work is richer encounter lifecycle and balancing.

### Stage 4: Box Ownership Projection

Current status: implemented for trusted feed projection.

- Extended the Ruby High/CosyWorld ownership feed parser to include active Boxes and unopened packs.
- Returned Box and unopened pack counts from `/state`.
- Returned exact trusted Box/pack asset ids in the access payload.
- Added a minimal top-economy account focus in the browser shell; normal room play remains transcript plus one contextual command.
- Added a compact terminal account panel for active Boxes, unopened packs, recent burn receipts, and recent pack reveals.
- Current account surfaces show active Boxes, unopened packs, recent burn
  receipts, recent pack reveals, and open actions without polluting the room
  transcript. Support-grade provenance inspection can build on the same durable
  receipt/opening rows.

### Stage 5: Box Burn And Pack Creation

Current status: implemented as a signed-wallet route flow, with production confirm-side chain verification.

- Added `/nft/boxes/burn-prepare` and `/nft/boxes/burn-confirm`.
- Requires a signed wallet session and trusted active Box ownership.
- Local mode can record staging receipts for fast development.
- Production mode requires `COSYWORLD_BOX_BURN_SOLANA_RPC_URL` and `COSYWORLD_BOX_CORE_COLLECTION_ADDRESS`; `burn-confirm` verifies a confirmed Metaplex Core burn transaction for the Box asset, connected owner, and configured collection before recording the receipt.
- Records the burn receipt idempotently by Box asset and burn signature.
- Creates an unopened avatar pack receipt and projects it back into wallet access.
- `burn-prepare` is intentionally the server challenge/eligibility boundary;
  wallet-specific transaction construction belongs in the client/wallet adapter.
  Confirmed receipts reconcile back into ownership through the durable receipt
  store. External import/reconciliation beyond locally recorded receipts remains
  a production operations workflow.

### Stage 6: Pack Reveal And Card Grants

Current status: implemented as deterministic local reveal provenance.

- Added `/nft/packs/open`.
- Opens packs with deterministic provenance: catalog hash, reveal seed, Box asset, pack id, and card ids.
- Grants avatar cards into the ownership/card index.
- Merges durable Box/pack receipts back into ownership refreshes so locally opened packs remain effective after wallet-feed polling.
- Projects recent wallet-scoped pack reveals into the focused account panel.
- Duplicate opens return the same card ids.
- The focused account/card panel is live for packs, reveals, and recent
  provenance. Transcript polish and production pack catalog policy are tracked
  as content/operations follow-up, not blockers for the signed-wallet route
  contract.

### Stage 7: Production Chain Hardening

- Run staging against the actual Ruby High protected export.
- Add reconciliation for Boxes moved between wallets, burned externally, or opened elsewhere.
- Extend the protected `/moderation/economy` audit into richer operator workflows for review, reconciliation, and support.
- Add alerting for duplicate signatures, impossible balances, and failed pack reveals.

## Invariants

- The Cosy Cottage remains public.
- NFT ownership unlocks shared rooms and influences shared residents; it does not create private rooms.
- Human players do not type chat.
- AI speech is one-to-many through room events.
- Orbs are spent only for committed server-paid world participation.
- Automatic Orb rewards are claim-gated by stable actor/context keys.
- Player OpenRouter payment changes payer only, never room visibility.
- Boxes are burned only through verified irreversible wallet actions.
- Production Box burn receipts must come from verified Solana/Core burn confirmations, not the local staging trust path.
- Every burn, pack, and Orb mutation is idempotent and replayable.
- The C kernel never parses wallet data.
