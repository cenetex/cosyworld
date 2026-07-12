# V2 Data Layer: Stores, Use Cases, and Dual Backends

This document proposes a V2 persistence architecture for CosyWorld. The goal is to stop treating the current MongoDB collections as the application model and instead define durable store contracts around product use cases. SQLite and MongoDB are the first implementations of those contracts.

## Goals

- Make local and Fly deployments self-contained with SQLite and local media storage.
- Keep MongoDB support during migration and for installations that prefer document storage.
- Move persistence behavior out of routes and feature services.
- Make data ownership clear by domain.
- Support incremental migration without a big-bang rewrite.
- Preserve public API behavior while improving internal data shape.
- Make backups simple: one SQLite file plus the media directory for the self-contained backend.

## Non-Goals

- Build a generic MongoDB API adapter on top of SQLite.
- Preserve every current collection shape.
- Rewrite every feature before the V2 layer proves itself.
- Force all flexible game/story payloads into fully normalized SQL tables.
- Remove MongoDB immediately.

## Current Pain Points

The current codebase reaches directly into MongoDB from many feature areas:

- Roughly 650 `collection()` calls across routes and services.
- MongoDB `ObjectId` handling appears throughout application code.
- Business logic is sometimes embedded in MongoDB update operators and aggregation pipelines.
- Collections mix operational state, domain state, provider auth, and reporting data.
- Index creation happens opportunistically at app boot.
- The app cannot easily run as a small, self-contained binary plus data directory because MongoDB is part of the runtime.

V2 should make persistence an implementation detail. Feature code should ask stores for use-case operations instead of composing database queries.

## Design Principles

### Store Contracts Are Product-Level

Stores expose methods named after application needs:

```js
await identityStore.findUserByWallet(address);
await configStore.markSetupComplete({ adminWallet });
await worldStore.getAvatarById(avatarId);
await memoryStore.recordMessage(message);
await socialStore.getActiveProviderAuth({ avatarId, provider: 'x' });
```

Feature code should not call:

```js
db.collection('avatars').findOne({ _id: new ObjectId(id) });
```

### Backend Implementations Are Replaceable

Each store has at least two implementations:

- SQLite implementation for self-contained deployments.
- MongoDB implementation for compatibility and migration.

Callers depend on store contracts, not database clients.

### SQL Where It Helps, JSON Where It Helps

SQLite should use relational tables for identity, ownership, uniqueness, queues, timestamps, and common lookups. It should use JSON columns for flexible story/game/provider payloads that change often.

This avoids both extremes: recreating a document database badly in SQL, or over-normalizing narrative state that benefits from document-like flexibility.

### IDs Are Application IDs

V2 IDs should be strings owned by the app, not database-native `ObjectId` values. For compatibility, generated IDs can remain 24-character hex strings where existing URLs and clients expect them.

Rules:

- Store interfaces accept and return string IDs.
- Backend-specific IDs do not leak into feature code.
- Importers normalize MongoDB `_id` values to strings.
- New V2 records are created through an `idService` or store-local ID helper.

### Migrations Are Explicit

SQLite schema changes are versioned migrations. MongoDB indexes remain backend implementation details. App startup should ensure the selected backend is compatible with the expected schema version.

## Architecture

```text
Routes / Feature Services
        |
        v
Domain Stores
        |
        v
Storage Backend Registry
        |
        +-- SQLite Store Implementations
        |
        +-- MongoDB Store Implementations
```

Proposed modules:

```text
src/data/
  stores/
    identityStore.mjs
    configStore.mjs
    worldStore.mjs
    memoryStore.mjs
    socialStore.mjs
    combatStore.mjs
    paymentStore.mjs
    jobStore.mjs
  sqlite/
    sqliteConnection.mjs
    migrations/
    sqliteIdentityStore.mjs
    sqliteConfigStore.mjs
    ...
  mongo/
    mongoIdentityStore.mjs
    mongoConfigStore.mjs
    ...
  dataLayer.mjs
```

`dataLayer.mjs` resolves the configured backend and exposes the store instances.

