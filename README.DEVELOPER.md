# CosyWorld Developer Guide

**Target Audience**: Developers, Contributors, LLM Agents (Claude Sonnet 4.5)  
**Version**: 0.0.11  
**Last Updated**: October 2025

---

## Quick Start for Developers

### Prerequisites

```bash
# Required
- Node.js 18.18 or higher
- MongoDB 5.0 or higher (local or cloud)
- Git

# Optional but recommended
- Discord Developer Account (for bot testing)
- OpenRouter API Key (for AI features)
- VS Code with ESLint extension
```

### Clone and Install

```bash
# Clone repository
git clone https://github.com/cenetex/cosyworld.git
cd cosyworld

# Install dependencies
npm install

# Set up git hooks (linting, formatting)
npm run prepare

# Copy example env file
cp .env.example .env
```

### First-Time Setup

```bash
# Start MongoDB (local)
mongod --dbpath ./data/db

# Start the application
npm start

# Visit setup wizard
open http://localhost:3000/admin/setup

# Follow wizard to configure:
# 1. Database connection
# 2. AI API keys (OpenRouter, Google, etc.)
# 3. Discord bot token
# 4. Optional services (S3, Twitter)
```

### Development Mode

```bash
# Run with auto-reload
npm run dev

# Development runs on port 3001 by default
# Production uses port 3000
# This allows running both simultaneously for testing

# Access dev UI
open http://localhost:3001
```

---

## Project Structure

```
cosyworld/
├── src/                        # Source code (ES modules)
│   ├── container.mjs          # Dependency injection container ⭐
│   ├── index.mjs              # Application entry point ⭐
│   ├── services/              # Business logic services
│   │   ├── ai/               # AI provider integrations ⭐
│   │   │   ├── openrouterAIService.mjs  # Primary AI service
│   │   │   ├── googleAIService.mjs      # Google Gemini
│   │   │   ├── unifiedAIService.mjs     # Provider abstraction
│   │   │   └── aiModelService.mjs       # Model registry
│   │   ├── chat/             # Message handling
│   │   │   ├── messageHandler.mjs       # Entry point for messages
│   │   │   └── responseCoordinator.mjs  # Response management
│   │   ├── tools/            # Tool system (actions avatars can perform)
│   │   ├── combat/           # Battle system
│   │   ├── memory/           # Memory management
│   │   ├── foundation/       # Core services (DB, config, logger)
│   │   └── social/           # Discord, Twitter, etc.
│   ├── dal/                   # Data access layer (repositories)
│   ├── utils/                 # Utility functions
│   ├── schemas/               # JSON schemas for validation
│   ├── events/                # Event system
│   └── config/                # Configuration management
├── docs/                       # Documentation
│   ├── JSDOC_STANDARDS.md    # Documentation standards ⭐
│   ├── services/             # Service-specific docs
│   └── systems/              # System architecture docs
├── scripts/                    # Utility scripts
│   ├── task.mjs              # Task runner
│   └── build-docs.mjs        # Documentation generator
├── public/                     # Static assets (production build output)
├── infra/                      # Infrastructure (Lambda, Docker, etc.)
├── ARCHITECTURE.md            # System architecture ⭐
├── README.md                  # User-facing README
├── README.DEVELOPER.md        # This file ⭐
└── package.json               # Dependencies and scripts

⭐ = Start here for understanding the codebase
```

---

## Core Concepts for Developers

### Dependency Injection

**Everything uses Awilix DI container** - never use `new Service()`.

```javascript
// ✅ Correct: Resolve from container
const logger = container.resolve('logger');
const aiService = container.resolve('openrouterAIService');

// ❌ Wrong: Direct instantiation
const logger = new Logger(); // Don't do this!
```

**Service registration** happens in `src/container.mjs`:

```javascript
// Explicit registration (for core services)
container.register({
  myService: asClass(MyService).singleton()
});

// Auto-discovery (for most services)
// Services in src/services/**/*.mjs are registered automatically
// Filename becomes camelCase service name
// Example: avatarService.mjs → avatarService
```

**Injecting dependencies**:

