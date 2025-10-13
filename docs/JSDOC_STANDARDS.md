# JSDoc Standards for CosyWorld

**Version**: 1.0  
**Last Updated**: October 2025  
**Purpose**: Provide comprehensive inline documentation optimized for LLM agents (Claude Sonnet 4.5) and human developers

---

## Core Principles

1. **Context-Rich**: Every function, class, and module should provide enough context for an LLM to understand its purpose, dependencies, and usage without needing to read other files.

2. **Architecture-Aware**: Include architectural patterns, design decisions, and system interactions in documentation.

3. **Example-Driven**: Provide concrete usage examples that show real-world scenarios.

4. **Error-Aware**: Document error conditions, edge cases, and failure modes.

5. **Evolution-Conscious**: Note deprecated patterns, migration paths, and future considerations.

---

## Custom JSDoc Tags

We extend standard JSDoc with custom tags optimized for LLM understanding:

### `@context`
Explains the broader system context where this code operates.

```javascript
/**
 * @context This service operates within the CosyWorld AI avatar system,
 * managing persistent memory for AI entities. It integrates with MongoDB
 * for storage and uses vector embeddings for semantic search. Memory is
 * hierarchical: short-term (last N messages), long-term (important events),
 * and emotional (relationship states).
 */
```

### `@architecture`
Documents architectural patterns, design decisions, and dependencies.

```javascript
/**
 * @architecture This class uses the Repository pattern to abstract database
 * operations. It's registered as a singleton in the Awilix DI container and
 * injected into services that need avatar data access. Uses MongoDB native
 * driver with manual ObjectId handling. No ORM layer.
 */
```

### `@lifecycle`
Explains initialization, startup, shutdown, and state management.

```javascript
/**
 * @lifecycle
 * 1. Constructor registers with DI container
 * 2. initialize() called during app startup, connects to DB
 * 3. Listens to 'avatar.created' events via eventBus
 * 4. cleanup() called on graceful shutdown
 */
```

### `@dataflow`
Describes how data flows through the system.

```javascript
/**
 * @dataflow
 * Discord Message → MessageHandler → ToolDecisionService → ToolExecutor
 * → [This Service] → AI Model → Response → Discord
 * Data is enriched at each step with context from memory, avatar state, etc.
 */
```

### `@example`
Always provide working examples with expected outputs.

```javascript
/**
 * @example
 * // Generate a chat response with structured output
 * const response = await openRouterService.generateStructuredOutput({
 *   prompt: "List 3 fantasy items with names and descriptions",
 *   schema: {
 *     type: "object",
 *     properties: {
 *       items: {
 *         type: "array",
 *         items: {
 *           type: "object",
 *           properties: {
 *             name: { type: "string" },
 *             description: { type: "string" }
 *           }
 *         }
 *       }
 *     }
 *   },
 *   options: { model: 'google/gemini-2.0-flash-exp:free' }
 * });
 * // Returns: { items: [{ name: "...", description: "..." }, ...] }
 */
```

### `@errors`
Document all error conditions and how to handle them.

```javascript
/**
 * @errors
 * - Throws `DatabaseConnectionError` if MongoDB is unavailable
 * - Throws `ValidationError` if avatar data fails schema validation
 * - Returns null if avatar not found (non-error case)
 * - Logs warning if avatar has incomplete data but continues
 */
```

### `@performance`
Note performance characteristics and optimization strategies.

```javascript
/**
 * @performance
 * - Time complexity: O(n log n) for fuzzy search across 300+ models
 * - Uses in-memory cache for model metadata (refreshed every 24h)
 * - Rate limited: 60 requests/minute per API key
 * - Consider batching requests if calling in loops
 */
```

### `@dependencies`
Explicitly list runtime dependencies and why they're needed.

```javascript
/**
 * @dependencies
 * - logger: Winston logger instance for structured logging
 * - databaseService: MongoDB connection manager
 * - configService: Application configuration (API keys, model defaults)
 * - aiModelService: Model registry and fuzzy matching
 * All injected via Awilix DI container, see src/container.mjs
 */
```

---

## Standard JSDoc Tags

Use these for all code:

- `@param` - All parameters with types and descriptions
- `@returns` - Return value with type and description
- `@throws` - All exceptions that can be thrown
- `@async` - Mark async functions
- `@deprecated` - Mark deprecated code with migration path
- `@see` - Link to related code or documentation
- `@since` - Version when feature was added
- `@todo` - Known issues or future improvements

