/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file container.mjs
 * @description Dependency Injection Container for CosyWorld
 * @module core
 * 
 * @context
 * This is the central DI container for the entire CosyWorld application. It manages
 * the lifecycle of all services, handles dependency resolution, and ensures proper
 * initialization order. Uses Awilix for dependency injection with PROXY mode,
 * allowing circular dependencies to be resolved lazily.
 * 
 * The container initializes in phases:
 * 1. Core singletons (logger, secrets, config) created synchronously
 * 2. Explicit service registration in dependency order
 * 3. Dynamic auto-discovery and registration of remaining services
 * 4. Late-binding circular dependency resolution
 * 5. Post-initialization service wiring and event listener setup
 * 
 * @architecture
 * - Pattern: Dependency Injection Container (Awilix)
 * - Injection Mode: PROXY (lazy resolution for circular deps)
 * - Service Lifetime: Singleton (all services)
 * - Discovery: Auto-scans src/services/**\/*.mjs for classes
 * - Resolution Order: Core → Explicit → Dynamic → Late-binding
 * 
 * @lifecycle
 * 1. Module import: Synchronously creates logger, secrets, config
 * 2. containerReady promise: Async initialization of all services
 * 3. Runtime: Services resolved on-demand via container.resolve()
 * 4. Shutdown: No explicit cleanup (stateless services)
 * 
 * @dataflow
 * Application Startup → container.mjs import → Core services created
 * → containerReady promise → Dynamic service discovery → Service initialization
 * → index.mjs main() → Service.start() methods → Runtime
 * 
 * @dependencies
 * - awilix: DI container framework
 * - globby: File pattern matching for service discovery
 * - All service classes in src/services/
 * - eventBus: Global event emitter
 * 
 * @performance
 * - Container creation: <10ms synchronous
 * - Dynamic service loading: ~50-100ms depending on file count
 * - Service resolution: <1ms per service (cached after first resolve)
 * - Memory: ~5MB for all service instances
 * 
 * @example
 * // Import and wait for container initialization
 * import { container, containerReady } from './container.mjs';
 * await containerReady;
 * 
 * // Resolve services
 * const logger = container.resolve('logger');
 * const aiService = container.resolve('openrouterAIService');
 * 
 * @example
 * // Services inject dependencies automatically
 * class MyService {
 *   constructor({ logger, databaseService }) {
 *     this.logger = logger;
 *     this.db = databaseService;
 *   }
 * }
 * container.register({ myService: asClass(MyService).singleton() });
 * 
 * @see {@link https://github.com/jeffijoe/awilix} Awilix Documentation
 * @see {@link initializeContainer} for async initialization logic
 * @since 0.0.1
 */

import { createContainer, asClass, InjectionMode, asValue, asFunction } from 'awilix';
import { globby } from 'globby';
import path from 'path';
import { fileURLToPath } from 'url';

import { Logger } from './services/logger/logger.mjs';
import { ConfigService } from './services/foundation/configService.mjs';
import { CrossmintService } from './services/crossmint/crossmintService.mjs';
import { DatabaseService } from './services/foundation/databaseService.mjs';
import { DiscordService } from './services/social/discordService.mjs';
import { WebService } from './services/web/webService.mjs';
import { MessageHandler } from './services/chat/messageHandler.mjs';
import { ToolService } from './services/tools/ToolService.mjs';
import { AIModelService } from './services/ai/aiModelService.mjs';
import { ItemService } from './services/item/itemService.mjs';
import { GuildConnectionRepository } from './dal/GuildConnectionRepository.mjs';
import { publishEvent } from './events/envelope.mjs';
import { CombatNarrativeService } from './services/combat/CombatNarrativeService.mjs';
import { GoogleAIService } from './services/ai/googleAIService.mjs';
import { ResponseCoordinator } from './services/chat/responseCoordinator.mjs';
import { ToolSchemaGenerator } from './services/tools/toolSchemaGenerator.mjs';
import { ToolExecutor } from './services/tools/toolExecutor.mjs';
import { ToolDecisionService } from './services/tools/toolDecisionService.mjs';
import eventBus from './utils/eventBus.mjs';
import { SecretsService } from './services/security/secretsService.mjs';
import { EmbeddingService } from './services/memory/embeddingService.mjs';
import { MemoryScheduler } from './services/memory/memoryScheduler.mjs';
import { XService } from './services/social/xService.mjs';
import { PromptAssembler } from './services/ai/promptAssembler.mjs';
import { UnifiedAIService } from './services/ai/unifiedAIService.mjs';
import { validateEnv } from './config/validateEnv.mjs';
import { ensureEncryptionKey } from './utils/ensureEncryptionKey.mjs';