```js
export class DataLayer {
  constructor({ backend, stores }) {
    this.backend = backend;
    this.identity = stores.identity;
    this.config = stores.config;
    this.world = stores.world;
    this.memory = stores.memory;
    this.social = stores.social;
    this.combat = stores.combat;
    this.payment = stores.payment;
    this.jobs = stores.jobs;
  }
}
```

Configuration:

```env
DATA_BACKEND=sqlite
SQLITE_DB_PATH=/data/cosyworld.sqlite
MONGO_URI=mongodb://127.0.0.1:27017
MONGO_DB_NAME=cosyworld8
```

## Store Boundaries

### IdentityStore

Owns users, admins, wallets, sessions, signed challenges, provider identities, OAuth state, and encrypted provider credentials.

Current identity/auth state is spread across `users`, `wallet_nonces`, `discord_wallet_links`, `wallet_link_codes`, `wallet_link_audit`, `x_auth`, `x_auth_temp`, `telegram_auth`, and parts of `avatar_claims`. V2 should normalize these into account-oriented records instead of continuing to use wallet addresses and avatar IDs as the primary auth model.

Use cases:

- Create or find a user by wallet.
- Check whether a user is an admin.
- Promote or demote admin users.
- Create, verify, and consume signed wallet challenges.
- Issue and revoke application sessions.
- Link Discord identities to users.
- Link wallets to users.
- Start and complete OAuth flows for X, Telegram, and future providers.
- Store encrypted provider credentials without exposing provider-specific token fields to feature code.
- Resolve credentials by owner: global app, user, avatar, or guild.

Initial data:

- `users`
- `wallet_nonces`
- `discord_wallet_links`
- `wallet_link_codes`
- `wallet_link_audit`
- `x_auth`
- `x_auth_temp`
- `telegram_auth`
- admin wallet from setup/config

Example contract:

```js
class IdentityStore {
  async findUserById(userId) {}
  async findUserByWallet(address) {}
  async upsertWalletUser({ address, chain, displayAddress }) {}
  async setAdminStatus({ userId, isAdmin }) {}
  async createWalletChallenge({ address, chain, purpose, subject, expiresAt }) {}
  async consumeWalletChallenge({ challengeId, address, signature }) {}
  async createSession({ userId, expiresAt, metadata }) {}
  async getSession(sessionId) {}
  async revokeSession(sessionId) {}
  async linkExternalIdentity({ userId, provider, providerUserId, profile }) {}
  async createOAuthState({ provider, owner, codeVerifier, state, scopes, expiresAt }) {}
  async consumeOAuthState({ provider, state }) {}
  async saveProviderCredential({ provider, owner, credential, profile, expiresAt }) {}
  async getProviderCredential({ provider, owner }) {}
  async deleteProviderCredential({ provider, owner }) {}
}
```

#### Identity/Auth V2 Model

The clean model separates these concepts:

- **User**: an app account. A user can have many wallets and external identities.
- **Passkey**: a WebAuthn public-key credential used for ordinary account sign-in. A user can register multiple passkeys for device loss and recovery.
- **Wallet**: a blockchain address on a chain. Address comparison uses a normalized address, but display preserves original casing/format.
- **External identity**: Discord, X, Telegram, or another provider account identity.
- **Session**: a revocable app login session. Cookies should carry a session ID, not a wallet-address-as-user.
- **Challenge**: a short-lived, single-use signing challenge for login, wallet linking, or avatar claim authorization.
- **OAuth state**: a short-lived, single-use provider OAuth state/code-verifier record.
- **Provider credential**: encrypted provider tokens/secrets owned by a `user`, `avatar`, `guild`, or `global` owner.
- **Avatar claim**: world ownership state. Claims belong in `WorldStore`, but reference a normalized wallet/user identity from `IdentityStore`.

Do not preserve these V1 patterns:

- `users.walletAddress` as the only user identity.
- `x_auth.avatarId` as both OAuth owner and wallet authorization record.
- `x_auth.global = true` as a global account selector.
- `x_auth_temp` as provider-specific OAuth state.
- `discord_wallet_links` as a separate identity model.
- `wallet_nonces` with one mutable nonce per address.
- Cookies that trust stale `isAdmin` claims for the full cookie lifetime without a revocable session row.
- Avatar claims that store only raw `walletAddress` with no normalized wallet reference.