```javascript
export class MyService {
  // Destructure dependencies from constructor param
  constructor({ logger, databaseService, otherService }) {
    this.logger = logger;
    this.db = databaseService;
    this.other = otherService;
  }
  
  async doSomething() {
    this.logger.info('Doing something...');
    const data = await this.db.find({});
    return this.other.process(data);
  }
}
```

### Service Lifecycle

```javascript
export class ExampleService {
  // 1. Constructor: Dependency injection, synchronous setup
  constructor({ logger, databaseService }) {
    this.logger = logger;
    this.db = databaseService;
    this.cache = new Map(); // Synchronous initialization
  }
  
  // 2. initialize(): Async setup (optional, called if exists)
  async initialize() {
    // Connect to external services, load data, etc.
    await this.loadConfig();
    this.logger.info('ExampleService initialized');
  }
  
  // 3. Runtime: Handle requests
  async handleRequest(data) {
    // Your business logic here
  }
  
  // 4. cleanup(): Graceful shutdown (optional)
  async cleanup() {
    await this.closeConnections();
    this.logger.info('ExampleService cleaned up');
  }
}
```

### Conversation Threads & Summon Controls

| Variable | Default | Purpose |
| --- | --- | --- |
| `CONVERSATION_THREAD_TTL` | `180000` (3 minutes) | Lifetime for in-memory conversation threads before they expire without activity. |
| `CONVERSATION_THREAD_MAX_TURNS` | `6` | Maximum number of exchanges tracked inside a single thread. |
| `CONVERSATION_THREAD_EXTEND_ON_ACTIVITY` | `true` | If `true`, each recorded turn extends the TTL to keep active discussions alive. |
| `CONVERSATION_MODE_DURATION_MS` | `300000` | Default duration for presence "conversation mode" boosts (used for summons/mentions). |
| `CONVERSATION_MODE_MAX_TURNS` | `5` | Default guaranteed turns while an avatar is in conversation mode. |
| `SUMMON_PROACTIVE_ENABLED` | `true` | Enables proactive follow-up responses after a summon greeting. |
| `SUMMON_INITIAL_TURNS` | `5` | Guaranteed high-priority turns granted to a freshly summoned avatar. |
| `SUMMON_CONVERSATION_DURATION` | `300000` | Duration (ms) the summon conversation mode and thread remain active. |
| `SUMMON_THREAD_MAX_TURNS` | `8` | Max thread turns allocated to the summon conversation thread. |
| `SUMMON_FIRST_FOLLOWUP_DELAY_MS` | `4000` | Delay before the first proactive follow-up message post-summon. |
| `SUMMON_SECOND_FOLLOWUP_DELAY_MS` | `8000` | Delay before checking for reactions and optionally sending a second follow-up. |
| `BOT_MENTION_CASCADE_LIMIT` | `3` | Maximum avatars that can respond when mentioned by another avatar. |
| `BOT_MENTION_CREATE_THREAD` | `true` | Toggle automatic thread creation when avatars mention each other. |
| `BOT_MENTION_THREAD_TURNS` | `6` | Max turns allocated to mention-triggered threads. |
| `BOT_MENTION_GRANT_TURNS` | `2` | Guaranteed turns granted to mentioned avatars lacking summon priority. |

### Event-Based Communication

Use events for decoupled service communication:

```javascript
import eventBus from './utils/eventBus.mjs';

// Publisher (emit events)
export class AvatarService {
  async createAvatar(data) {
    const avatar = await this.db.insert(data);
    
    // Emit event for other services to react
    eventBus.emit('avatar.created', {
      avatarId: avatar.avatarId,
      metadata: avatar
    });
    
    return avatar;
  }
}

// Subscriber (listen to events)
export class MemoryService {
  constructor({ logger }) {
    this.logger = logger;
    
    // Set up event listeners in constructor
    eventBus.on('avatar.created', this.handleAvatarCreation.bind(this));
  }
  
  async handleAvatarCreation({ avatarId, metadata }) {
    this.logger.info(`Initializing memory for avatar ${avatarId}`);
    // Initialize memory structures
  }
}
```