// Setup __dirname in ESM for dynamic service discovery
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Ensure encryption key exists before any secrets are loaded.
 * 
 * @context
 * CosyWorld stores sensitive configuration (API keys, tokens) encrypted in MongoDB.
 * The encryption key is stored in .env.encryption.key and must exist before the
 * SecretsService can decrypt stored values. This function creates a new random
 * key if one doesn't exist, allowing first-time setup to proceed.
 * 
 * @see {@link SecretsService} for encryption/decryption logic
 * @see {@link ensureEncryptionKey} in utils/ensureEncryptionKey.mjs
 * @since 0.0.11
 */
ensureEncryptionKey();

/**
 * The main Awilix dependency injection container.
 * 
 * @description
 * Configured with PROXY injection mode to handle circular dependencies gracefully.
 * Strict mode is enabled to catch typos and missing dependencies early. All services
 * are registered as singletons to ensure single instances throughout the application.
 * 
 * @type {AwilixContainer}
 * 
 * @property {InjectionMode.PROXY} injectionMode - Lazy resolution for circular deps
 * @property {boolean} strict - Throws errors for unregistered dependencies
 * 
 * @example
 * // Resolve a service from the container
 * const logger = container.resolve('logger');
 * logger.info('Hello from CosyWorld!');
 * 
 * @example
 * // Check if a service is registered
 * if (container.registrations.openrouterAIService) {
 *   const aiService = container.resolve('openrouterAIService');
 * }
 * 
 * @example
 * // List all registered services
 * console.log(Object.keys(container.registrations));
 * 
 * @see {@link https://github.com/jeffijoe/awilix#injectionmode} Injection Mode docs
 * @since 0.0.1
 */
export const container = createContainer({
  injectionMode: InjectionMode.PROXY,
  strict: true
});

/**
 * Register global event bus for pub/sub communication.
 * 
 * @context
 * The eventBus is a singleton EventEmitter used for decoupled communication
 * between services. Events like 'avatar.created', 'combat.started', etc. are
 * emitted by services and consumed by listeners without direct coupling.
 * 
 * @see {@link eventBus} in utils/eventBus.mjs
 * @since 0.0.1
 */
container.register({
  eventBus: asValue(eventBus)
});

/**
 * Initialize core services synchronously.
 * 
 * @description
 * These services must be available immediately for container initialization.
 * They're created outside the container and registered as values rather than
 * classes to ensure they exist before any dependent services are instantiated.
 * 
 * @context
 * - Logger: No dependencies, provides logging for all other services
 * - SecretsService: Depends on logger, manages encrypted API keys/tokens
 * - ConfigService: Depends on logger + secrets, loads config from MongoDB
 * 
 * The secrets service is pre-hydrated with environment variables so it can
 * decrypt values from MongoDB during containerReady initialization.
 * 
 * @see {@link Logger} for structured logging
 * @see {@link SecretsService} for encryption/decryption
 * @see {@link ConfigService} for configuration management
 * @since 0.0.1
 */
const logger        = new Logger();
const secretsService = new SecretsService({ logger });

// Hydrate secrets from environment variables for initial decryption capability
secretsService.hydrateFromEnv([
  'OPENROUTER_API_KEY','OPENROUTER_API_TOKEN','GOOGLE_API_KEY','GOOGLE_AI_API_KEY',
  'REPLICATE_API_TOKEN','MONGO_URI','DISCORD_BOT_TOKEN','DISCORD_CLIENT_ID',
]);

const configService = new ConfigService({ logger, secretsService });

// Pre-register core values; other services will be loaded during containerReady
container.register({
  logger:        asValue(logger),
  secretsService: asValue(secretsService),
  configService: asValue(configService),
  // Keep ItemService explicit as an example singleton
  itemService: asClass(ItemService).singleton(),
  guildConnectionRepository: asClass(GuildConnectionRepository).singleton()
});