Recommended ownership shape:

```js
const owner = {
  kind: 'global' | 'user' | 'avatar' | 'guild',
  id: 'global' // or userId/avatarId/guildId
};
```

For example:

- Global X posting account: `{ kind: 'global', id: 'global' }`
- Avatar X account: `{ kind: 'avatar', id: avatarId }`
- Guild Telegram bot: `{ kind: 'guild', id: guildId }`
- User-linked Discord identity: `{ kind: 'user', id: userId }`

This replaces special flags and fallback queries with explicit ownership.

### ConfigStore

Owns setup state, runtime settings, encrypted secrets metadata, and guild/global configuration.

Use cases:

- Determine whether setup is complete.
- Persist admin setup.
- Store and retrieve global settings.
- Store and retrieve guild settings.
- Track whether required config items are present.

Initial data:

- `system_setup`
- `settings`
- `global_settings`
- `guild_configs`
- `secrets`

Example contract:

```js
class ConfigStore {
  async getSetupStatus() {}
  async markSetupComplete({ adminWallet, completedAt }) {}
  async resetSetup() {}
  async getSetting(key) {}
  async setSetting(key, value) {}
  async getGuildConfig(guildId) {}
  async saveGuildConfig(guildId, patch) {}
}
```

### WorldStore

Owns durable world entities and ownership.

Use cases:

- Create and update avatars.
- Fetch avatars by ID, name, owner, channel, collection, or provider metadata.
- Manage locations and channel-to-location mapping.
- Manage items and item ownership.
- Manage avatar claims.
- Read and update dungeon stats.

Initial data:

- `avatars`
- `locations`
- `items`
- `avatar_claims`
- `dungeon_stats`
- `collection_configs`

Example contract:

```js
class WorldStore {
  async getAvatarById(id) {}
  async findAvatars(query, page) {}
  async saveAvatar(avatar) {}
  async patchAvatar(id, patch) {}
  async claimAvatar({ avatarId, walletAddress, chain }) {}
  async getLocationByChannel(channelId) {}
  async saveLocation(location) {}
  async listItemsForAvatar(avatarId) {}
  async moveItem({ itemId, ownerAvatarId, locationId }) {}
  async getDungeonStats(avatarId) {}
  async updateDungeonStats(avatarId, patch) {}
}
```

### MemoryStore

Owns conversation, memory, summaries, and context records.

Use cases:

- Record platform messages.
- Fetch recent channel messages.
- Fetch messages by avatar, author, channel, or reply relationship.
- Store memories, narratives, and summaries.
- Store image analysis cache records.
- Store thread summaries and planner state context.

Initial data:

- `messages`
- `memories`
- `narratives`
- `unified_channel_summaries`
- `thread_summaries`
- `image_analysis_cache`
- `avatar_location_memory`

Example contract:

```js
class MemoryStore {
  async recordMessage(message) {}
  async getMessageByPlatformId(platformMessageId) {}
  async listRecentMessages({ channelId, limit, before }) {}
  async listAvatarMessages({ avatarId, limit }) {}
  async saveMemory(memory) {}
  async listMemories({ avatarId, limit }) {}
  async saveNarrative(narrative) {}
  async getChannelSummary({ platform, channelId }) {}
  async saveChannelSummary(summary) {}
}
```

### SocialStore

Owns provider posts, provider queues, posting configuration, and external posting metadata. Provider credentials and OAuth state belong to `IdentityStore`.

Use cases:

- Store social posts and provider IDs.
- Track media usage.
- Track provider posting config.
- Resolve posting configuration for a provider/owner.

Initial data:

- `x_post_config`
- `telegram_post_config`
- `telegram_messages`
- `telegram_media_usage`
- `social_posts`

Example contract:

```js
class SocialStore {
  async getPostingConfig({ provider, owner }) {}
  async savePostingConfig({ provider, owner, config }) {}
  async recordPost(post) {}
  async listPosts(query, page) {}
}
```