---

## Documentation Templates

### Service Class

```javascript
/**
 * OpenRouterAIService
 * 
 * @context
 * Provides AI completion capabilities via OpenRouter's unified API. OpenRouter
 * aggregates 300+ AI models from providers like OpenAI, Anthropic, Google, and
 * Meta. This service handles model selection, fallback strategies, structured
 * output generation, and error handling.
 * 
 * @architecture
 * - Singleton service registered in Awilix DI container
 * - Uses OpenAI SDK with custom baseURL pointing to OpenRouter
 * - Model registry maintained by AIModelService for fuzzy matching
 * - Fallback chain: preferred model → closest match → random from tier
 * - Response format negotiation: json_schema → json_object → instructions
 * 
 * @lifecycle
 * 1. Constructor: Resolve config, initialize OpenAI client, register models
 * 2. ready: Async promise validating structured output support
 * 3. Runtime: Handle requests with automatic model selection and fallbacks
 * 4. No explicit shutdown needed (stateless HTTP client)
 * 
 * @dataflow
 * Tool Request → UnifiedAIService → [This Service] → OpenRouter API
 * → Provider (OpenAI/Google/etc.) → Response → Parse/Validate → Return
 * 
 * @dependencies
 * - logger: Structured logging (Winston)
 * - aiModelService: Model registry and fuzzy matching
 * - configService: API keys, default models, feature flags
 * 
 * @performance
 * - Rate limits vary by provider (typically 60-100 req/min)
 * - Caches model capability checks to avoid repeated API calls
 * - Structured output adds ~100-200ms latency vs plain text
 * 
 * @example
 * const service = container.resolve('openRouterAIService');
 * const response = await service.chat([
 *   { role: 'user', content: 'Hello!' }
 * ], { model: 'openai/gpt-4o-mini' });
 * console.log(response); // "Hello! How can I help you today?"
 */
export class OpenRouterAIService {
  /**
   * @param {Object} deps - Dependency injection container
   * @param {Logger} deps.logger - Winston logger instance
   * @param {AIModelService} deps.aiModelService - Model registry
   * @param {ConfigService} deps.configService - Application config
   */
  constructor({ logger, aiModelService, configService }) {
    // ...
  }
}
```

### Method Documentation

```javascript
/**
 * Generate structured JSON output from an AI model.
 * 
 * @description
 * Attempts to generate JSON matching the provided schema using OpenRouter's
 * response_format feature. Falls back through multiple strategies if the
 * model doesn't support structured output:
 * 1. json_schema (strict, OpenAI-compatible models)
 * 2. json_object (looser, more models support this)
 * 3. Instruction-based (system prompt with retries)
 * 
 * @context
 * Used by tool execution layer to generate structured data for game actions
 * (e.g., combat moves, item creation, avatar responses). Schema validation
 * ensures consistent data structure for downstream processing.
 * 
 * @async
 * @param {Object} config - Configuration object
 * @param {string} config.prompt - User prompt describing desired output
 * @param {Object} config.schema - JSON Schema (draft-07) for output structure
 * @param {Object} [config.options={}] - Additional chat options
 * @param {string} [config.options.model] - Override default structured model
 * @param {number} [config.options.temperature] - Creativity (0-2, default 0.9)
 * @param {number} [config.options.max_tokens] - Max response length
 * 
 * @returns {Promise<Object>} Parsed and validated JSON object matching schema
 * 
 * @throws {Error} If all fallback strategies fail or response is invalid
 * 
 * @errors
 * - 400: Model doesn't support structured output → auto fallback
 * - 401: Invalid API key → throws immediately
 * - 429: Rate limit → retries with exponential backoff
 * - 500: Provider error → tries fallback model if available
 * 
 * @performance
 * - Typical response time: 1-3 seconds
 * - json_schema adds ~200ms vs plain text
 * - Fallback attempts add 2-5 seconds total
 * - Consider caching for identical prompts
 * 
 * @example
 * // Generate combat move with structured output
 * const move = await openRouterService.generateStructuredOutput({
 *   prompt: "Avatar attacks with sword",
 *   schema: {
 *     type: "object",
 *     properties: {
 *       action: { type: "string", enum: ["attack", "defend", "move"] },
 *       target: { type: "string" },
 *       damage: { type: "number" }
 *     },
 *     required: ["action", "target"]
 *   },
 *   options: { 
 *     model: 'google/gemini-2.0-flash-exp:free',
 *     temperature: 0.7 
 *   }
 * });
 * // Returns: { action: "attack", target: "goblin", damage: 15 }
 * 
 * @example
 * // Handle errors gracefully
 * try {
 *   const result = await openRouterService.generateStructuredOutput({
 *     prompt: "Invalid request",
 *     schema: { type: "object" }
 *   });
 * } catch (err) {
 *   if (err.message.includes('Rate limit')) {
 *     // Wait and retry
 *     await new Promise(r => setTimeout(r, 5000));
 *   } else {
 *     // Log and use fallback logic
 *     logger.error('Structured output failed:', err);
 *   }
 * }
 * 
 * @see {@link chat} for unstructured text generation
 * @see {@link AIModelService#findClosestModel} for model selection logic
 * @since 0.0.9
 */
async generateStructuredOutput({ prompt, schema, options = {} }) {
  // ...
}
```