/**
 * Register event publisher for dependency injection.
 * 
 * @description
 * Provides a wrapper around the publishEvent function that can be injected into
 * services. This abstraction allows future enhancement (tracing, buffering, external
 * message bus integration) without changing dependent services.
 * 
 * @context
 * Some services need to publish events but don't need full eventBus functionality.
 * This lightweight wrapper provides just the publishEvent function for cleaner
 * dependency injection.
 * 
 * @example
 * class MyService {
 *   constructor({ eventPublisher }) {
 *     this.publish = eventPublisher.publishEvent;
 *   }
 *   async doSomething() {
 *     await this.publish('my.event', { data: 'value' });
 *   }
 * }
 * 
 * @see {@link publishEvent} in events/envelope.mjs
 * @since 0.0.9
 */
container.register({
  eventPublisher: asFunction(() => ({ publishEvent })).singleton()
});

/**
 * Register CombatNarrativeService early for event listener setup.
 * 
 * @context
 * The narrative service listens to combat events and generates descriptive text.
 * It must be registered before other combat services initialize so it can attach
 * listeners when they emit events during initialization.
 * 
 * @see {@link CombatNarrativeService} for combat narration logic
 * @since 0.0.8
 */
container.register({ combatNarrativeService: asClass(CombatNarrativeService).singleton() });

/**
 * Make the container itself available for injection.
 * 
 * @description
 * Registered as 'services', allows services to access the full container for
 * dynamic service resolution. Useful for late-binding and plugin architectures.
 * 
 * @context
 * Some services need to resolve other services dynamically at runtime rather
 * than constructor injection. This is rare but necessary for circular dependencies
 * and plugin systems where the full set of services isn't known at construction time.
 * 
 * @example
 * class PluginLoader {
 *   constructor({ services }) {
 *     this.container = services;
 *   }
 *   async loadPlugin(name) {
 *     return this.container.resolve(name);
 *   }
 * }
 * 
 * @caution Use sparingly - prefer constructor injection for testability
 * @since 0.0.5
 */
container.register({ services: asValue(container) });

/**
 * Initialize the dependency injection container asynchronously.
 * 
 * @description
 * This function orchestrates the complete initialization of the CosyWorld service
 * architecture. It runs asynchronously to avoid top-level await issues and allows
 * the application to start even if some optional services fail to initialize.
 * 
 * @context
 * Called immediately upon module import (exported as containerReady promise).
 * Services that depend on the container being ready should await containerReady
 * before attempting to resolve dependencies. The initialization sequence is
 * carefully ordered to respect service dependencies.
 * 
 * @architecture
 * Phase 1: Core Services (logger, secrets, config)
 * Phase 2: Foundation Services (database, AI models)
 * Phase 3: Business Logic Services (tools, combat, chat)
 * Phase 4: Integration Services (Discord, web server)
 * Phase 5: Dynamic Service Discovery (auto-scan src/services/)
 * Phase 6: Late-binding Circular Dependencies (getters/proxies)
 * Phase 7: Post-initialization Wiring (event listeners, injections)
 * 
 * @lifecycle
 * 1. Validate environment variables (non-blocking warnings)
 * 2. Load encrypted config from MongoDB
 * 3. Initialize optional Google AI service if API key present
 * 4. Register Crossmint NFT service
 * 5. Register core services in dependency order
 * 6. Auto-discover and register services from src/services/
 * 7. Create aiService alias (prefers OpenRouter > Ollama > Google)
 * 8. Set up late-binding getters to break circular dependencies
 * 9. Initialize UnifiedAIService wrapping best available provider
 * 10. Start event listeners (e.g., CombatNarrativeService)
 * 11. Wire post-initialization injections (e.g., s3Service → googleAIService)
 * 
 * @dataflow
 * module import → initializeContainer() → validateEnv → configService.loadConfig()
 * → register core services → dynamic service discovery → late-binding setup
 * → event listener registration → containerReady resolves → main() continues
 * 
 * @async
 * @returns {Promise<void>}
 * 
 * @errors
 * - Logs warnings for missing optional services (doesn't throw)
 * - Logs errors for service registration failures (continues)
 * - Throws only for critical failures (database, core services)
 * 
 * @performance
 * - Total initialization time: 500-1000ms (includes DB connection)
 * - Service discovery: ~50-100ms (depends on file count)
 * - Most time spent in configService.loadConfig() waiting for MongoDB
 * 
 * @example
 * // Wait for container initialization before using services
 * import { containerReady } from './container.mjs';
 * 
 * async function main() {
 *   await containerReady;
 *   console.log('All services initialized and ready!');
 * }
 * 
 * @example
 * // Container initialization errors are logged but don't stop the app
 * // This allows the config wizard to run even without full setup
 * await containerReady; // May have warnings but will resolve
 * 
 * @see {@link container} for the Awilix container instance
 * @see {@link ConfigService#loadConfig} for configuration loading
 * @see {@link validateEnv} for environment validation
 * @since 0.0.1
 */
