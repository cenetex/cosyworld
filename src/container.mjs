/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
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
import eventBus from './utils/eventBus.mjs';
import { SecretsService } from './services/security/secretsService.mjs';
import { EmbeddingService } from './services/memory/embeddingService.mjs';
import { MemoryScheduler } from './services/memory/memoryScheduler.mjs';
import { PromptAssembler } from './services/ai/promptAssembler.mjs';
import { UnifiedAIService } from './services/ai/unifiedAIService.mjs';
import { validateEnv } from './config/validateEnv.mjs';
import DoginalCollectionService from './services/doge/doginalCollectionService.mjs';

// Setup __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


export const container = createContainer({
  injectionMode: InjectionMode.PROXY,
  strict: true
});

// Register utilities
container.register({
  eventBus: asValue(eventBus)
});

// Core singletons created synchronously
const logger        = new Logger();
const secretsService = new SecretsService({ logger });
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

// Provide a lightweight eventPublisher wrapper for services that expect an injected publisher.
// This can later be expanded (e.g., to add tracing, buffering, or external bus forwarding) without changing dependents.
container.register({
  eventPublisher: asFunction(() => ({ publishEvent })).singleton()
});

// Register narrative service early so it can attach listeners after combat services load
container.register({ combatNarrativeService: asClass(CombatNarrativeService).singleton() });

// Make the container available for injection under the name 'services'
container.register({ services: asValue(container) });

// Async initialization to avoid top-level await issues
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
    toolService: asClass(ToolService).singleton(),
    toolSchemaGenerator: asClass(ToolSchemaGenerator).singleton(),
    toolExecutor: asClass(ToolExecutor).singleton(),
    discordService: asClass(DiscordService).singleton(),
    responseCoordinator: asClass(ResponseCoordinator).singleton(),
    messageHandler: asClass(MessageHandler).singleton(),
  webService: asClass(WebService).singleton(),
  embeddingService: asClass(EmbeddingService).singleton(),
  memoryScheduler: asClass(MemoryScheduler).singleton(),
  doginalCollectionService: asClass(DoginalCollectionService).singleton(),
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

export const containerReady = initializeContainer();

// Register PromptAssembler in the container and expose it to PromptService.
container.register({
  promptAssembler: asFunction(({ logger, memoryService, configService }) => new PromptAssembler({ logger, memoryService, configService })).singleton(),
});
