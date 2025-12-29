# Admin Portal UX Improvement Plan
## A Complete Redesign for Multi-Bot Swarm Management

**Version:** 1.0  
**Date:** December 21, 2025  
**Author:** Development Team

---

## Executive Summary

This document outlines a comprehensive redesign of the CosyWorld admin portal to address the following critical issues:

1. **Fragmented Navigation** - 16+ separate pages with inconsistent navigation
2. **Duplicative Functionality** - Secret management, bot configuration, and settings scattered across multiple views
3. **Anti-Patterns** - Environment variables mixed with database secrets, flat secret lists, no multi-bot support
4. **Poor Information Architecture** - No clear hierarchy for managing multiple bots across platforms

The new design introduces a **Bot-Centric Architecture** where users manage distinct bot instances, each with its own platform connections, secrets, and configurations.

---

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Core Design Principles](#core-design-principles)
3. [Information Architecture](#information-architecture)
4. [Page-by-Page Redesign](#page-by-page-redesign)
5. [Secrets Management Overhaul](#secrets-management-overhaul)
6. [Multi-Bot Architecture](#multi-bot-architecture)
7. [Component Library](#component-library)
8. [Technical Implementation](#technical-implementation)
9. [Migration Strategy](#migration-strategy)
10. [Success Metrics](#success-metrics)

---

## Current State Analysis

### Existing Admin Pages (16 total)

| Page | Purpose | Issues |
|------|---------|--------|
| `index.html` | Dashboard with stats | Good overview, but lacks actionable items |
| `secrets.html` | Flat list of all secrets | No grouping by bot/platform, bulk import prone to errors |
| `settings.html` | Global + Guild settings | 680 lines, mixes prompts/settings/payments/secrets tabs |
| `entity-management.html` | Avatar/Location/Item CRUD | Well-structured but separate from bot config |
| `x-accounts.html` | X/Twitter account management | Orphaned from bot concept |
| `telegram-global-posting.html` | Telegram bot config | Separate from x-global-posting, duplicative patterns |
| `x-global-posting.html` | X posting config | Same patterns as telegram, not unified |
| `global-bot.html` | Global bot management | 1820 lines! Monolithic, hard to maintain |
| `collections.html` | NFT collection management | Good isolation |
| `servers.html` | Discord server management | Good but disconnected from bot concept |
| `guild-settings.html` | Per-guild overrides | Good concept, poor discovery |
| `users.html` | User management | Minimal |
| `payment-monitoring.html` | Payment dashboard | Good standalone feature |
| `setup.html` | Initial setup wizard | Good onboarding |
| `login.html` | Authentication | Functional |
| `invite.html` | Bot invite flow | Minimal |

### Key Anti-Patterns Identified

#### 1. **Flat Secrets Management**
```javascript
// Current: All secrets in one list
const SECRET_CATEGORIES = {
  'API Keys': ['OPENROUTER_API_KEY', 'GOOGLE_AI_API_KEY', ...],
  'Bot Tokens': ['DISCORD_BOT_TOKEN', 'TELEGRAM_BOT_TOKEN'],
  // No concept of WHICH bot these belong to
};
```

**Problem:** A user running 3 Discord bots + 2 Telegram bots has no way to organize their tokens.

#### 2. **Environment Variable Dependency**
```javascript
// Current: Falls back to env vars everywhere
token = this.configService.get('TELEGRAM_GLOBAL_BOT_TOKEN') || process.env.TELEGRAM_GLOBAL_BOT_TOKEN;
```

**Problem:** Environment variables should only contain:
- `ENCRYPTION_KEY` (for encrypting database secrets)
- `MONGO_URI` (initial database connection)
- `NODE_ENV`

Everything else should be in the encrypted secrets database.

#### 3. **Global vs Per-Bot Confusion**
- `global-bot.html` manages a single "global" bot
- No clear model for multiple bots per platform
- X accounts are per-avatar, but Discord/Telegram are global

#### 4. **Inconsistent CSS/Theming**
- Some pages use `tailwindcss@2.2.19` CDN
- Some use `admin-common.css`
- Legacy nav vs `admin-shell.js` injection
- Multiple style patterns (cards, sections, etc.)

---

## Core Design Principles

### 1. **Bot-First Architecture**
Everything revolves around **Bot Instances**. A bot instance is a deployable unit with:
- A unique identifier
- Platform connections (Discord, X, Telegram)
- Associated secrets (tokens, API keys)
- Configuration (models, prompts, features)
- Assigned avatars

### 2. **Progressive Disclosure**
- Dashboard shows high-level health
- Click into a bot to see its configuration
- Drill down further for advanced settings

### 3. **Unified Secret Scoping**
Secrets belong to one of three scopes:
- **Global** - Shared across all bots (e.g., AI API keys)
- **Bot-Scoped** - Specific to one bot instance (e.g., DISCORD_BOT_TOKEN for "ProductionBot")
- **Platform-Scoped** - Shared across a platform (e.g., X_CLIENT_ID for OAuth)

### 4. **Single Source of Truth**
- All secrets in encrypted database
- Environment variables only for bootstrap config
- No duplicate configuration in multiple places

### 5. **Consistent Design System**
- Unified component library
- No CDN dependencies in production
- Dark theme with accent colors

---

## Information Architecture

### New Navigation Structure

```
┌─────────────────────────────────────────────────────────────┐
│  🤖 CosyWorld Admin                              [User] [⚙] │
├─────────────────────────────────────────────────────────────┤
│  Dashboard │ Bots │ Avatars │ World │ Payments │ Settings   │
└─────────────────────────────────────────────────────────────┘

Dashboard
├── System Health (CPU, Memory, Active Connections)
├── Bot Status Grid (quick view of all bots)
├── Recent Activity Feed
└── Quick Actions (Create Bot, Deploy Avatar)

Bots (NEW - Primary Hub)
├── Bot List (cards showing each bot instance)
├── Create New Bot
├── [Click Bot] → Bot Detail View
│   ├── Overview (status, stats, logs)
│   ├── Platforms (connected platforms)
│   │   ├── Discord (servers, channels, webhook)
│   │   ├── X/Twitter (accounts, OAuth status)
│   │   └── Telegram (bot token, channels)
│   ├── Secrets (bot-scoped secrets)
│   ├── Avatars (assigned avatars)
│   ├── Configuration (models, prompts)
│   └── Logs & Metrics

Avatars (formerly Entity Management)
├── Avatar List (filterable, sortable)
├── Create Avatar
├── [Click Avatar] → Avatar Detail
│   ├── Identity (name, emoji, image, personality)
│   ├── AI Config (model, prompts)
│   ├── Social Connections (per-avatar X, etc.)
│   ├── NFT/Deployment
│   └── Inventory & Relationships

World (NEW - Consolidated)
├── Locations
├── Items
├── Collections (NFTs)
└── Story Arcs

Payments
├── Transaction Monitor
├── Wallet Status
├── Agentic Economy Stats
└── x402 Configuration

Settings (Simplified)
├── Global Secrets (AI keys, infrastructure)
├── Platform OAuth (X, Discord app credentials)
├── Global Prompts & Defaults
├── Admin Users
└── System Configuration
```

---

## Page-by-Page Redesign

### 1. Dashboard (`/admin`)

**Current:** Stats cards + activity panel + quick actions  
**Redesign:**

```
┌─────────────────────────────────────────────────────────────┐
│  SYSTEM HEALTH                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ 🟢 API   │ │ 🟢 DB    │ │ 🟡 Redis │ │ 3 Bots   │       │
│  │ 45ms     │ │ Connected│ │ Syncing  │ │ Active   │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
├─────────────────────────────────────────────────────────────┤
│  ACTIVE BOTS                               [+ Create Bot]   │
│  ┌─────────────────┐ ┌─────────────────┐ ┌──────────────┐  │
│  │ 🤖 MainSwarm    │ │ 🤖 Buybot-Prod  │ │ 🤖 TestBot   │  │
│  │ Discord + X     │ │ Telegram        │ │ Discord      │  │
│  │ 12 avatars      │ │ 3 channels      │ │ 2 avatars    │  │
│  │ 🟢 Running      │ │ 🟢 Running      │ │ 🟡 Paused    │  │
│  └─────────────────┘ └─────────────────┘ └──────────────┘  │
├─────────────────────────────────────────────────────────────┤
│  RECENT ACTIVITY                                            │
│  • Avatar "Moonstone" posted to X — 5m ago                  │
│  • Buybot detected swap on SOL/USDC — 12m ago               │
│  • New user claimed avatar "Starlight" — 1h ago             │
└─────────────────────────────────────────────────────────────┘
```

### 2. Bots Hub (`/admin/bots`) — **NEW PRIMARY PAGE**

**Purpose:** Central management for all bot instances

```
┌─────────────────────────────────────────────────────────────┐
│  BOTS                                    [+ Create New Bot] │
├─────────────────────────────────────────────────────────────┤
│  Filter: [All ▼] [All Platforms ▼]         🔍 Search        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ 🤖 MainSwarm                                    [Edit] ││
│  │ ─────────────────────────────────────────────────────── ││
│  │ Platforms: Discord 🟢 │ X (Twitter) 🟢 │ Telegram ⚫    ││
│  │ Avatars: 12 active │ Servers: 3 guilds │ Posts: 847     ││
│  │ Last Active: 2 minutes ago                              ││
│  │                                                          ││
│  │ [Manage Secrets] [View Logs] [Pause] [Configure]        ││
│  └─────────────────────────────────────────────────────────┘│
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ 🤖 Buybot-Production                           [Edit]   ││
│  │ ─────────────────────────────────────────────────────── ││
│  │ Platforms: Discord ⚫ │ X ⚫ │ Telegram 🟢               ││
│  │ Channels: 15 │ Tracked Tokens: 23 │ Alerts Today: 156   ││
│  │ Last Active: Just now                                   ││
│  └─────────────────────────────────────────────────────────┘│
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3. Bot Detail View (`/admin/bots/:botId`)

**Purpose:** Complete management of a single bot instance

**Tabbed Interface:**

#### Tab: Overview
- Bot name, description, status
- Quick stats (messages sent, errors, uptime)
- Start/Stop/Restart controls
- Recent logs snippet

#### Tab: Platforms
Collapsible sections for each platform:

```
┌─────────────────────────────────────────────────────────────┐
│  PLATFORMS                                                  │
├─────────────────────────────────────────────────────────────┤
│  ▼ Discord                                         🟢 Active │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Bot Token: ••••••••••••••••••••XYZ         [Reveal] [📋]││
│  │ Client ID: 1234567890                                   ││
│  │ Status: Connected to 3 guilds                           ││
│  │                                                          ││
│  │ Connected Guilds:                                        ││
│  │ • CosyWorld Main (ID: 123456) — 500 members             ││
│  │ • Test Server (ID: 789012) — 25 members                 ││
│  │                                                          ││
│  │ [Invite to New Server] [Disconnect] [View Logs]         ││
│  └─────────────────────────────────────────────────────────┘│
│                                                             │
│  ▶ X (Twitter)                               ⚫ Not Connected │
│  ▶ Telegram                                  ⚫ Not Connected │
│                                                             │
│  [+ Add Platform Connection]                                │
└─────────────────────────────────────────────────────────────┘
```

#### Tab: Secrets
Bot-scoped secrets only:

```
┌─────────────────────────────────────────────────────────────┐
│  SECRETS for MainSwarm                                      │
├─────────────────────────────────────────────────────────────┤
│  ℹ️ These secrets are specific to this bot instance.        │
│     Global secrets (AI keys, etc.) are in Settings.         │
├─────────────────────────────────────────────────────────────┤
│  🔵 Discord                                                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ DISCORD_BOT_TOKEN    ••••••••••••XYZ    [Edit] [Del] │  │
│  │ DISCORD_CLIENT_ID    1234567890         [Edit] [Del] │  │
│  │ + Add Discord Secret                                  │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  🐦 X (Twitter)                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ No X secrets configured for this bot                  │  │
│  │ [+ Add X Credentials]                                 │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  📱 Telegram                                                │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ No Telegram secrets configured for this bot           │  │
│  │ [+ Add Telegram Token]                                │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

#### Tab: Avatars
Assign/unassign avatars to this bot:

```
┌─────────────────────────────────────────────────────────────┐
│  AVATARS assigned to MainSwarm                              │
├─────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────┐ │
│  │ 🌙 Moonstone     │ Active │ claude-sonnet │ [Manage]   │ │
│  │ ⭐ Starlight     │ Active │ gpt-4o        │ [Manage]   │ │
│  │ 🔮 Oracle        │ Paused │ llama-70b     │ [Manage]   │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  [+ Assign Existing Avatar] [+ Create New Avatar]           │
└─────────────────────────────────────────────────────────────┘
```

#### Tab: Configuration
Bot-specific settings:

```
┌─────────────────────────────────────────────────────────────┐
│  CONFIGURATION                                              │
├─────────────────────────────────────────────────────────────┤
│  AI Model Defaults                                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Default Model:  [anthropic/claude-sonnet-4 ▼]         │  │
│  │ Temperature:    [0.7          ]                       │  │
│  │ Max Tokens:     [2048         ]                       │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  Rate Limiting                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Messages/hour:  [60           ]                       │  │
│  │ Cooldown (sec): [10           ]                       │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  Features                                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ [✓] Enable combat system                              │  │
│  │ [✓] Enable breeding                                   │  │
│  │ [ ] Enable x402 payments                              │  │
│  │ [✓] Auto-post to X                                    │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  [Save Changes] [Reset to Defaults]                         │
└─────────────────────────────────────────────────────────────┘
```

### 4. Settings (`/admin/settings`) — Simplified

**Purpose:** Global configuration only (not per-bot)

**Sections:**

#### Global Secrets
Secrets shared across all bots:

```
┌─────────────────────────────────────────────────────────────┐
│  GLOBAL SECRETS                                             │
│  ℹ️ These are shared across all bot instances               │
├─────────────────────────────────────────────────────────────┤
│  🧠 AI Services                                             │
│  ├── OPENROUTER_API_KEY      ••••••••••ABC     [Edit]      │
│  ├── GOOGLE_AI_API_KEY       ••••••••••DEF     [Edit]      │
│  └── REPLICATE_API_TOKEN     (not set)          [Add]       │
│                                                             │
│  🏗️ Infrastructure                                          │
│  ├── S3_ACCESS_KEY_ID        ••••••••••GHI     [Edit]      │
│  ├── S3_SECRET_ACCESS_KEY    ••••••••••JKL     [Edit]      │
│  └── S3_BUCKET               cosyworld-prod    [Edit]      │
│                                                             │
│  🔐 Platform OAuth (Shared App Credentials)                 │
│  ├── X_CLIENT_ID             1234567890        [Edit]      │
│  ├── X_CLIENT_SECRET         ••••••••••MNO     [Edit]      │
│  ├── DISCORD_CLIENT_ID       9876543210        [Edit]      │
│  └── DISCORD_CLIENT_SECRET   ••••••••••PQR     [Edit]      │
└─────────────────────────────────────────────────────────────┘
```

#### Global Prompts
System prompts that apply universally:

```
┌─────────────────────────────────────────────────────────────┐
│  GLOBAL PROMPTS                                             │
├─────────────────────────────────────────────────────────────┤
│  System Prompt Template                                     │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ You are an AI assistant in the {universeName}...     │  │
│  │                                                       │  │
│  │                                                       │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  X Post Style                                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Use a warm, engaging narrator voice. Be concise...   │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  [Save All] [Reset to Defaults]                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Secrets Management Overhaul

### Current Problems

1. **Flat structure** - All secrets in one list
2. **No ownership** - Can't tell which bot a token belongs to
3. **Env var fallback** - Secrets scattered between .env and database
4. **No validation** - Invalid tokens silently fail

### New Secrets Architecture

```typescript
interface Secret {
  _id: string;
  key: string;                    // e.g., "DISCORD_BOT_TOKEN"
  value: string;                  // Encrypted
  scope: "global" | "bot" | "avatar";
  scopeId?: string;               // botId or avatarId if scoped
  platform?: "discord" | "x" | "telegram" | "ai" | "infrastructure";
  metadata: {
    createdAt: Date;
    updatedAt: Date;
    createdBy: string;            // Admin wallet address
    lastUsedAt?: Date;
    isValid?: boolean;            // Result of last validation
    validationMessage?: string;
  };
}
```

### Example Data Model

```javascript
// Global AI key (shared by all bots)
{
  _id: "sec_abc123",
  key: "OPENROUTER_API_KEY",
  value: "encrypted...",
  scope: "global",
  platform: "ai",
  metadata: { isValid: true }
}

// Bot-scoped Discord token
{
  _id: "sec_def456",
  key: "DISCORD_BOT_TOKEN",
  value: "encrypted...",
  scope: "bot",
  scopeId: "bot_mainswarm",
  platform: "discord",
  metadata: { isValid: true }
}

// Avatar-scoped X token (for per-avatar posting)
{
  _id: "sec_ghi789",
  key: "X_ACCESS_TOKEN",
  value: "encrypted...",
  scope: "avatar",
  scopeId: "avatar_moonstone",
  platform: "x",
  metadata: { isValid: true, expiresAt: "2024-02-01" }
}
```

### Secret Resolution Order

When a service needs a secret:

```javascript
async function resolveSecret(key, context = {}) {
  const { botId, avatarId } = context;
  
  // 1. Check avatar scope (most specific)
  if (avatarId) {
    const avatarSecret = await getSecret(key, 'avatar', avatarId);
    if (avatarSecret) return avatarSecret;
  }
  
  // 2. Check bot scope
  if (botId) {
    const botSecret = await getSecret(key, 'bot', botId);
    if (botSecret) return botSecret;
  }
  
  // 3. Check global scope
  const globalSecret = await getSecret(key, 'global');
  if (globalSecret) return globalSecret;
  
  // 4. DO NOT fall back to process.env (except for bootstrap)
  throw new Error(`Secret ${key} not found`);
}
```

### Bootstrap-Only Environment Variables

```bash
# .env - ONLY these values
NODE_ENV=production
MONGO_URI=mongodb://localhost:27017/cosyworld
ENCRYPTION_KEY=<your-encryption-key>
PORT=3001
```

**Everything else goes in the database.**

---

## Multi-Bot Architecture

### Data Model

```typescript
interface Bot {
  _id: string;
  name: string;                   // "MainSwarm", "Buybot-Prod"
  description?: string;
  status: "running" | "paused" | "error" | "initializing";
  
  // Platform connections (lightweight references)
  platforms: {
    discord?: {
      enabled: boolean;
      clientId?: string;
      guildIds: string[];
    };
    x?: {
      enabled: boolean;
      accountId?: string;         // Reference to x_accounts collection
    };
    telegram?: {
      enabled: boolean;
      botUsername?: string;
      channelIds: string[];
    };
  };
  
  // Configuration
  config: {
    defaultModel: string;
    temperature: number;
    maxTokens: number;
    features: {
      combat: boolean;
      breeding: boolean;
      x402Payments: boolean;
      autoPost: boolean;
    };
    rateLimit: {
      messagesPerHour: number;
      cooldownSeconds: number;
    };
  };
  
  // Avatar assignments
  avatarIds: string[];
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  lastActiveAt?: Date;
}
```

### Service Discovery

Bots need to be discoverable by services:

```javascript
// In DiscordService
async initialize() {
  const bots = await this.botService.getBotsWithPlatform('discord');
  
  for (const bot of bots) {
    const token = await this.secretsService.getAsync(
      'DISCORD_BOT_TOKEN', 
      { scope: 'bot', scopeId: bot._id }
    );
    
    if (token) {
      await this.connectBot(bot._id, token);
    }
  }
}
```

---

## Component Library

### Design Tokens

```css
:root {
  /* Colors */
  --color-bg-primary: #0f172a;
  --color-bg-secondary: #1e293b;
  --color-bg-tertiary: #334155;
  --color-surface: #1e293b;
  --color-surface-hover: #334155;
  --color-border: #475569;
  --color-text-primary: #f8fafc;
  --color-text-secondary: #94a3b8;
  --color-text-muted: #64748b;
  
  /* Accents */
  --color-accent-primary: #8b5cf6;    /* Purple */
  --color-accent-secondary: #06b6d4;  /* Cyan */
  --color-success: #22c55e;
  --color-warning: #f59e0b;
  --color-error: #ef4444;
  
  /* Platform Colors */
  --color-discord: #5865f2;
  --color-twitter: #1da1f2;
  --color-telegram: #0088cc;
  
  /* Spacing */
  --space-xs: 0.25rem;
  --space-sm: 0.5rem;
  --space-md: 1rem;
  --space-lg: 1.5rem;
  --space-xl: 2rem;
  
  /* Radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-full: 9999px;
}
```

### Core Components

#### Card
```html
<div class="admin-card">
  <div class="admin-card-header">
    <h3 class="admin-card-title">Card Title</h3>
    <span class="admin-badge">Badge</span>
  </div>
  <div class="admin-card-body">
    Content here
  </div>
  <div class="admin-card-footer">
    <button class="btn btn-primary">Action</button>
  </div>
</div>
```

#### Platform Badge
```html
<span class="platform-badge platform-discord">
  <svg>...</svg> Discord
</span>
<span class="platform-badge platform-x">
  <svg>...</svg> X
</span>
<span class="platform-badge platform-telegram">
  <svg>...</svg> Telegram
</span>
```

#### Secret Input
```html
<div class="secret-input">
  <label>Discord Bot Token</label>
  <div class="secret-input-wrapper">
    <input type="password" value="••••••••••••XYZ" readonly />
    <button class="btn-icon" title="Reveal">👁</button>
    <button class="btn-icon" title="Copy">📋</button>
    <button class="btn-icon" title="Edit">✏️</button>
  </div>
  <span class="secret-status valid">✓ Valid</span>
</div>
```

#### Status Indicator
```html
<span class="status-indicator status-active">
  <span class="status-dot"></span>
  Running
</span>
<span class="status-indicator status-paused">
  <span class="status-dot"></span>
  Paused
</span>
<span class="status-indicator status-error">
  <span class="status-dot"></span>
  Error
</span>
```

---

## Technical Implementation

### Phase 1: Foundation (Week 1-2)

1. **Create `BotService`**
   - CRUD operations for bot instances
   - Platform connection management
   - Avatar assignment

2. **Refactor `SecretsService`**
   - Add scope support (global, bot, avatar)
   - Remove env var fallbacks (except bootstrap)
   - Add validation hooks

3. **Create new CSS framework**
   - Design tokens
   - Core components
   - Dark theme

### Phase 2: New Pages (Week 3-4)

1. **Build `/admin/bots` hub**
   - Bot list with cards
   - Create bot flow
   - Bot detail view (tabbed)

2. **Consolidate Settings**
   - Global secrets only
   - Platform OAuth section
   - Global prompts

3. **Update Dashboard**
   - Bot status grid
   - System health
   - Recent activity

### Phase 3: Migration (Week 5)

1. **Data migration script**
   - Move existing secrets to scoped model
   - Create default "MainBot" for existing config
   - Preserve existing functionality

2. **Redirect old URLs**
   - `/admin/secrets` → `/admin/settings#secrets`
   - `/admin/global-bot` → `/admin/bots/default`
   - `/admin/x-global-posting` → `/admin/bots/default?tab=platforms`

### Phase 4: Polish (Week 6)

1. **Remove deprecated pages**
2. **Update documentation**
3. **Performance optimization**
4. **Error handling & validation**

---

## Migration Strategy

### Data Migration

```javascript
// scripts/migrate-to-multi-bot.mjs

async function migrateSecrets(db) {
  const oldSecrets = await db.collection('secrets').find({}).toArray();
  
  for (const secret of oldSecrets) {
    // Determine scope based on key patterns
    let scope = 'global';
    let platform = null;
    
    if (secret.key.startsWith('DISCORD_')) {
      platform = 'discord';
      if (secret.key === 'DISCORD_BOT_TOKEN') scope = 'bot';
    } else if (secret.key.startsWith('TELEGRAM_')) {
      platform = 'telegram';
      if (secret.key === 'TELEGRAM_GLOBAL_BOT_TOKEN') scope = 'bot';
    } else if (secret.key.startsWith('X_')) {
      platform = 'x';
    } else if (['OPENROUTER_API_KEY', 'GOOGLE_AI_API_KEY'].includes(secret.key)) {
      platform = 'ai';
    }
    
    await db.collection('secrets_v2').insertOne({
      ...secret,
      scope,
      scopeId: scope === 'bot' ? 'bot_default' : null,
      platform,
      metadata: {
        createdAt: new Date(),
        migratedFrom: 'secrets_v1'
      }
    });
  }
}

async function createDefaultBot(db) {
  await db.collection('bots').insertOne({
    _id: 'bot_default',
    name: 'Default Bot',
    description: 'Migrated from legacy global bot configuration',
    status: 'running',
    platforms: {
      discord: { enabled: true },
      telegram: { enabled: true },
      x: { enabled: true }
    },
    config: {
      defaultModel: 'anthropic/claude-sonnet-4',
      // ... migrate from existing config
    },
    createdAt: new Date(),
    migratedFrom: 'global_bot'
  });
}
```

### URL Redirects

```javascript
// In webService.mjs
app.get('/admin/secrets', (req, res) => {
  res.redirect(301, '/admin/settings?tab=secrets');
});

app.get('/admin/global-bot', (req, res) => {
  res.redirect(301, '/admin/bots/default');
});

app.get('/admin/telegram-global-posting', (req, res) => {
  res.redirect(301, '/admin/bots/default?tab=platforms&platform=telegram');
});

app.get('/admin/x-global-posting', (req, res) => {
  res.redirect(301, '/admin/bots/default?tab=platforms&platform=x');
});
```

---

## Success Metrics

### User Experience

| Metric | Current | Target |
|--------|---------|--------|
| Pages to configure a new platform | 3-4 | 1 |
| Clicks to find a specific secret | 5+ | 2 |
| Time to understand bot status | 30s+ | 5s |
| Pages in admin | 16 | 8 |

### Technical

| Metric | Current | Target |
|--------|---------|--------|
| Duplicate CSS files | 3+ | 1 |
| Env var fallbacks in code | 50+ | 3 |
| Lines in largest HTML file | 1820 | <400 |
| Global mutable state | High | Minimal |

### Operational

| Metric | Current | Target |
|--------|---------|--------|
| Secret scope clarity | None | 100% scoped |
| Multi-bot support | No | Yes |
| Platform isolation | Partial | Complete |

---

## Appendix: File Changes

### Files to Create

```
src/services/web/public/admin/
├── bots/
│   ├── index.html           # Bot list
│   ├── [botId].html         # Bot detail (SPA route)
│   └── create.html          # Create bot wizard
├── world/
│   ├── index.html           # World overview
│   ├── locations.html
│   ├── items.html
│   └── collections.html
└── css/
    └── admin-v2.css         # New design system

src/services/web/public/js/
├── admin-v2/
│   ├── components/
│   │   ├── card.js
│   │   ├── secret-input.js
│   │   ├── platform-badge.js
│   │   └── status-indicator.js
│   ├── pages/
│   │   ├── bots.js
│   │   ├── bot-detail.js
│   │   └── settings.js
│   └── services/
│       ├── bot-service.js
│       └── secret-service.js

src/services/bot/
└── botService.mjs           # New Bot management service
```

### Files to Deprecate

```
src/services/web/public/admin/
├── global-bot.html          # → /admin/bots/:botId
├── telegram-global-posting.html  # → Merged into bot detail
├── x-global-posting.html    # → Merged into bot detail
├── secrets.html             # → /admin/settings?tab=secrets
└── servers.html             # → /admin/bots/:botId?tab=platforms
```

### Files to Refactor

```
src/services/web/public/admin/
├── index.html               # Update to new design
├── settings.html            # Simplify to global-only
├── entity-management.html   # Rename to avatars
└── collections.html         # Move to /world/collections

src/services/foundation/
├── secretsService.mjs       # Add scope support
└── configService.mjs        # Remove env var fallbacks
```

---

## Conclusion

This redesign transforms the admin portal from a fragmented collection of pages into a cohesive, bot-centric management system. Key improvements:

1. **Clarity** — Every secret, setting, and configuration has a clear owner
2. **Scalability** — Run multiple bots with isolated configurations
3. **Maintainability** — Unified design system, fewer files, less duplication
4. **Security** — Scoped secrets, no env var leakage, validation

The phased approach allows for incremental deployment while maintaining backwards compatibility during the transition.
