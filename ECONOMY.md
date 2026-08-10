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
item materialization are legacy compatibility surfaces scheduled for replay-safe
removal under #682 and #685. Their implementation detail remains below as
migration and audit inventory; it is not product direction and must not receive
new feature work.

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
- Legacy ownership feeds can still include active Wooden Boxes and unopened avatar packs while #682 migrates them; `/state` must never trust client query parameters and the default target removes those projections.
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

### Intricately Carved Wooden Boxes — Legacy Compatibility

Boxes are shipped legacy NFTs. Freeze new product work; preserve their receipts
for audit and remove the player/runtime surface through #682.

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

### Avatar Cards From Packs — Legacy Compatibility

Avatar cards are collectible and world-influencing, but they do not create private NPC copies.

Rules:

- A card for Rati, Whiskerwind, Skull, or future residents contributes to global placement voting when paired with location cards in the same wallet.
- Resident actors remain single global world actors. Two wallets holding Rati do not create two Ratis.
- Avatar cards can unlock cosmetics, relationship affordances, evolution hints, or placement influence.
- Location cards unlock entry to the shared location channel.
- Item cards can seed item availability or crafting/evolution opportunities, but item instances used in the kernel remain explicit world objects.

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
- Legacy `wallet_assets` and `packs`: freeze and archive Box/card/location projections, burn/open flows, and receipts under #682/#685.
- `challenges`: one-button challenge selection, kernel submission, Orb awards.

Update existing flows:

- `/state` returns compact economy state plus level-scoped `community_art` funding on eligible generated cards. Legacy Chat-cost fields remain zero-valued for client compatibility.
- `/actions/create-bond` is presented as `Chat` and requires avatar session, room access, an eligible nearby resident, turn legality, rate limit, and one advancement point. Legacy `/actions/chat` delegates to that contract. Neither path checks or spends Orbs.
- `/actions/fund-image` validates the session, visible eligible card, current level, remaining pooled cost, and contributor balance, then proves the exact frozen media recipe, provider route, candidate/quarantine/publication storage, verdict store, and vision-review capability before atomically journaling one Orb. Preflight failures return a stable `error_code` and record zero Orb delta.
- Community generation completion/failure is journaled separately; the image asset becomes the card's current art only after the ready event commits.
- `/world` and room state include newly granted avatar cards through the same card projection map.
- `/meta` exposes economy feature flags without secrets.

Avatar-link routes should be narrow, protected, and adapter-owned. The ordinary
economy/AI/action routes below remain normal product surface; the `/nft/*`
routes are existing legacy compatibility endpoints scheduled for removal:

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

### Ownership Feed — Legacy Inventory And Target Adapter

The current v2 `OwnershipIndex` consumes Ruby High-style wallet card exports.
Do not extend its Box, item, location, pass, or general-card roles. #682 reduces
the protected feed to allowlisted avatar discovery/custody and read-only legacy
audit data.

Legacy fields to inventory and remove from live projection:

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

The remaining stages document shipped legacy behavior so migration can preserve
audit history and avoid duplicate/lost world entities. They are not future
delivery stages.

### Stage 4: Box Ownership Projection — Shipped Legacy

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

### Stage 5: Box Burn And Pack Creation — Shipped Legacy

Current status: implemented as a signed-wallet route flow with production transaction construction and confirm-side chain verification.

- Added `/nft/boxes/burn-prepare` and `/nft/boxes/burn-confirm`.
- Requires a signed wallet session and trusted active Box ownership.
- Local mode can record staging receipts for fast development.
- Production mode requires `COSYWORLD_BOX_BURN_SOLANA_RPC_URL` and `COSYWORLD_BOX_CORE_COLLECTION_ADDRESS`; `burn-confirm` verifies a confirmed Metaplex Core burn transaction for the Box asset, connected owner, and configured collection before recording the receipt.
- Records the burn receipt idempotently by Box asset and burn signature.
- Creates an unopened avatar pack receipt and projects it back into wallet access.
- With a configured production verifier, `burn-prepare` fetches a confirmed recent blockhash and
  returns an unsigned legacy Solana transaction containing the owner-paid Metaplex Core BurnV1
  instruction for the trusted Box and configured collection. It includes full base64 wire bytes
  for adapters and a base58 compiled message for injected wallet providers.
- The browser shows an irreversible-action confirmation, asks the wallet to sign and send that
  transaction, then submits its chain signature to `burn-confirm`.
- Confirmed receipts reconcile back into ownership through the durable receipt store. Successful
  external snapshots are also compared with those receipts before merge; protected moderator
  resolution notes persist the operator disposition of reported contradictions.

### Stage 6: Pack Reveal And Card Grants — Shipped Legacy

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

### Stage 7: Legacy Archival And Removal

- Keep the existing verifier and reconciliation path fail-closed while new Box
  burns and pack opens are disabled.
- Active Boxes and unopened packs already follow each successful trusted snapshot, so transfers,
  external burns, and externally opened packs disappear from the effective base index on refresh.
- Successful startup and refresh snapshots are now compared with durable local burn/opening
  receipts before receipt grants are merged. Each comparison is appended to
  `economy_reconciliation_runs`; impossible active-after-burn/open states and duplicate external
  owners are retained as structured anomalies in the protected `/moderation/economy` audit.
- Protected moderators can resolve open anomaly runs with an identity and note through the API or
  economy panel in `/moderation`; clear runs are non-actionable and repeated resolution is
  idempotent.
- Preserve support-facing search and an explicit retention policy for archived
  receipts; do not build new collection product surface.
- Add alerting for duplicate signatures, impossible balances, and failed pack reveals.

## Invariants

- The Cosy Cottage remains public.
- Wallet ownership never unlocks, owns, or controls a shared room, item, action, reward, or resident.
- Human players do not type chat.
- AI speech is one-to-many through room events.
- Orbs are spent only for committed community image generation.
- Automatic Orb rewards are claim-gated by stable actor/context keys.
- Player OpenRouter payment changes payer only, never room visibility.
- New Box burns and pack reveals are disabled before legacy receipt conversion begins.
- Historical Box/pack receipts remain idempotent, replayable, and auditable through migration.
- One supported avatar asset maps to one actor; retries, restarts, wallets, and custody transfers cannot clone it.
- The C kernel never parses wallet data.