async function initializeContainer() {
  try { validateEnv(logger); } catch (e) { logger.error('[container] Env validation threw:', e.message); }
  await configService.loadConfig();

  // Optional secondary Google AI service
  let googleAIService = null;
  let unifiedAIService = null;
  try {
    const googleApiKey = process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY;
    if (googleApiKey) {
      googleAIService = new GoogleAIService({ configService, s3Service: null });
      container.register({ googleAIService: asValue(googleAIService) });
    }
  } catch (e) {
    console.warn('[container] Failed to init optional GoogleAIService:', e.message);
  }

  // Precreate crossmint as value; dynamic loader may also provide class, so guard duplicates
  const crossmintService = new CrossmintService({ logger });
  container.register({ crossmintService: asValue(crossmintService) });

  // Explicitly register core services in a known order
  container.register({
    databaseService: asClass(DatabaseService).singleton(),
    aiModelService: asClass(AIModelService).singleton(),
    xService: asClass(XService).singleton(),
    toolService: asClass(ToolService).singleton(),
    toolSchemaGenerator: asClass(ToolSchemaGenerator).singleton(),
    toolDecisionService: asClass(ToolDecisionService).singleton(),
    toolExecutor: asClass(ToolExecutor).singleton(),
    discordService: asClass(DiscordService).singleton(),
    responseCoordinator: asClass(ResponseCoordinator).singleton(),
    messageHandler: asClass(MessageHandler).singleton(),
  webService: asClass(WebService).singleton(),
  embeddingService: asClass(EmbeddingService).singleton(),
  memoryScheduler: asClass(MemoryScheduler).singleton()
  });

  // Dynamically register remaining services
  const servicePaths = await globby(['./services/**/*.mjs'], {
    cwd: __dirname,
    absolute: true,
    followSymbolicLinks: true,
  });

  for (const file of servicePaths) {
    try {
      const mod = await import(file);
      // Only consider class exports; skip pure function/object utilities
      const isClass = (v) => typeof v === 'function' && /^\s*class\s/.test(v.toString());
      const exportsArray = Object.entries(mod);
      const defaultIsClass = isClass(mod.default);
      const namedClass = exportsArray.map(([, v]) => v).find(isClass);
      const ServiceClass = defaultIsClass ? mod.default : namedClass;
      if (!ServiceClass) continue; // skip modules that don't export a class
      const fileName = path.basename(file, '.mjs');
      const camelName = fileName.charAt(0).toLowerCase() + fileName.slice(1);
  // Skip registering if a value already exists with same name (honor core order)
  if (container.registrations[camelName]) continue;
      container.register(camelName, asClass(ServiceClass).singleton());
    } catch (err) {
      console.error(`Failed to register service from ${file}:`, err);
    }
  }

  // Provide a stable alias 'aiService' that prefers OpenRouter for all chat/text,
  // while still allowing Google to be used separately for media generation fallback.
  try {
    if (container.registrations.openrouterAIService) {
      const openrouterAIService = container.resolve('openrouterAIService');
      if (openrouterAIService?.ready) await openrouterAIService.ready;
      container.register({ aiService: asValue(openrouterAIService) });
    } else if (container.registrations.ollamaAIService) {
      container.register({ aiService: asValue(container.resolve('ollamaAIService')) });
    } else if (container.registrations.googleAIService) {
      container.register({ aiService: asValue(container.resolve('googleAIService')) });
    }
  } catch (e) {
    console.warn('[container] Failed to set aiService alias:', e.message);
  }

  // Provide late-binding getters early to break circular deps before resolving any dependents
  container.register({ getMapService: asFunction(() => () => container.resolve('mapService')).singleton() });
  // Provide late-binding getter for ConversationManager to break circular deps (combat -> CM -> prompt -> tool -> combat)
  container.register({ getConversationManager: asFunction(() => () => container.resolve('conversationManager')).singleton() });

  // Late-binding unifiedAIService if not already registered (after dynamic services loaded)
  try {
    // Always bind unifiedAIService to the best available chat provider, preferring OpenRouter.
  const preferred = ['openrouterAIService','ollamaAIService','googleAIService'];
    let wrappedName = null;
    for (const name of preferred) {
      if (container.registrations[name]) { wrappedName = name; break; }
    }
    if (wrappedName) {
      const base = container.resolve(wrappedName);
      if (wrappedName === 'openrouterAIService' && base?.ready) await base.ready;
      unifiedAIService = new UnifiedAIService({ aiService: base, logger, configService });
      // Overwrite any previous registration to ensure correct provider
      container.register({ unifiedAIService: asValue(unifiedAIService) });
      console.log('[container] Registered unifiedAIService wrapping', wrappedName);
  // If decisionMaker already instantiated, inject adapter reference
      try {
        if (container.registrations.decisionMaker && container.cradle.decisionMaker) {
          container.cradle.decisionMaker.unifiedAIService = unifiedAIService;
          console.log('[container] Injected unifiedAIService into existing decisionMaker instance.');
        }
      } catch (e) {
        console.warn('[container] Failed to inject unifiedAIService into decisionMaker:', e.message);
      }
    }
  } catch (e) {
    console.warn('[container] Failed late unifiedAIService init:', e.message);
  }

  console.log('🔧 registered services:', Object.keys(container.registrations));

  // Start combat narrative listeners (defer until after services are registered so dependencies resolve)
  try {
    if (container.registrations.combatNarrativeService) {
      const narr = container.resolve('combatNarrativeService');
      narr.start();
      console.log('[container] CombatNarrativeService started.');
    }
  } catch (e) {
    console.warn('[container] Failed to start CombatNarrativeService:', e.message);
  }

  // Late bind s3Service into optional googleAIService
  try {
    if (googleAIService && container.registrations.s3Service) {
      const s3Service = container.resolve('s3Service');
      if (s3Service && !googleAIService.s3Service) {
        googleAIService.s3Service = s3Service;
        console.log('[container] Injected s3Service into googleAIService for image generation fallback.');
      }
    }
  } catch (e) {
    console.warn('[container] Failed post-injection for googleAIService:', e.message);
  }
}