### CombatStore

Owns combat logs, encounters, modifiers, turn state, and battle reporting.

Use cases:

- Create combat encounters.
- Append dungeon and combat log entries.
- Query recent combat events.
- Track modifiers and turn leases.

Initial data:

- `dungeon_log`
- `combat_encounters`
- `combat_logs`
- `dungeon_modifiers`
- `turn_leases`
- `channel_ticks`

Example contract:

```js
class CombatStore {
  async createEncounter(encounter) {}
  async appendLog(entry) {}
  async listRecentLogs(query, page) {}
  async getActiveModifiers(targetId) {}
  async saveModifier(modifier) {}
  async claimTurnLease(lease) {}
}
```

### PaymentStore

Owns wallets, x402 transactions, marketplace services, ratings, and payment reporting.

Use cases:

- Create and update agent wallets.
- Record wallet transactions.
- Record x402 transactions.
- Query payment dashboards.
- Manage marketplace services and ratings.

Initial data:

- `agent_wallets`
- `wallet_transactions`
- `x402_transactions`
- `service_marketplace`
- `service_ratings`

Example contract:

```js
class PaymentStore {
  async getAgentWallet(agentId) {}
  async saveAgentWallet(wallet) {}
  async recordWalletTransaction(transaction) {}
  async recordX402Transaction(transaction) {}
  async listTransactions(query, page) {}
  async upsertMarketplaceService(service) {}
  async rateMarketplaceService(rating) {}
}
```

### JobStore

Owns background work, generated media job state, sync progress, and operational snapshots.

Use cases:

- Create media generation jobs.
- Update job progress and status.
- Claim queued jobs.
- Track collection sync progress.
- Store metrics snapshots.

Initial data:

- `video_jobs`
- `generated_images`
- `veo_video_generations`
- `lyria_music_generations`
- `collection_sync_progress`
- `metrics_snapshots`
- `planner_assignments`

Example contract:

```js
class JobStore {
  async createJob(job) {}
  async claimNextJob({ type, workerId }) {}
  async updateJobStatus({ id, status, patch }) {}
  async getJob(id) {}
  async saveSyncProgress(progress) {}
  async recordMetricsSnapshot(snapshot) {}
}
```

## SQLite Schema Strategy

