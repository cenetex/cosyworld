# Social Platform Integration & Consolidation Report

**Date:** December 5, 2025  
**Status:** In Progress  
**Target:** Engineering Team

## 1. Executive Summary

The CosyWorld system currently operates on two disconnected tracks regarding social media integration:
1.  **Global Bot Track:** A single "Narrator" bot with well-developed X (Twitter) and Telegram integration, managed via bespoke configuration.
2.  **Discord Swarm Track:** Thousands of user/wallet-owned avatars on Discord with no functional path to connect to Telegram or X, despite UI routes existing for this purpose.

This report outlines (and now tracks) the architectural changes required to unify these systems under a new **`SocialPlatformService`**. The first production cut of this service is now live: it stores encrypted per-avatar credentials inside a dedicated `social_platform_connections` collection, automatically rehydrates Telegram and X providers on boot, and exposes a unified `/api/social` endpoint for listing connections and initiating posts. Global Bot management remains slated for consolidation into the Avatar Management interface, keeping the Global Bot as a first-class avatar with elevated permissions.

## 2. Current System Analysis

### 2.1. The "Two Track" Problem
- **Global Bot:** Uses `GlobalBotService`, `TelegramService` (global token), and `XService` (global auth). It has a dedicated "narrative" loop and memory system.
- **User Avatars:** Live primarily in `DiscordService`. While `XService` has some per-avatar auth logic (`x_auth` collection), `TelegramService` is completely missing the implementation for per-avatar bots.

### 2.2. Critical Implementation Gaps
Analysis of `src/services/social/telegramService.mjs` and `src/services/web/server/routes/telegramauth.js` reveals:
- **Missing Methods:** The routes call `registerAvatarBot`, `disconnectAvatarBot`, and `isTelegramAuthorized`, but these methods **do not exist** in `TelegramService.mjs`.
- **Unused Infrastructure:** The `this.bots = new Map()` property in `TelegramService` is defined but never populated.
- **Data Fragmentation:** X authentication lives in `x_auth`, Telegram authentication (theoretically) in `telegram_auth`, and Discord mapping in `channel_avatar_presence`.

### 2.3. UI Fragmentation
- Global Bot settings are likely handled via environment variables or raw DB edits (`telegram_post_config`).
- User avatars have no clear UI to manage their social connections.

## 3. Architecture: SocialPlatformService

`SocialPlatformService` now acts as the orchestrator for all external social interactions. The initial implementation manages Telegram (per-avatar bot tokens) and X (OAuth2 tokens) and exposes a pluggable provider system so Discord or future platforms can be added without touching downstream controllers.

### 3.1. Core Responsibilities (Current State)
- **Credential Management:** Stores encrypted credentials in `social_platform_connections` (with automatic indexing, refresh tracking, and connection status fields).
- **Connection Lifecycle:** Rehydrates providers on startup, surfaces status via `socialPlatformService.getConnection()` (now wired into `/api/telegramauth` + `/api/xauth`).
- **Posting Interface:** Provides `socialPlatformService.post(platform, avatarId, content)` which now backs new REST endpoints under `/api/social`.
- **Incoming Event Routing:** Still to do—current implementation focuses on outbound flows; webhook fan-in remains future work.

### 3.2. Service Interface
```javascript
class SocialPlatformService {
  // Connection Management
  async connectPlatform(avatarId, platform, credentials) {}
  async disconnectPlatform(avatarId, platform) {}
  async getConnections(avatarId) {}

  // Unified Posting
  async broadcast(avatarId, content, platforms = ['all']) {}
  
  // Status
  async getPlatformStatus(avatarId) {
    return {
      telegram: { connected: true, botUsername: "@RatiBot" },
      x: { connected: true, handle: "@Rati_AI" },
      discord: { connected: true, channelId: "..." }
    };
  }
}
```

## 4. Data Model Updates

Instead of mutating the Avatar document immediately, we introduced a purpose-built `social_platform_connections` collection with tight indexes (`{ avatarId, platform }` unique) plus encrypted credential blobs. Each record tracks metadata (username, profile image, token expiry), channel bindings (Telegram), lifecycle timestamps, and the last refresh timestamp. This unlocks the new service without destabilizing Avatar reads while still allowing us to migrate into-avatar storage later if needed.

`x_auth` remains as the authoritative OAuth store for a short transition period (global bot + legacy flows rely on it), but every successful OAuth callback now mirrors credentials into `social_platform_connections` automatically.

## 5. Service Layer Improvements