/**
 * Promise that resolves when all services are initialized and ready.
 * 
 * @description
 * This promise resolves after all phases of container initialization complete:
 * - Core services created
 * - Configuration loaded from MongoDB
 * - All services registered (explicit + dynamic)
 * - Circular dependencies resolved
 * - Event listeners attached
 * - Post-initialization wiring complete
 * 
 * @type {Promise<void>}
 * 
 * @context
 * The main application entry point (index.mjs) awaits this promise before starting
 * Discord bot, web server, and other runtime components. Services can also await
 * this if they need the full container to be ready before initialization.
 * 
 * @example
 * import { containerReady } from './container.mjs';
 * 
 * async function main() {
 *   await containerReady;
 *   console.log('Container ready, starting application...');
 * }
 * 
 * @example
 * // Check if container is ready (non-blocking)
 * containerReady.then(() => {
 *   console.log('Services initialized!');
 * }).catch(err => {
 *   console.error('Container initialization failed:', err);
 * });
 * 
 * @see {@link initializeContainer} for initialization logic
 * @since 0.0.1
 */
export const containerReady = initializeContainer();

/**
 * Register PromptAssembler for AI prompt construction.
 * 
 * @description
 * PromptAssembler builds context-rich prompts for AI models by combining:
 * - Avatar personality and backstory
 * - Conversation history from memory
 * - Current location and nearby entities
 * - Active quests and objectives
 * - Tool schemas and usage examples
 * 
 * Registered as a factory function to ensure dependencies are resolved correctly.
 * 
 * @context
 * The PromptAssembler is used by ToolDecisionService, ResponseCoordinator, and
 * other services that need to construct prompts for AI models. It centralizes
 * prompt engineering logic and ensures consistent context across all AI interactions.
 * 
 * @see {@link PromptAssembler} for prompt construction logic
 * @since 0.0.10
 */
container.register({
  promptAssembler: asFunction(({ logger, memoryService, configService }) => 
    new PromptAssembler({ logger, memoryService, configService })
  ).singleton(),
});
