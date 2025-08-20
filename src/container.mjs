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
import { GoogleAIService } from './services/ai/googleAIService.mjs';
import eventBus from './utils/eventBus.mjs';
import { SecretsService } from './services/security/secretsService.mjs';
import { EmbeddingService } from './services/memory/embeddingService.mjs';
import { MemoryScheduler } from './services/memory/memoryScheduler.mjs';
import { PromptAssembler } from './services/ai/promptAssembler.mjs';
import { UnifiedAIService } from './services/ai/unifiedAIService.mjs';

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
  itemService: asClass(ItemService).singleton()
});

// Make the container available for injection under the name 'services'
container.register({ services: asValue(container) });

// Async initialization to avoid top-level await issues
async function initializeContainer() {
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

  // Wrap primary aiService (whichever provider class dynamic loader registers) with UnifiedAIService once base provider is available.
  try {
    // The dynamic service registration will later register something like openrouterAIService, googleAIService, etc.
    // We attempt a late binding after dynamic registration below if not yet present here.
    // For early minimal functionality, try to locate a base provider now if already registered.
    const candidateNames = ['openrouterAIService','googleAIService','ollamaAIService','aiService'];
    for (const name of candidateNames) {
      if (container.registrations[name]) {
        const base = container.resolve(name);
        unifiedAIService = new UnifiedAIService({ aiService: base, logger });
        container.register({ unifiedAIService: asValue(unifiedAIService) });
        break;
      }
    }
  } catch (e) {
    console.warn('[container] Failed early unifiedAIService init:', e.message);
  }

  // Precreate crossmint as value; dynamic loader may also provide class, so guard duplicates
  const crossmintService = new CrossmintService({ logger });
  container.register({ crossmintService: asValue(crossmintService) });

  // Explicitly register core services in a known order
  container.register({
    databaseService: asClass(DatabaseService).singleton(),
    aiModelService: asClass(AIModelService).singleton(),
    toolService: asClass(ToolService).singleton(),
    discordService: asClass(DiscordService).singleton(),
    messageHandler: asClass(MessageHandler).singleton(),
  webService: asClass(WebService).singleton(),
  embeddingService: asClass(EmbeddingService).singleton(),
  memoryScheduler: asClass(MemoryScheduler).singleton(),
  });

  // Dynamically register remaining services
  const servicePaths = await globby('./services/**/*.mjs', {
    cwd: __dirname,
    absolute: true,
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

  // Late-binding unifiedAIService if not already registered (after dynamic services loaded)
  try {
    if (!container.registrations.unifiedAIService) {
      const candidateNames = ['openrouterAIService','googleAIService','ollamaAIService'];
      for (const name of candidateNames) {
        if (container.registrations[name]) {
          const base = container.resolve(name);
          unifiedAIService = new UnifiedAIService({ aiService: base, logger, configService });
          container.register({ unifiedAIService: asValue(unifiedAIService) });
          console.log('[container] Registered unifiedAIService wrapping', name);
          // If decisionMaker already instantiated, inject adapter reference
          try {
            if (container.registrations.decisionMaker && container.cradle.decisionMaker) {
              container.cradle.decisionMaker.unifiedAIService = unifiedAIService;
              console.log('[container] Injected unifiedAIService into existing decisionMaker instance.');
            }
          } catch (e) {
            console.warn('[container] Failed to inject unifiedAIService into decisionMaker:', e.message);
          }
          break;
        }
      }
    }
  } catch (e) {
    console.warn('[container] Failed late unifiedAIService init:', e.message);
  }

  // Provide late-binding getter for MapService to break circular deps
  container.register({ getMapService: asFunction(() => () => container.resolve('mapService')).singleton() });

  console.log('🔧 registered services:', Object.keys(container.registrations));

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
