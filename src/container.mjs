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
import { ItemService } from './services/item/itemService.mjs';
import { GoogleAIService } from './services/ai/googleAIService.mjs';
import eventBus from './utils/eventBus.mjs';
import { SecretsService } from './services/security/secretsService.mjs';

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
      // Skip registering if a value already exists with same name
      if (container.registrations[camelName]) continue;
      container.register(camelName, asClass(ServiceClass).singleton());
    } catch (err) {
      console.error(`Failed to register service from ${file}:`, err);
    }
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