### Utility Function

```javascript
/**
 * Parse JSON from text with fuzzy extraction and retry logic.
 * 
 * @description
 * Extracts and parses the first valid JSON object from a text string.
 * Handles common edge cases like markdown code blocks, leading/trailing text,
 * and malformed JSON. Used primarily for parsing AI model responses that
 * should contain JSON but may have extra text.
 * 
 * @context
 * AI models often return JSON wrapped in markdown (```json...```) or with
 * explanatory text before/after. This function handles these cases gracefully.
 * Part of the fallback chain when response_format isn't available.
 * 
 * @param {string} text - Input text containing JSON (may have extra content)
 * @returns {Object|null} Parsed JSON object or null if no valid JSON found
 * 
 * @errors
 * - Returns null instead of throwing on invalid JSON
 * - Logs warnings for malformed JSON (doesn't throw)
 * - Empty string or null input returns null
 * 
 * @performance
 * - O(n) single pass through text
 * - Regex extraction is fast (<1ms for typical inputs)
 * - JSON.parse is native and optimized
 * 
 * @example
 * // Extract from markdown code block
 * const json = parseFirstJson('```json\n{"name": "test"}\n```');
 * console.log(json); // { name: "test" }
 * 
 * @example
 * // Handle AI response with extra text
 * const response = `
 *   Here's your data:
 *   {"items": [{"id": 1, "name": "sword"}]}
 *   Hope this helps!
 * `;
 * const data = parseFirstJson(response);
 * console.log(data.items[0].name); // "sword"
 * 
 * @example
 * // Graceful failure
 * const invalid = parseFirstJson("not json at all");
 * console.log(invalid); // null
 * 
 * @see {@link parseWithRetries} for retry wrapper
 * @since 0.0.8
 */
export function parseFirstJson(text) {
  // ...
}
```

### Configuration Object

```javascript
/**
 * AI Model Configuration
 * 
 * @description
 * Defines available AI models, their capabilities, pricing, and intelligence
 * tiers. Used by AIModelService for model selection and fallback strategies.
 * 
 * @context
 * CosyWorld uses a rarity-based tier system: Legendary > Rare > Uncommon > Common.
 * Each tier represents intelligence level, creativity, and reliability. Avatars
 * are assigned tiers based on their NFT rarity, which determines AI model access.
 * 
 * @architecture
 * - Exported as ES module, imported by AIModelService
 * - Models are grouped by provider (OpenRouter IDs use provider/model format)
 * - Tiers map to game rarity system (legendary = best, common = baseline)
 * - Pricing in USD per 1M tokens (input/output separately)
 * 
 * @dataflow
 * Config Export → AIModelService.registerModels() → Runtime Model Selection
 * → Model used for avatar responses based on tier
 * 
 * @example
 * // Access model config
 * import models from './models.openrouter.config.mjs';
 * const gpt4o = models.find(m => m.id === 'openai/gpt-4o');
 * console.log(gpt4o.tier); // "legendary"
 * console.log(gpt4o.pricing.input); // 0.0025 (per 1M tokens)
 * 
 * @see {@link AIModelService#getRandomModel}
 * @since 0.0.7
 */
export default [
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    tier: 'legendary',
    pricing: { input: 0.0025, output: 0.01 },
    contextWindow: 128000,
    capabilities: ['chat', 'vision', 'json_schema', 'function_calling'],
    provider: 'OpenAI'
  },
  // ... more models
];
```

---

## File Header Template

Every file should start with:

```javascript
/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file openrouterAIService.mjs
 * @description OpenRouter API integration for multi-model AI completions
 * @module services/ai
 * 
 * @context
 * This module is part of the AI service layer, providing unified access to
 * 300+ AI models through OpenRouter's aggregated API. It handles model
 * selection, structured output generation, and error recovery.
 * 
 * @architecture
 * - Layer: Service (abstracts external API calls)
 * - Pattern: Singleton service with dependency injection
 * - Dependencies: configService, aiModelService, logger
 * - Registry: Registered in src/container.mjs as 'openRouterAIService'
 * 
 * @see {@link https://openrouter.ai/docs} OpenRouter API Documentation
 * @see {@link AIModelService} for model selection logic
 * @see {@link UnifiedAIService} for provider-agnostic interface
 */
```

---

## Special Cases

### Event Handlers

```javascript
/**
 * Handle avatar creation events.
 * 
 * @listens eventBus#avatar.created
 * @param {Object} event - Event payload
 * @param {string} event.avatarId - UUID of newly created avatar
 * @param {Object} event.metadata - Avatar metadata (name, rarity, etc.)
 * 
 * @context
 * Triggered when a new avatar is minted or imported. Initializes memory
 * structures, sets up AI context, and registers with combat system.
 * 
 * @dataflow
 * Avatar Creation → Event Emitted → [This Handler] → Initialize Memory
 * → Register with Combat → Emit avatar.ready event
 * 
 * @example
 * eventBus.on('avatar.created', handleAvatarCreation);
 */
```

### Async Initialization

```javascript
/**
 * Initialize service with async operations.
 * 
 * @lifecycle
 * Called during app startup after database connection is established.
 * Must complete before service is considered ready for use.
 * 
 * @async
 * @returns {Promise<void>}
 * @throws {Error} If initialization fails (causes app startup failure)
 * 
 * @example
 * const service = container.resolve('toolService');
 * await service.initialize();
 * // Service is now ready for use
 */
async initialize() {
  // ...
}
```

---

## LLM-Specific Considerations

1. **Be Explicit**: Don't assume LLMs know project-specific terminology. Define terms like "avatar", "tier", "rarity", "tool" in context.

2. **Show Data Flow**: LLMs excel at understanding systems when you show how data moves through components.

3. **Include Edge Cases**: Document what happens when things go wrong, not just the happy path.

4. **Link Related Code**: Use `@see` tags to help LLMs discover related functionality.

5. **Provide Complete Examples**: Show imports, full function calls, and expected outputs. Partial examples confuse LLMs.

6. **Explain "Why" Not Just "What"**: Document design decisions and trade-offs.

---

## Validation Checklist

Before committing, ensure your documentation includes:

- [ ] File header with @file, @description, @module
- [ ] Class-level @context, @architecture, @lifecycle
- [ ] All public methods have @param, @returns, @throws
- [ ] At least one @example per public method
- [ ] Custom tags (@context, @architecture) where relevant
- [ ] Links to related code via @see
- [ ] Error conditions documented in @errors
- [ ] Performance notes for expensive operations
- [ ] Version info via @since for new features

---

## Tools and Generation

We use JSDoc 4.x for documentation generation:

```bash
# Generate HTML docs
npm run docs:generate

# Validate JSDoc comments
npm run docs:validate

# Check coverage
npm run docs:coverage
```

Configuration in `jsdoc.config.json`:

```json
{
  "source": {
    "include": ["src"],
    "includePattern": ".+\\.m?js$"
  },
  "plugins": ["plugins/markdown"],
  "templates": {
    "default": {
      "outputSourceFiles": true
    }
  },
  "opts": {
    "destination": "./docs/api",
    "recurse": true,
    "readme": "./docs/README.md"
  }
}
```

---

## Migration Guide

For existing undocumented code:

1. Start with file headers and class-level documentation
2. Add @context and @architecture to help LLMs understand the big picture
3. Document public APIs before private methods
4. Add examples to most-used functions first
5. Use git blame to find authors for unclear code
6. Mark uncertain documentation with @todo for review

---

## Examples from CosyWorld

See these files for reference implementations:

- `src/services/ai/openrouterAIService.mjs` - Comprehensive service documentation
- `src/utils/jsonParse.mjs` - Utility function documentation
- `src/models.openrouter.config.mjs` - Configuration documentation
- `src/container.mjs` - DI container and lifecycle documentation

---

**Last Updated**: October 2025  
**Maintained By**: CosyWorld Core Team  
**Questions?**: See `docs/CONTRIBUTING.md` or ask in Discord