---

## Working with AI Services

### Model Selection

CosyWorld uses a **tier-based system**:

```javascript
Tier         Models                      Use Cases
────────────────────────────────────────────────────────
Legendary    GPT-4o, Claude Opus        Complex reasoning, creative writing
Rare         Gemini Pro, Llama-70B      Standard tasks, good quality
Uncommon     Gemini Flash, Qwen-32B     Fast responses, simple tasks
Common       Llama-3B, Phi-3.5          Basic chat, cheap operations
```

**Requesting a specific model**:

```javascript
const response = await openRouterService.chat(messages, {
  model: 'openai/gpt-4o-mini',
  temperature: 0.7,
  max_tokens: 500
});
```

**Fuzzy matching** (automatic):

```javascript
// These all resolve to the same model:
'gpt-4o' → 'openai/gpt-4o'
'gpt4o' → 'openai/gpt-4o'
'GPT-4O' → 'openai/gpt-4o'
'openai/gpt-4o-2024-11-20' → 'openai/gpt-4o'
```

**Random model from tier**:

```javascript
const model = await aiModelService.getRandomModel('openrouter', 'legendary');
// Returns: 'openai/gpt-4o' or 'anthropic/claude-3-opus' or similar
```

### Structured Output

**Generate JSON matching a schema**:

```javascript
const result = await openRouterService.generateStructuredOutput({
  prompt: "Create a fantasy weapon",
  schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      type: { type: "string", enum: ["sword", "bow", "staff", "axe"] },
      damage: { type: "number", minimum: 1, maximum: 100 },
      rarity: { type: "string", enum: ["common", "rare", "legendary"] },
      description: { type: "string" }
    },
    required: ["name", "type", "damage"]
  },
  options: {
    model: 'google/gemini-2.0-flash-exp:free',
    temperature: 0.8
  }
});

// Result is guaranteed to match schema or throw error
console.log(result.name); // "Sword of Light"
console.log(result.damage); // 45
```

**Fallback strategy** (automatic):

```
1. Try json_schema (strict, OpenAI-compatible models)
2. If 400 error, try json_object (more models support)
3. If still fails, use instruction-based with retries
4. Parse with fuzzy JSON extraction
5. Validate against schema
```

### Error Handling

All AI service errors are normalized:

```javascript
try {
  const response = await openRouterService.chat(messages);
} catch (err) {
  // Structured error object
  console.log(err.status);          // 429
  console.log(err.code);            // 'rate_limit_exceeded'
  console.log(err.userMessage);     // 'Rate limit reached – slowing down'
  console.log(err.providerMessage); // Technical details for logs
}

// Or use envelope mode (no throwing)
const response = await openRouterService.chat(messages, {
  returnEnvelope: true
});

if (response.error) {
  console.error('AI request failed:', response.error);
  // response.text will be empty string
} else {
  console.log('Success:', response.text);
}
```

### Token & Credit Guarding

High-volume AI runs can burn through OpenRouter credits quickly. ConversationManager now enforces a lightweight budget guard controlled via environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `AI_COMPLETION_MAX_TOKENS` | `1024` | Hard cap for completion tokens on standard replies. Requests asking for more are truncated to this ceiling. |
| `AI_LOW_CREDIT_MAX_TOKENS` | `640` (or lower than the main cap) | Secondary cap applied when a request hits a payment/credit error before retrying with a cheaper model. |
| `AI_LOW_CREDIT_MODEL_FALLBACKS` | `meta-llama/llama-3.2-1b-instruct,google/gemini-2.0-flash-exp:free` | Comma-separated list of low-cost models used when OpenRouter returns HTTP 402 / “insufficient credits.” |

If OpenRouter responds with a payment/credit error, ConversationManager automatically retries the turn with the first available fallback model and the reduced max token budget above. The guard also logs when a recovery occurs so you can monitor how often the downgrade path is being used. Tune these knobs based on your current credit limits (e.g., lower the primary cap during heavy events or swap the fallback list to the cheapest free-tier models available in your account).

---

## Database Operations