### 5.1. TelegramService Remediation
Telegram per-avatar flows are now delegated through `SocialPlatformService`. The `telegramauth` routes no longer touch the legacy collection; instead they call `socialPlatformService.connectAvatar('telegram', ...)`, which spins up a Telegraf bot per avatar, stores encrypted tokens, and reports status back via the shared `/api/social/connections/:avatarId` endpoint. Remaining work: move the legacy `telegram_auth` records over and delete the unused methods in `TelegramService`.

### 5.2. XService Integration
- `xauth` now mirrors OAuth2 credentials into `social_platform_connections` and consumes `SocialPlatformService` for status + disconnect. The new X provider handles OAuth2 refreshes and pushes updated tokens back into the encrypted store.
- Remaining work: retire the legacy `/status` caching logic once all callers read exclusively from the SocialPlatformService cache and migrate `xService` global-posting helpers to the provider facade.

## 6. UI/UX Consolidation: Avatar Management

We will deprecate any standalone "Global Bot Config" pages and consolidate everything into a unified **Avatar Management Dashboard**.

### 6.1. The "Global Bot" is just an Avatar
- The Global Bot will be identified by a flag (e.g., `type: 'global_narrator'`) or a specific ID.
- It will appear in the Avatar Management list but may have a visual badge (e.g., "👑 System Avatar").

### 6.2. New "Social Connections" Panel
On the Avatar Details/Edit page, a new tab **"Social Connections"** will be added:

**UI Mockup Elements:**
- **Telegram Card:**
  - Status: *Not Connected*
  - Action: Input Bot Token (from BotFather) -> [Connect]
  - *On Connect:* Shows Bot Username, Link to Chat, [Disconnect] button.
- **X (Twitter) Card:**
  - Status: *Connected as @CosyNarrator*
  - Action: [Refresh Auth] | [Disconnect]
- **Discord Card:**
  - Status: *Active in #general*
  - Action: [Change Channel]

### 6.3. Admin vs. User View
- **Admins:** Can see and manage connections for *all* avatars, including the Global Bot.
- **Users:** Can only manage connections for avatars they own (Wallet-based ownership).

## 7. Implementation Roadmap

### Phase 1: Foundation (Week 1)
- [x] Create `SocialPlatformService` skeleton (now live with Telegram + X providers, credential encryption, and automatic rehydration).
- [ ] Update `Avatar` schema to support `socialPlatforms` (deferred; using `social_platform_connections` as an interim store).
- [ ] Create migration script to move `x_auth` data to the new structure (pending until schema decision finalizes).

### Phase 2: Telegram Remediation (Week 1-2)
- [x] Update `telegramauth.js` routes to use `SocialPlatformService` for status/register/disconnect.
- [x] Spin up per-avatar Telegraf sessions through the Telegram provider (launch/stop handled automatically during connect/reconnect).
- [ ] Migrate legacy `telegram_auth` data and remove dead code from `TelegramService`.

### Phase 3: UI Consolidation (Week 2-3)
- [x] Expose `/api/social/connections/:avatarId` + `/api/social/:platform/post` to support the new UI surface.
- [ ] Build "Social Connections" React component.
- [ ] Integrate into Avatar Details page.
- [ ] Migrate Global Bot configuration to this new UI.
- [ ] Remove legacy Global Bot config routes/pages.

### Phase 4: Integration & Testing (Week 3)
- [ ] Test cross-posting: Discord Message -> SocialPlatformService -> Telegram/X.
- [ ] Verify Global Bot continues to function under new architecture.
- [ ] Load testing: Ensure server handles multiple active Telegram bot instances.

## 8. New API Surface

- `GET /api/social/connections/:avatarId` — returns the canonical list of SocialPlatformService connections (requires avatar ownership or admin).
- `POST /api/social/:platform/:avatarId/post` — unified posting endpoint; delegates to platform providers (currently supports X text posts, with Telegram/Discord hooks pending).
- `/api/xauth/*` and `/api/telegramauth/*` have been migrated to consume SocialPlatformService so the UI always receives live status direct from the unified store.

## 9. Technical Considerations

- **Telegram Webhooks vs. Polling:** Running thousands of bots via polling is resource-intensive. We should use a **Webhook Multiplexer** (single endpoint receiving updates for all bots) or stick to polling only for active/high-priority avatars if scale allows. For now, we will assume polling for the Global Bot and a limited number of VIP avatars, but plan for webhooks.
- **Security:** All tokens must be stored encrypted using the existing `encryption.mjs` utility.
