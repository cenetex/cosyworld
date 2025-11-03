# CosyWorld Architecture Documentation

**Version**: 0.0.11  
**Last Updated**: October 2025  
**Target Audience**: Developers, LLM Agents (Claude Sonnet 4.5), Contributors

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Core Concepts](#core-concepts)
3. [Architecture Layers](#architecture-layers)
4. [Service Architecture](#service-architecture)
5. [Data Flow](#data-flow)
6. [Dependency Injection](#dependency-injection)
7. [Event System](#event-system)
8. [AI Model System](#ai-model-system)
9. [Memory Architecture](#memory-architecture)
10. [Database Schema](#database-schema)
11. [Security & Configuration](#security--configuration)
12. [Deployment Architecture](#deployment-architecture)
13. [Extension Points](#extension-points)

---

## System Overview

CosyWorld is an AI-powered avatar universe where persistent, evolving entities with unique personalities create their own stories across multiple platforms (Discord, Web, X/Twitter).

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Client Platforms                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ Discord  │  │   Web    │  │ X/Twitter│  │  Telegram│    │
│  │   Bot    │  │   UI     │  │  OAuth   │  │ (Future) │    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘    │
└───────┼─────────────┼─────────────┼─────────────┼───────────┘
        │             │             │             │
        └─────────────┴─────────────┴─────────────┘
                      │
        ┌─────────────▼─────────────┐
        │   CosyWorld Core Services  │
        │  (Node.js + Express)       │
        │                            │
        │  ┌─────────────────────┐  │
        │  │  Message Handler    │  │ ◄── Entry point for messages
        │  └──────────┬──────────┘  │
        │             │              │
        │  ┌──────────▼──────────┐  │
        │  │  Tool Decision      │  │ ◄── Determines actions
        │  │     Service         │  │
        │  └──────────┬──────────┘  │
        │             │              │
        │  ┌──────────▼──────────┐  │
        │  │  UnifiedAI Service  │  │ ◄── AI abstraction layer
        │  └──────────┬──────────┘  │
        │             │              │
        │  ┌──────────▼──────────┐  │
        │  │ OpenRouter/Google   │  │ ◄── AI providers
        │  └─────────────────────┘  │
        └────────────────────────────┘
                      │
        ┌─────────────▼─────────────┐
        │    Persistence Layer       │
        │  ┌─────────────────────┐  │
        │  │  MongoDB (Primary)  │  │ ◄── Avatars, memory, config
        │  └─────────────────────┘  │
        │  ┌─────────────────────┐  │
        │  │  S3 (Optional)      │  │ ◄── Media storage
        │  └─────────────────────┘  │
        └────────────────────────────┘
```

### Technology Stack

- **Runtime**: Node.js 18+ (ES Modules)
- **Framework**: Express.js (REST API & Web UI)
- **Database**: MongoDB (primary storage)
- **AI Providers**: OpenRouter (300+ models), Google AI (Gemini), Ollama (local)
- **Discord**: discord.js v14
- **DI Container**: Awilix (dependency injection)
- **Frontend**: Vanilla JS + Tailwind CSS
- **Build**: Webpack (production builds)

---

## Core Concepts

### Avatars
**Persistent AI entities with unique personalities and memories.**

- Each avatar has a unique ID (UUID)
- Personality traits, backstory, and voice
- Rarity tier (Legendary, Rare, Uncommon, Common)
- Combat stats (HP, attack, defense, speed)
- Memory system (short-term, long-term, emotional)
- NFT binding (optional Crossmint integration)

### Tiers & AI Models
**Rarity determines available AI models.**

```javascript
Legendary → GPT-4o, Claude-3-Opus, Gemini-2.0-Pro
Rare      → Gemini-1.5-Pro, Llama-70B, Mistral-Large
Uncommon  → Gemini-2.0-Flash, Qwen-32B, Mixtral
Common    → Llama-3.2-3B, Phi-3.5-Mini, Nova-Lite
```

### Tools
**Actions avatars can perform in the world.**

Categories:
- **Combat**: Attack, Defend, Move, Use Item
- **Social**: Post to X, Remember, Forget
- **World**: Summon Avatar, Breed, Create Item
- **Custom**: Dynamic narrative actions

Each tool has:
- Schema (JSON Schema for parameters)
- Executor function (implementation)
- Decision logic (when to use)
- Cost/cooldown (game balance)

### Memory
**Multi-tier memory system for context retention.**

1. **Short-term**: Last N messages in conversation
2. **Long-term**: Important events stored permanently
3. **Emotional**: Relationship states with other avatars
4. **Semantic**: Vector embeddings for similarity search

---

## Architecture Layers

### Layer 1: Presentation
**User-facing interfaces**

- Discord Bot (DiscordService)
- Web UI (WebService + Express routes)
- X/Twitter (XIntegrationService)
- API endpoints (/api/*)

### Layer 2: Application
**Business logic and orchestration**

- MessageHandler: Route incoming messages
- ResponseCoordinator: Manage response lifecycle
- ToolDecisionService: Decide which tools to use
- ToolExecutor: Execute tool actions
- CombatService: Battle mechanics
- QuestService: Quest progression

### Layer 3: Domain Services
**Core domain logic**

- AvatarService: Avatar CRUD and state
- MemoryService: Memory storage and retrieval
- ItemService: Item management
- LocationService: World locations
- RelationshipService: Avatar relationships

### Layer 4: AI Services
**AI provider integrations**

- UnifiedAIService: Provider-agnostic interface
- OpenRouterAIService: Primary AI (300+ models)
- GoogleAIService: Google Gemini (optional)
- OllamaAIService: Local AI (optional)
- AIModelService: Model registry and selection

### Layer 5: Infrastructure
**Foundation services**

- DatabaseService: MongoDB connection
- ConfigService: Configuration management
- SecretsService: Encrypted secrets
- Logger: Structured logging
- S3Service: Media storage (optional)
- SchedulingService: Background tasks

### Layer 6: Data Access
**Database abstraction**

- AvatarRepository
- MemoryRepository  
- ItemRepository
- GuildConnectionRepository
- (Others as needed)

---

## Service Architecture

### Dependency Injection Pattern

CosyWorld uses **Awilix** for dependency injection:

```javascript
// Service definition
export class MyService {
  constructor({ logger, databaseService, otherService }) {
    this.logger = logger;
    this.db = databaseService;
    this.other = otherService;
  }
}

// Registration (in container.mjs)
container.register({
  myService: asClass(MyService).singleton()
});

// Usage
const service = container.resolve('myService');
```

**Benefits**:
- Loose coupling between services
- Easy testing (mock dependencies)
- Clear dependency graph
- Automatic circular dependency resolution

### Service Lifecycle

```
Container Init → Constructor → initialize() → Runtime → cleanup()
       ↓              ↓             ↓            ↓          ↓
   DI wiring    Setup state   Async init   Handle req   Shutdown
```

Example:
```javascript
class ExampleService {
  constructor({ logger }) {
    this.logger = logger;
    // Synchronous setup only
  }
  
  async initialize() {
    // Async setup (DB connections, etc.)
    await this.connectToAPI();
  }
  
  async handleRequest() {
    // Runtime operations
  }
  
  async cleanup() {
    // Graceful shutdown
    await this.closeConnections();
  }
}
```

### Service Communication

**1. Direct Calls** (synchronous coupling)
```javascript
const result = await this.otherService.doSomething();
```

**2. Events** (asynchronous decoupling)
```javascript
// Publisher
eventBus.emit('avatar.created', { avatarId, metadata });

// Subscriber
eventBus.on('avatar.created', async (data) => {
  await this.handleNewAvatar(data);
});
```

**3. Late Binding** (break circular deps)
```javascript
// Instead of direct injection
constructor({ getMapService }) {
  this.getMap = getMapService; // Function, not service
}

// Use when needed
const map = this.getMap();
```

---

## Data Flow

### Message Processing Pipeline

```
Discord Message Received
    ↓
MessageHandler.handleMessage()
    ↓
[Rate limiting, spam check, permissions]
    ↓
ConversationManager.getOrCreate()
    ↓
MemoryService.getRecentMessages()
    ↓
ToolDecisionService.decideTool()
    ↓
[AI analyzes context, selects tool]
    ↓
ToolExecutor.execute()
    ↓
[Tool-specific logic executes]
    ↓
ResponseCoordinator.send()
    ↓
[Format, queue, deliver response]
    ↓
Discord Message Sent
    ↓
MemoryService.storeMessage()
```

### Structured Output Flow

```
Request for Structured Data
    ↓
UnifiedAIService.generateStructuredOutput()
    ↓
OpenRouterAIService.generateStructuredOutput()
    ↓
[Try json_schema format]
    ↓
Provider supports? → YES → Parse & validate → Return
    ↓ NO
[Try json_object format]
    ↓
Success? → YES → Parse & validate → Return
    ↓ NO
[Try instruction-based with retries]
    ↓
Parse with fuzzy JSON extraction
    ↓
Validate against schema
    ↓
Return or throw error
```

### Combat Flow

```
Player uses /fight command
    ↓
CombatService.initiateCombat()
    ↓
Create combat state in DB
    ↓
Emit 'combat.started' event
    ↓
CombatNarrativeService generates intro
    ↓
Loop until combat ends:
    ↓
  Avatar decides action (AI or player)
    ↓
  DiceService.roll() for randomness
    ↓
  Apply damage/effects
    ↓
  Update combat state
    ↓
  Generate narrative description
    ↓
  Check win condition
    ↓
Emit 'combat.ended' event
    ↓
Award XP, items, update stats
    ↓
Store combat log in memory
```

---

## Dependency Injection

### Container Initialization Sequence

```javascript
// Phase 1: Core Services (synchronous)
logger = new Logger()
secretsService = new SecretsService({ logger })
configService = new ConfigService({ logger, secretsService })

// Phase 2: Load Config (async)
await configService.loadConfig() // From MongoDB

// Phase 3: Register Core Services (explicit order)
container.register({
  databaseService: asClass(DatabaseService).singleton(),
  aiModelService: asClass(AIModelService).singleton(),
  toolService: asClass(ToolService).singleton(),
  // ... etc
})

// Phase 4: Dynamic Discovery
for (const serviceFile of globby('services/**/*.mjs')) {
  const ServiceClass = await import(serviceFile)
  container.register(camelCase(filename), asClass(ServiceClass).singleton())
}

// Phase 5: Late Binding (break circular deps)
container.register({
  getMapService: asFunction(() => () => container.resolve('mapService')).singleton()
})

// Phase 6: Post-Init Wiring
narrationService.start() // Attach event listeners
googleAIService.s3Service = container.resolve('s3Service') // Manual injection
```

### Circular Dependency Resolution

**Problem**: Service A needs Service B, Service B needs Service A

**Solutions**:

1. **PROXY Injection Mode** (automatic)
```javascript
// Awilix creates proxies that resolve lazily
container = createContainer({ injectionMode: InjectionMode.PROXY })
```

2. **Late Binding Getters** (manual)
```javascript
// Instead of injecting service directly
constructor({ getMapService }) {
  this.getMap = getMapService
}

// Resolve when needed
method() {
  const map = this.getMap() // Breaks circular dep
}
```

3. **Event-Based Decoupling** (architectural)
```javascript
// Instead of direct calls, use events
serviceA.emit('data.ready', data)
serviceB.on('data.ready', (data) => process(data))
```

---

## Event System

### Global Event Bus

```javascript
import eventBus from './utils/eventBus.mjs'

// Emit events
eventBus.emit('avatar.created', { avatarId, metadata })

// Listen to events
eventBus.on('avatar.created', async (data) => {
  await handleAvatarCreation(data)
})

// One-time listeners
eventBus.once('app.ready', () => {
  console.log('App started!')
})
```

### Event Categories

**Avatar Events**
- `avatar.created`
- `avatar.updated`
- `avatar.deleted`
- `avatar.leveled_up`

**Combat Events**
- `combat.started`
- `combat.turn`
- `combat.action`
- `combat.damage`
- `combat.ended`

**Memory Events**
- `memory.stored`
- `memory.retrieved`
- `memory.reflection`

**System Events**
- `app.ready`
- `app.shutdown`
- `config.updated`

### Event Structure

```javascript
{
  type: 'avatar.created', // Event type
  timestamp: Date.now(), // When it occurred
  source: 'AvatarService', // Which service emitted
  data: {
    // Event-specific payload
    avatarId: 'uuid',
    metadata: { ... }
  }
}
```

---

## AI Model System

### Model Registry

Models are organized by:
1. **Provider**: OpenRouter, Google, Ollama
2. **Tier**: Legendary, Rare, Uncommon, Common
3. **Capabilities**: Chat, vision, structured output, function calling
4. **Pricing**: Input/output cost per 1M tokens

```javascript
// models.openrouter.config.mjs
export default [
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    tier: 'legendary',
    capabilities: ['chat', 'vision', 'json_schema'],
    pricing: { input: 0.0025, output: 0.01 },
    contextWindow: 128000
  },
  // ... 300+ more models
]
```

### Model Selection Algorithm

```javascript
// 1. Check if exact model is available
if (aiModelService.modelIsAvailable('openrouter', 'openai/gpt-4o')) {
  return 'openai/gpt-4o'
}

// 2. Fuzzy match (handles typos, provider prefixes)
const closest = aiModelService.findClosestModel('openrouter', 'gpt4o')
// Returns: 'openai/gpt-4o' (Levenshtein distance)

// 3. Random from tier
const model = aiModelService.getRandomModel('openrouter', 'legendary')
```

### Structured Output Strategy

```
Try 1: json_schema (strict, OpenAI-compatible models only)
  ↓ 400 error?
Try 2: json_object (looser, more models support)
  ↓ Still fails?
Try 3: Instruction-based (system prompt with retries)
  ↓ Parse with fuzzy extraction
Return parsed JSON or throw
```

---

## Memory Architecture

### Memory Types

**1. Short-Term Memory**
```javascript
// Last N messages in conversation
{
  conversationId: 'discord-channel-123',
  messages: [
    { role: 'user', content: 'Hello', timestamp: ... },
    { role: 'assistant', content: 'Hi!', timestamp: ... }
  ],
  maxLength: 50 // Configurable
}
```

**2. Long-Term Memory**
```javascript
// Important events stored permanently
{
  avatarId: 'uuid',
  type: 'significant_event',
  content: 'Won epic battle against dragon',
  embedding: [...], // Vector for similarity search
  importance: 0.95, // 0-1 scale
  timestamp: Date.now()
}
```

**3. Emotional Memory**
```javascript
// Relationships with other avatars
{
  avatarId: 'uuid',
  targetId: 'other-uuid',
  relationship: {
    trust: 0.7,
    friendship: 0.8,
    rivalry: 0.2
  },
  history: [
    'Fought together against orcs',
    'Shared loot after quest'
  ]
}
```

### Memory Storage

```
Message → MemoryService.storeMessage()
    ↓
Calculate importance score
    ↓
importance > threshold? 
    ↓ YES
Generate embedding (EmbeddingService)
    ↓
Store in long-term memory (MongoDB)
    ↓
Add to short-term buffer (in-memory)
```

### Memory Retrieval

```
Need context for AI prompt
    ↓
MemoryService.getRelevantMemories(query, limit)
    ↓
Get recent messages (short-term)
    ↓
Generate query embedding
    ↓
Vector similarity search (long-term)
    ↓
Merge and rank by relevance + recency
    ↓
Return top N memories
```

---

## Database Schema

### Collections

**avatars**
```javascript
{
  _id: ObjectId,
  avatarId: 'uuid', // Unique identifier
  name: 'Aria',
  personality: 'Brave and curious',
  rarity: 'legendary',
  tier: 'legendary',
  stats: {
    hp: 100,
    maxHp: 100,
    attack: 15,
    defense: 10,
    speed: 12
  },
  inventory: ['item-uuid-1', 'item-uuid-2'],
  location: 'forest',
  createdAt: Date,
  updatedAt: Date
}
```

**memories**
```javascript
{
  _id: ObjectId,
  avatarId: 'uuid',
  type: 'conversation' | 'event' | 'relationship',
  content: 'Text of memory',
  embedding: [...], // 768-dim vector
  importance: 0.8,
  metadata: {
    conversationId: 'discord-123',
    channelId: '456',
    // ... contextual data
  },
  timestamp: Date
}
```

**items**
```javascript
{
  _id: ObjectId,
  itemId: 'uuid',
  name: 'Sword of Light',
  type: 'weapon',
  rarity: 'rare',
  effects: {
    attack: +5,
    special: 'Glows in darkness'
  },
  ownerId: 'avatar-uuid',
  createdAt: Date
}
```

**combat_sessions**
```javascript
{
  _id: ObjectId,
  sessionId: 'uuid',
  participants: ['avatar-1', 'avatar-2'],
  state: 'active' | 'ended',
  turns: [
    {
      avatarId: 'avatar-1',
      action: 'attack',
      roll: 18,
      damage: 12,
      narrative: 'Aria swings her sword...'
    }
  ],
  winner: null | 'avatar-1',
  startedAt: Date,
  endedAt: Date
}
```

**secrets**
```javascript
{
  _id: ObjectId,
  key: 'OPENROUTER_API_TOKEN',
  value: 'encrypted-base64-value', // AES-256-GCM
  iv: 'base64-iv',
  authTag: 'base64-tag',
  updatedAt: Date
}
```

### Indexes

```javascript
// avatars
{ avatarId: 1 } unique
{ name: 1 }
{ rarity: 1, tier: 1 }

// memories
{ avatarId: 1, timestamp: -1 }
{ type: 1, importance: -1 }
{ 'metadata.conversationId': 1 }

// items
{ itemId: 1 } unique
{ ownerId: 1 }
{ rarity: 1, type: 1 }

// combat_sessions
{ sessionId: 1 } unique
{ state: 1, startedAt: -1 }
{ participants: 1 }
```

---

## Security & Configuration

### Encrypted Secrets

All sensitive configuration stored encrypted in MongoDB:

```javascript
// Encryption (AES-256-GCM)
const key = crypto.randomBytes(32) // Stored in .env.encryption.key
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
const encrypted = cipher.update(plaintext, 'utf8', 'base64')
const authTag = cipher.getAuthTag()

// Decryption
const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
decipher.setAuthTag(authTag)
const decrypted = decipher.update(encrypted, 'base64', 'utf8')
```

### Configuration Wizard

First-time setup via web UI:

```
User visits http://localhost:3000
    ↓
No setup complete?
    ↓
Redirect to /admin/setup
    ↓
Wizard collects:
  - API keys (OpenRouter, Google, Replicate)
  - Discord bot token
  - Database connection
  - Optional services (S3, Twitter)
    ↓
Encrypt and store in MongoDB
    ↓
Mark setup complete
    ↓
Restart application
```

### Admin Panel

Post-setup configuration management:

- View/edit encrypted secrets
- Add/remove API keys
- Configure AI model defaults
- Manage Discord guilds
- View system health

Access control:
- Wallet signature authentication
- Admin whitelist (Discord IDs)
- Rate limiting (10 req/min)

---

## Deployment Architecture

### Development

```
npm run dev
  ↓
NODE_ENV=development
  ↓
nodemon watches src/
  ↓
Auto-restart on changes
  ↓
Web UI: http://localhost:3001
```

### Production

```
npm run build
  ↓
Webpack bundles frontend
  ↓
Generate docs
  ↓
npm start
  ↓
NODE_ENV=production
  ↓
Web UI: http://localhost:3000
```

### Environment Variables

```bash
# Core
NODE_ENV=production
MONGO_URI=mongodb://localhost:27017
MONGO_DB_NAME=cosyworld8

# Web Server
WEB_PORT=3000 # Override default port

# AI Services (encrypted in DB after first setup)
OPENROUTER_API_TOKEN=sk-or-...
GOOGLE_AI_API_KEY=AIza...
REPLICATE_API_TOKEN=r8_...

# Discord
DISCORD_BOT_TOKEN=MTk...
DISCORD_CLIENT_ID=12345...

# Optional
S3_API_ENDPOINT=https://s3.amazonaws.com
S3_API_KEY=...
S3_API_SECRET=...
```

---

## Extension Points

### Adding New Tools

```javascript
// 1. Create tool class
export class MyTool {
  static schema = {
    type: 'object',
    properties: {
      target: { type: 'string' },
      amount: { type: 'number' }
    }
  }
  
  async execute(params, context) {
    // Tool logic
    return {success: true, message: 'Done!'}
  }
}

// 2. Register in ToolService
toolService.registerTool('my_tool', MyTool)
```

### Adding New AI Provider

```javascript
// 1. Implement service interface
export class MyAIService {
  async chat(messages, options) {
    // Provider-specific logic
  }
  
  async generateStructuredOutput({prompt, schema, options}) {
    // Provider-specific logic
  }
}

// 2. Register in container
container.register({
  myAIService: asClass(MyAIService).singleton()
})

// 3. Add to UnifiedAIService
```

### Adding New Platform

```javascript
// 1. Create platform service
export class TelegramService {
  async initialize() {
    // Connect to Telegram API
  }
  
  async handleMessage(msg) {
    // Process Telegram messages
  }
}

// 2. Register in container
// 3. Wire up MessageHandler routing
```

---

## Best Practices

### For LLM Agents

1. **Read JSDoc First**: All services have comprehensive JSDoc with @context and @architecture tags
2. **Follow Data Flow**: Trace request paths through the system using @dataflow documentation
3. **Check Examples**: Every public method has working examples in JSDoc
4. **Understand Tiers**: Avatar rarity determines AI model access
5. **Use Events**: Prefer event-based communication for loose coupling

### For Developers

1. **Dependency Injection**: Never use `new ServiceClass()`, always resolve from container
2. **Error Handling**: Use structured error objects with user-friendly messages
3. **Logging**: Use `logger` service with appropriate levels (info, warn, error)
4. **Async/Await**: All I/O operations are async, handle errors properly
5. **Testing**: Mock dependencies via container registration
6. **Documentation**: Follow JSDoc standards in `docs/JSDOC_STANDARDS.md`

---

## Troubleshooting

### Common Issues

**Container Resolution Errors**
```
Error: Could not resolve 'myService'
→ Service not registered in container
→ Check container.mjs registration
→ Ensure service class is exported
```

**Circular Dependencies**
```
Maximum call stack exceeded
→ Circular dependency detected
→ Use late-binding getters or events
→ Check PROXY injection mode enabled
```

**AI Rate Limits**
```
429 Rate Limit Exceeded
→ Too many requests to provider
→ Implement backoff strategy
→ Consider caching responses
→ Use tier-appropriate models
```

**Memory Issues**
```
FATAL ERROR: JS heap out of memory
→ Too many services loaded
→ Check for memory leaks
→ Increase heap size: NODE_OPTIONS=--max-old-space-size=4096
```

---

## Resources

- **Code**: `/src` - All source code
- **Documentation**: `/docs` - Service-specific docs
- **JSDoc Standards**: `/docs/JSDOC_STANDARDS.md`
- **Configuration**: `src/config/` - Config schemas and validation
- **Examples**: Look for `@example` tags in JSDoc
- **Architecture Decisions**: Git commit messages and PR descriptions

---

**Maintained By**: CosyWorld Core Team  
**Last Review**: October 2025  
**Next Review**: When major features added

For questions or contributions, see `docs/CONTRIBUTING.md`