### Using Repositories

```javascript
export class AvatarService {
  constructor({ databaseService, logger }) {
    this.db = null;
    this.collection = null;
    this.logger = logger;
    this.dbService = databaseService;
  }
  
  async initialize() {
    this.db = await this.dbService.getDatabase();
    this.collection = this.db.collection('avatars');
    
    // Create indexes
    await this.collection.createIndex({ avatarId: 1 }, { unique: true });
  }
  
  async findByAvatarId(avatarId) {
    return await this.collection.findOne({ avatarId });
  }
  
  async create(data) {
    const avatar = {
      avatarId: uuidv4(),
      ...data,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    await this.collection.insertOne(avatar);
    return avatar;
  }
}
```

### ObjectId Handling

```javascript
import { toObjectId } from './utils/toObjectId.mjs';

// Convert string to ObjectId safely
const _id = toObjectId(idString);

// Query by ObjectId
const doc = await collection.findOne({ _id: toObjectId(id) });

// Never use new ObjectId() directly - use utility
```

### Database Indexes

Create indexes in `initialize()` method:

```javascript
async initialize() {
  this.db = await this.dbService.getDatabase();
  this.collection = this.db.collection('my_collection');
  
  // Unique index
  await this.collection.createIndex(
    { uniqueField: 1 },
    { unique: true, name: 'uniqueField_unique' }
  );
  
  // Compound index
  await this.collection.createIndex(
    { field1: 1, field2: -1 },
    { name: 'field1_field2_compound' }
  );
  
  // TTL index (auto-delete after time)
  await this.collection.createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: 'expiresAt_ttl' }
  );
}
```

---

## Tools System

Tools are actions avatars can perform. Examples: attack, post to Twitter, create item, etc.

### Creating a New Tool

```javascript
// 1. Create tool class in src/services/tools/
export class MyTool {
  // Define schema for parameters
  static schema = {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        description: 'Target of the action'
      },
      amount: {
        type: 'number',
        description: 'Amount/intensity',
        minimum: 1,
        maximum: 100
      }
    },
    required: ['target']
  };
  
  // Metadata
  static toolName = 'my_tool';
  static description = 'Does something interesting';
  static category = 'action'; // action, combat, social, world
  
  constructor({ logger, databaseService }) {
    this.logger = logger;
    this.db = databaseService;
  }
  
  // Execute the tool
  async execute(params, context) {
    const { target, amount = 10 } = params;
    const { avatarId, channelId } = context;
    
    this.logger.info(`${avatarId} using my_tool on ${target}`);
    
    // Your tool logic here
    // Return result object
    return {
      success: true,
      message: `Successfully used tool on ${target}`,
      effects: {
        // Any state changes
      }
    };
  }
  
  // Check if tool can be used (optional)
  async canUse(context) {
    // Check cooldowns, permissions, etc.
    return true;
  }
}

// 2. Register in ToolService (usually automatic via auto-discovery)
toolService.registerTool('my_tool', MyTool);
```

### Tool Decision Flow

```
User message received
    ↓
ToolDecisionService.decideTool()
    ↓
[AI analyzes message + available tools]
    ↓
AI returns: { tool: 'attack', params: {target: 'goblin'} }
    ↓
ToolExecutor.execute('attack', params, context)
    ↓
[Tool-specific logic runs]
    ↓
Return result to ResponseCoordinator
```

---

## Testing

### Unit Testing

