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

// --- instantiate once ---
const logger        = new Logger();               
const secretsService = new SecretsService({ logger });
// Preload known secret keys from env (kept only encryption key in env per plan)
secretsService.hydrateFromEnv([
  'OPENROUTER_API_KEY','OPENROUTER_API_TOKEN','GOOGLE_API_KEY','GOOGLE_AI_API_KEY',
  'REPLICATE_API_TOKEN','MONGO_URI','DISCORD_BOT_TOKEN','DISCORD_CLIENT_ID',
]);
const configService = new ConfigService({ logger });
const crossmintService = new CrossmintService({ logger });
const aiModelService = new (await import('./services/ai/aiModelService.mjs')).AIModelService;
// Optional secondary Google AI service (for image/video) even if primary AI_SERVICE is not google
let googleAIService = null;
try {
  const googleApiKey = process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY;
  if (googleApiKey) {
    googleAIService = new GoogleAIService({ configService, s3Service: null });
  }
} catch (e) {
  console.warn('[container] Failed to init optional GoogleAIService:', e.message);
}


// --- value‑register them ---
container.register({
  logger:        asValue(logger),
  secretsService: asValue(secretsService),
  configService: asValue(configService),
  crossmintService: asValue(crossmintService),
  aiModelService: asValue(aiModelService),
  googleAIService: asValue(googleAIService),
  itemService: asClass(ItemService).singleton()
});

// Make the container available for injection under the name 'services'
container.register({ services: asValue(container) });

// Find all service files
const servicePaths = await globby('./services/**/*.mjs', {
  cwd: __dirname,
  absolute: true,
});

// Dynamically import and register each service
for (const file of servicePaths) {
  try {
    const mod = await import(file);

    // Find the default or first named export that is a class
    const ServiceClass = mod.default || Object.values(mod).find(
      (val) => typeof val === 'function' && /^\s*class\s/.test(val.toString())
    );

    if (!ServiceClass) continue;

    // Derive the registration name from filename
    const fileName = path.basename(file, '.mjs');
    const camelName = fileName.charAt(0).toLowerCase() + fileName.slice(1);

    container.register(camelName, asClass(ServiceClass).singleton());
  } catch (err) {
    console.error(`Failed to register service from ${file}:`, err);
  }
}

// Provide a late-binding getter for MapService to break circular dependencies
container.register({
  getMapService: asFunction(() => () => container.resolve('mapService')).singleton()
});

console.log('🔧 registered services:', Object.keys(container.registrations));

// Late bind s3Service into optional googleAIService if both exist
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
