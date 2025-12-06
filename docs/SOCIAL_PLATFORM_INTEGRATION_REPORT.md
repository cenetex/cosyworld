# Social Platform Integration & Consolidation Report

**Date:** December 5, 2025  
**Status:** Proposed  
**Target:** Engineering Team

## 1. Executive Summary

The CosyWorld system currently operates on two disconnected tracks regarding social media integration:
1.  **Global Bot Track:** A single "Narrator" bot with well-developed X (Twitter) and Telegram integration, managed via bespoke configuration.
2.  **Discord Swarm Track:** Thousands of user/wallet-owned avatars on Discord with no functional path to connect to Telegram or X, despite UI routes existing for this purpose.

This report outlines the architectural changes required to unify these systems under a new **`SocialPlatformService`**. This service will standardize how *any* avatar (Global or User-owned) connects to external platforms. Furthermore, we will consolidate the bespoke "Global Bot" management UI into a unified "Avatar Management" interface, treating the Global Bot as a first-class avatar with elevated permissions.

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

## 3. Proposed Architecture: SocialPlatformService

We will introduce `SocialPlatformService` to act as the orchestrator for all external social interactions. It will abstract the specific platform (X, Telegram, Discord) away from the avatar logic.

### 3.1. Core Responsibilities
- **Credential Management:** Storing and retrieving auth tokens for avatars across platforms.
- **Posting Interface:** A unified `post(avatarId, platform, content)` API.
- **Incoming Event Routing:** Routing webhooks from Telegram/X back to the correct avatar instance.

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

We will move away from scattered auth collections (`x_auth`, `telegram_auth`) and consolidate social identity within the Avatar document (or a tightly coupled `avatar_social_identities` collection if security dictates separation).

**Proposed Schema Addition to `Avatar`:**
```javascript
{
  // ... existing avatar fields
  socialPlatforms: {
    telegram: {
      botToken: "encrypted_string", // Encrypted
      botId: "123456",
      username: "MyAvatarBot",
      connectedAt: Date
    },
    x: {
      accessToken: "encrypted_string",
      refreshToken: "encrypted_string",
      userId: "twitter_user_id",
      handle: "twitter_handle",
      connectedAt: Date
    },
    discord: {
      // Discord is usually structural (channel/webhook), but can be tracked here
      channelId: "...",
      webhookUrl: "..." 
    }
  }
}
```

## 5. Service Layer Improvements

### 5.1. TelegramService Remediation
We must implement the missing methods in `TelegramService.mjs`:
1.  **`registerAvatarBot(avatarId, token)`**: 
    - Validate token with Telegram API (`getMe`).
    - Encrypt and store token in `socialPlatforms.telegram`.
    - Spin up a lightweight `Telegraf` instance (or use webhook multiplexing) and add to `this.bots` map.
2.  **`disconnectAvatarBot(avatarId)`**:
    - Stop the bot instance.
    - Remove credentials from DB.
3.  **`startAvatarBots()`**:
    - On service startup, iterate through all avatars with Telegram credentials and initialize their bots.

### 5.2. XService Integration
- Refactor `XService` to use the new `socialPlatforms` schema instead of `x_auth`.
- Ensure `SocialPlatformService` wraps `XService` methods for consistency.

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
- [ ] Create `SocialPlatformService` skeleton.
- [ ] Update `Avatar` schema to support `socialPlatforms`.
- [ ] Create migration script to move `x_auth` data to `Avatar.socialPlatforms`.

### Phase 2: Telegram Remediation (Week 1-2)
- [ ] Implement `registerAvatarBot` and `disconnectAvatarBot` in `TelegramService`.
- [ ] Implement bot instance management (startup/shutdown) in `TelegramService`.
- [ ] Update `telegramauth.js` routes to use the new implementation.

### Phase 3: UI Consolidation (Week 2-3)
- [ ] Build "Social Connections" React component.
- [ ] Integrate into Avatar Details page.
- [ ] Migrate Global Bot configuration to this new UI.
- [ ] Remove legacy Global Bot config routes/pages.

### Phase 4: Integration & Testing (Week 3)
- [ ] Test cross-posting: Discord Message -> SocialPlatformService -> Telegram/X.
- [ ] Verify Global Bot continues to function under new architecture.
- [ ] Load testing: Ensure server handles multiple active Telegram bot instances.

## 8. Technical Considerations

- **Telegram Webhooks vs. Polling:** Running thousands of bots via polling is resource-intensive. We should use a **Webhook Multiplexer** (single endpoint receiving updates for all bots) or stick to polling only for active/high-priority avatars if scale allows. For now, we will assume polling for the Global Bot and a limited number of VIP avatars, but plan for webhooks.
- **Security:** All tokens must be stored encrypted using the existing `encryption.mjs` utility.