```javascript
// tests/services/avatarService.test.js
import { createContainer, asClass, asValue } from 'awilix';
import { AvatarService } from '../../src/services/avatar/avatarService.mjs';

describe('AvatarService', () => {
  let container;
  let avatarService;
  let mockDb;
  let mockLogger;
  
  beforeEach(() => {
    // Create test container
    container = createContainer();
    
    // Mock dependencies
    mockLogger = {
      info: jest.fn(),
      error: jest.fn()
    };
    
    mockDb = {
      collection: jest.fn(() => ({
        findOne: jest.fn(),
        insertOne: jest.fn()
      }))
    };
    
    // Register mocks
    container.register({
      logger: asValue(mockLogger),
      databaseService: asValue({
        getDatabase: async () => mockDb
      })
    });
    
    // Register service under test
    container.register({
      avatarService: asClass(AvatarService).singleton()
    });
    
    avatarService = container.resolve('avatarService');
  });
  
  test('creates avatar with correct structure', async () => {
    await avatarService.initialize();
    
    const avatar = await avatarService.create({
      name: 'TestAvatar',
      personality: 'Test personality'
    });
    
    expect(avatar.avatarId).toBeDefined();
    expect(avatar.name).toBe('TestAvatar');
    expect(mockDb.collection().insertOne).toHaveBeenCalled();
  });
});
```

### Integration Testing

```javascript
// tests/integration/ai.test.js
import { container, containerReady } from '../../src/container.mjs';

describe('AI Service Integration', () => {
  beforeAll(async () => {
    await containerReady; // Wait for full initialization
  });
  
  test('generates structured output', async () => {
    const aiService = container.resolve('openrouterAIService');
    
    const result = await aiService.generateStructuredOutput({
      prompt: 'Create a simple item',
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          value: { type: 'number' }
        }
      }
    });
    
    expect(result.name).toBeDefined();
    expect(typeof result.value).toBe('number');
  });
});
```

---

## Debugging

### Enable Debug Logging

```bash
# Debug Awilix dependency resolution
DEBUG=awilix:resolver npm run dev

# Debug specific service
DEBUG=cosyworld:ai npm run dev

# Debug all
DEBUG=* npm run dev
```

### VSCode Launch Configuration

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug CosyWorld",
      "skipFiles": ["<node_internals>/**"],
      "program": "${workspaceFolder}/src/index.mjs",
      "env": {
        "NODE_ENV": "development",
        "DEBUG": "awilix:resolver"
      }
    }
  ]
}
```

### Common Issues

**"Could not resolve 'serviceName'"**
```
→ Service not registered in container
→ Check src/container.mjs
→ Ensure service class is exported
→ Check filename matches camelCase service name
```

**"Maximum call stack size exceeded"**
```
→ Circular dependency detected
→ Use late-binding getters (getServiceName)
→ Or use event-based communication
→ Check PROXY injection mode is enabled
```

**"Connection refused" (MongoDB)**
```
→ MongoDB not running
→ Start with: mongod --dbpath ./data/db
→ Or check MONGO_URI in .env
```

---

## Code Style

### ESLint Configuration

CosyWorld uses ESLint with custom rules:

```javascript
// eslint.config.js
export default [
  {
    files: ['src/**/*.mjs'],
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off', // We use logger service instead
      'prefer-const': 'error',
      'no-var': 'error'
    }
  }
];
```

Run linting:
```bash
npm run lint
npm run format # Auto-fix formatting
```

### Naming Conventions

```javascript
// Services: PascalCase
export class AvatarService {}

// Files: camelCase.mjs
avatarService.mjs

// Container names: camelCase
container.register({ avatarService: ... })

// Constants: UPPER_SNAKE_CASE
const MAX_RETRIES = 3;

// Private methods: _prefixed
_privateMethod() {}

// Async functions: always use async/await, never callbacks
async fetchData() {
  const result = await this.db.find();
  return result;
}
```

### Import Order

```javascript
// 1. External dependencies
import express from 'express';
import { ObjectId } from 'mongodb';

// 2. Internal utilities
import { logger } from './utils/logger.mjs';
import { toObjectId } from './utils/toObjectId.mjs';

// 3. Services
import { AvatarService } from './services/avatar/avatarService.mjs';