SQLite should start with a small common foundation:

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE documents (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  doc TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT,
  PRIMARY KEY (collection, id)
);
```

The `documents` table is useful as a bridge and for low-volume flexible records, but core domains should have real tables.

Recommended first tables:

```sql
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE setup_state (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE guild_configs (
  guild_id TEXT PRIMARY KEY,
  config_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  wallet_address TEXT,
  chain TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  profile_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX users_wallet_chain
  ON users(wallet_address, chain)
  WHERE wallet_address IS NOT NULL;
```

The `users.wallet_address` column above is acceptable only as an early bridge from V1. The clean Identity/Auth schema should replace it with normalized relationship tables:

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active',
  is_admin INTEGER NOT NULL DEFAULT 0,
  profile_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE wallets (
  id TEXT PRIMARY KEY,
  chain TEXT NOT NULL,
  normalized_address TEXT NOT NULL,
  display_address TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(chain, normalized_address)
);

CREATE TABLE passkey_credentials (
  credential_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  passkey_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE INDEX passkey_credentials_user ON passkey_credentials(user_id);

CREATE TABLE user_wallets (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id TEXT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'login',
  verified_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, wallet_id)
);

CREATE TABLE external_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  profile_json TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, provider_user_id)
);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  metadata_json TEXT
);

CREATE INDEX auth_sessions_user_expires ON auth_sessions(user_id, expires_at);

CREATE TABLE auth_challenges (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  chain TEXT,
  normalized_address TEXT,
  subject_json TEXT,
  nonce TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  UNIQUE(purpose, nonce)
);

CREATE INDEX auth_challenges_address ON auth_challenges(chain, normalized_address, expires_at);

CREATE TABLE oauth_states (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  state TEXT NOT NULL UNIQUE,
  owner_kind TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  code_verifier TEXT,
  scopes_json TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX oauth_states_owner ON oauth_states(provider, owner_kind, owner_id);

CREATE TABLE provider_credentials (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  owner_kind TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  credential_json TEXT NOT NULL,
  profile_json TEXT,
  scopes_json TEXT,
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  error_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, owner_kind, owner_id)
);

CREATE INDEX provider_credentials_provider_status
  ON provider_credentials(provider, status, expires_at);

CREATE TABLE auth_events (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  user_id TEXT,
  wallet_id TEXT,
  provider TEXT,
  owner_kind TEXT,
  owner_id TEXT,
  ip TEXT,
  user_agent TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX auth_events_created ON auth_events(created_at);
```

Wallet address normalization:

- Solana addresses: preserve base58 display; normalized form can be the exact trimmed address because Solana addresses are case-sensitive.
- EVM addresses: normalized form should be lowercase; display can preserve the submitted checksum casing.
- Unknown chains: normalized form should be trimmed and lowercased only if the chain's address format is known to be case-insensitive.

Session cookie target:

- V1 cookie payload: wallet address and admin boolean.
- V2 cookie payload: opaque `sessionId`; every protected request resolves `auth_sessions -> users`.
- Admin status is read from `users.is_admin` or a role table, so demotion/revocation takes effect without waiting for cookie expiry.

Avatar claims should move to `WorldStore`, but with identity references:

```sql
CREATE TABLE avatar_claims (
  id TEXT PRIMARY KEY,
  avatar_id TEXT NOT NULL,
  wallet_id TEXT REFERENCES wallets(id),
  user_id TEXT REFERENCES users(id),
  status TEXT NOT NULL,
  claim_message TEXT,
  claim_signature TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(avatar_id)
);

CREATE INDEX avatar_claims_wallet ON avatar_claims(wallet_id);
CREATE INDEX avatar_claims_user ON avatar_claims(user_id);
```

This keeps ownership with the world model while avoiding raw wallet-address joins everywhere.

World tables should combine structured lookup columns with JSON payloads:

```sql
CREATE TABLE avatars (
  id TEXT PRIMARY KEY,
  name TEXT,
  emoji TEXT,
  model TEXT,
  channel_id TEXT,
  owner_user_id TEXT,
  collection_key TEXT,
  doc_json TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX avatars_name ON avatars(name);
CREATE INDEX avatars_channel ON avatars(channel_id);
CREATE INDEX avatars_collection ON avatars(collection_key, id);
```

Message tables should be query-friendly:

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  platform_message_id TEXT NOT NULL,
  guild_id TEXT,
  channel_id TEXT NOT NULL,
  author_id TEXT,
  avatar_id TEXT,
  content TEXT,
  timestamp INTEGER NOT NULL,
  doc_json TEXT NOT NULL,
  UNIQUE(platform, platform_message_id)
);

CREATE INDEX messages_channel_timestamp ON messages(channel_id, timestamp DESC);
CREATE INDEX messages_avatar_timestamp ON messages(avatar_id, timestamp DESC);
CREATE INDEX messages_author_timestamp ON messages(author_id, timestamp DESC);
```

JSON can be queried when needed with SQLite JSON functions, but common lookups should be promoted to columns.

## MongoDB Implementation Strategy

MongoDB V2 stores should not be a passthrough to old collection access. They should implement the same store contracts as SQLite.

Rules:

- Convert string IDs to `ObjectId` only inside Mongo store implementations.
- Return plain objects with string IDs.
- Keep existing collection names during migration where practical.
- Encapsulate aggregation pipelines behind store methods.
- Keep index creation inside Mongo store initialization.

This lets the app migrate to stores before migrating physical data.

## Transactions and Concurrency

Store contracts should expose transaction helpers for operations that need atomicity:

```js
await dataLayer.transaction(async stores => {
  const avatar = await stores.world.getAvatarById(avatarId);
  await stores.world.patchAvatar(avatarId, patch);
  await stores.combat.appendLog(entry);
});
```

SQLite implementation:

- Uses `better-sqlite3` transactions.
- Single-writer semantics are acceptable for the self-contained deployment.
- Enable WAL mode.
- Use busy timeout.

MongoDB implementation:

- Uses sessions where available.
- May no-op transaction wrappers for operations that are already single-document atomic.

## Backend Selection

Backend selection should happen once during container setup:

```js
const backend = process.env.DATA_BACKEND || 'mongo';
container.register({
  dataLayer: asFunction(createDataLayer).singleton()
});
```

The existing `databaseService` can remain for legacy code. New code should receive `dataLayer`.

During migration:

- Legacy services keep using `databaseService`.
- Migrated services use `dataLayer`.
- Mongo-backed V2 stores can share the existing Mongo connection.
- SQLite-backed V2 stores own their SQLite connection.

## Migration Plan

### Phase 1: Foundation

- Add `better-sqlite3`.
- Add `dataLayer` registration.
- Add SQLite connection, migrations, and backend selection.
- Add base contract tests that run against both SQLite and Mongo store implementations.
- Add `DATA_BACKEND=sqlite|mongo`.

Acceptance:

- App starts with `DATA_BACKEND=mongo` unchanged.
- App can initialize an empty SQLite database.
- Store contract tests pass for `ConfigStore`.

### Phase 2: Config and Setup

Move the safest state first:

- setup status
- admin wallet
- settings
- guild configs
- global settings
- secrets metadata

Acceptance:

- Admin setup flow uses `configStore`.
- Setup persists with SQLite.
- Existing Mongo setup still works through Mongo `ConfigStore`.

### Phase 3: Identity and Auth

Move account and provider auth state into the clean V2 identity model:

- users
- wallet nonces
- wallet links
- X auth
- Telegram auth
- temporary OAuth state
- auth/session cookies

Acceptance:

- Admin login and wallet auth work on both backends through `IdentityStore`.
- Login uses `auth_challenges`, `users`, `wallets`, `user_wallets`, and `auth_sessions`.
- Browser login uses WebAuthn passkeys; wallet signatures remain proof for wallet linking and chain-specific actions.
- Users can register multiple passkeys and link multiple wallets, while a normalized wallet belongs to at most one user account.
- Cookies carry an opaque session ID, not wallet/admin claims.
- Discord wallet linking imports into `external_identities`, `wallets`, and `user_wallets`.
- X and Telegram auth import into `provider_credentials` and `oauth_states`; `SocialStore` no longer stores provider tokens.
- Provider credentials use explicit `{ kind, id }` owners instead of `global: true` or fallback-to-any-token queries.
- Avatar claim routes still live in `WorldStore`, but claims reference normalized `wallet_id` and `user_id`.
- Temporary state can expire or be cleaned up in SQLite without provider-specific temp tables.
- Provider auth code no longer uses direct collection access.

Migration mapping:

```text
users.walletAddress
  -> wallets + user_wallets + users

wallet_nonces
  -> auth_challenges purpose='login'

wallet_link_codes
  -> auth_challenges purpose='discord_wallet_link'

discord_wallet_links
  -> external_identities provider='discord' + user_wallets

wallet_link_audit
  -> auth_events

x_auth
  -> provider_credentials provider='x'

x_auth_temp
  -> oauth_states provider='x'

telegram_auth
  -> provider_credentials provider='telegram'

avatar_claims.walletAddress
  -> wallets + avatar_claims.wallet_id/user_id
```

Compatibility rules:

- Keep API responses with `walletAddress` during migration, but derive it from `wallets.display_address`.
- Keep accepting `avatarId` for provider auth routes, but translate it into `{ kind: 'avatar', id: avatarId }`.
- Keep supporting the admin/global X account, but translate it into `{ kind: 'global', id: 'global' }`.
- Do not preserve fallback queries that pick "any X auth with a token"; make the owner explicit.
- Do not preserve provider tokens as top-level fields in app-facing records; store them in encrypted `credential_json`.

### Phase 4: World Core

Move core entity state:

- avatars
- avatar claims
- locations
- items
- dungeon stats

Acceptance:

- Avatar browse/detail/admin paths use `worldStore`.
- Item movement and avatar stats use `worldStore`.
- ID conversion is fully hidden inside backend implementations.

### Phase 5: Memory and Social

Move high-volume and provider data:

- messages
- memories
- narratives
- summaries
- social posts
- media usage

Acceptance:

- Conversation context reads from `memoryStore`.
- Message recording uses `memoryStore`.
- Social posting reads/writes through `socialStore`.

### Phase 6: Combat, Payment, Jobs

Move remaining operational domains:

- combat logs
- encounters
- payment transactions
- marketplace
- job queues
- sync progress
- metrics snapshots

Acceptance:

- Admin dashboards use store query methods instead of aggregation pipelines.
- Background jobs can be claimed atomically in SQLite.
- Payment reporting has explicit SQL-backed query methods.

### Phase 7: Mongo-Free Runtime

- Remove embedded MongoDB from the Fly image when `DATA_BACKEND=sqlite`.
- Keep MongoDB dependency only if Mongo backend remains supported.
- Add backup and restore commands for SQLite plus media.
- Add import/export tooling for Mongo-to-V2.

Acceptance:

- Fly can run with no `mongod` process.
- `/data/cosyworld.sqlite` and `/data/media` are sufficient for backup.
- MongoDB remains an optional backend, not a runtime requirement.

## Import and Export

Migration tooling should be explicit:

```bash
node scripts/data/export-mongo-v2.mjs --out /data/export.ndjson
node scripts/data/import-v2-sqlite.mjs --in /data/export.ndjson --db /data/cosyworld.sqlite
```

Export records should be domain-shaped, not raw collection dumps:

```json
{"store":"world","type":"avatar","id":"...","record":{...}}
{"store":"config","type":"setting","key":"...","record":{...}}
```

This lets importers normalize old fields and skip obsolete data.

## Testing Strategy

Every store contract should have backend-agnostic tests:

```text
tests/data/contracts/configStore.contract.test.mjs
tests/data/contracts/identityStore.contract.test.mjs
tests/data/contracts/worldStore.contract.test.mjs
```

Each contract test runs against:

- in-memory or temporary-file SQLite
- test MongoDB when available

The tests should verify behavior, not database implementation details.

Example:

```js
describeStoreBackends('ConfigStore', ({ createStore }) => {
  it('marks setup complete and returns status', async () => {
    const store = await createStore();
    await store.markSetupComplete({ adminWallet: '0xabc', completedAt: now });
    expect(await store.getSetupStatus()).toMatchObject({
      setupComplete: true,
      adminWallet: '0xabc'
    });
  });
});
```

## Operational Notes

SQLite self-contained deployment should use:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

Backups:

- SQLite: copy via online backup API or `.backup`.
- Media: copy `/data/media`.
- Config: exported from `ConfigStore`, with secrets handled carefully.

Retention:

- MongoDB TTL indexes become explicit cleanup jobs in SQLite.
- Cleanup should run through `JobStore` or scheduled maintenance, not hidden DB behavior.

## First Implementation Slice

The first useful slice should be intentionally small:

1. Add the `dataLayer` module and backend selection.
2. Add SQLite connection and migrations.
3. Implement `ConfigStore` for SQLite and MongoDB.
4. Move setup status and settings routes/services to `ConfigStore`.
5. Add contract tests for `ConfigStore`.

This creates the pattern without touching avatars, messages, or game state.

## Open Questions

- Should SQLite become the default in development immediately, or only after Phase 2?
- Should MongoDB remain officially supported long-term, or only as a migration backend?
- Should IDs remain 24-character hex strings everywhere, or move new V2 records to UUIDv7?
- How much of `secretsService` should move into `ConfigStore` versus remain a security service backed by `ConfigStore`?
- Should admin dashboards query stores directly, or should reporting have separate read models?

## Decision Summary

V2 should be a store-oriented data layer with SQLite and MongoDB implementations. SQLite is the target for self-contained local/Fly deployments. MongoDB remains a compatibility backend during migration and may remain supported if the store contracts stay clean.

The key architectural move is not changing databases. It is changing ownership: routes and services should speak in domain use cases, and only store implementations should know how persistence works.