// 4. Types (if using TypeScript/JSDoc types)
/** @typedef {import('./types').Avatar} Avatar */
```

---

## Documentation Standards

### JSDoc Comments

**Follow the standards in `docs/JSDOC_STANDARDS.md`.**

Key points:
- Use custom tags: @context, @architecture, @lifecycle, @dataflow
- Provide working examples for every public method
- Document errors and edge cases
- Include performance notes for expensive operations
- Link related code with @see tags

Example:
```javascript
/**
 * Create a new avatar with validation and event emission.
 * 
 * @description
 * Creates avatar in database, generates unique ID, initializes memory
 * structures, and emits 'avatar.created' event for other services.
 * 
 * @context
 * Called when user mints NFT or creates avatar via admin panel.
 * Triggers memory initialization and combat stat calculation.
 * 
 * @param {Object} data - Avatar creation data
 * @param {string} data.name - Avatar name (3-50 chars)
 * @param {string} data.personality - Personality description
 * @param {string} [data.rarity='common'] - Rarity tier
 * 
 * @returns {Promise<Object>} Created avatar with generated ID
 * @throws {ValidationError} If data fails schema validation
 * 
 * @example
 * const avatar = await avatarService.create({
 *   name: 'Aria',
 *   personality: 'Brave and curious',
 *   rarity: 'legendary'
 * });
 * console.log(avatar.avatarId); // 'uuid-here'
 * 
 * @since 0.0.1
 */
async create(data) {
  // Implementation
}
```

---

## Contributing

### Git Workflow

```bash
# 1. Create feature branch
git checkout -b feature/my-feature

# 2. Make changes
# 3. Run tests
npm run lint
npm test

# 4. Commit (follows conventional commits)
git commit -m "feat: add new tool for avatar trading"
git commit -m "fix: resolve circular dependency in combat service"
git commit -m "docs: add JSDoc to memory service"

# 5. Push and create PR
git push origin feature/my-feature
```

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `refactor`: Code refactoring
- `test`: Adding tests
- `chore`: Maintenance tasks

Examples:
```
feat(tools): add item trading tool
fix(ai): resolve rate limit retry logic
docs(readme): update installation instructions
refactor(combat): extract dice rolling to service
```

### Pull Request Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing completed

## Documentation
- [ ] JSDoc comments added
- [ ] README updated if needed
- [ ] Architecture docs updated if needed

## Checklist
- [ ] Code follows style guide
- [ ] All tests pass
- [ ] No new warnings
- [ ] Commit messages follow convention
```

---

## Resources

### Documentation
- **Architecture**: `ARCHITECTURE.md` - System design and data flow
- **JSDoc Standards**: `docs/JSDOC_STANDARDS.md` - Documentation guidelines
- **Service Docs**: `docs/services/` - Individual service documentation
- **API Docs**: Generated from JSDoc (run `npm run docs`)

### External Resources
- [OpenRouter API Docs](https://openrouter.ai/docs)
- [Discord.js Guide](https://discordjs.guide/)
- [Awilix Documentation](https://github.com/jeffijoe/awilix)
- [MongoDB Node Driver](https://www.mongodb.com/docs/drivers/node/)

### Community
- **Discord**: [Join our server](https://discord.gg/cosyworld) (if available)
- **GitHub Issues**: Report bugs and request features
- **Farcaster**: [@immanence](https://farcaster.xyz/immanence)

---

## FAQ

**Q: Why ES modules (.mjs) instead of CommonJS?**
A: ES modules are the standard, support top-level await, and work better with modern tooling.

**Q: Why Awilix instead of other DI frameworks?**
A: Lightweight, supports PROXY mode for circular deps, auto-discovery, and minimal boilerplate.

**Q: Why MongoDB instead of PostgreSQL?**
A: Flexible schema for evolving avatar attributes, native JSON support, easy horizontal scaling.

**Q: Can I use TypeScript?**
A: Currently no, but JSDoc provides type hints. TypeScript support may come in future.

**Q: How do I add a new AI provider?**
A: Implement the AI service interface (chat, generateStructuredOutput), register in container, add to UnifiedAIService.

**Q: Where are API keys stored?**
A: Encrypted in MongoDB using AES-256-GCM. Encryption key in `.env.encryption.key` (gitignored).

**Q: How do I reset the setup?**
A: Run `npm run reset-setup` to clear config and restart wizard.

---

**Last Updated**: October 2025  
**Maintained By**: CosyWorld Core Team  
**Version**: 0.0.11

For questions, open an issue on GitHub or reach out on Discord!
