import { createContainer, asClass, InjectionMode, asValue, asFunction } from 'awilix';
import { globby } from 'globby';
import path from 'path';
import { fileURLToPath } from 'url';

import { Logger } from './services/logger/logger.mjs';
import { ConfigService } from './services/foundation/configService.mjs';
import { CrossmintService } from './services/crossmint/crossmintService.mjs';
import { ItemService } from './services/item/itemService.mjs';

// Setup __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


export const container = createContainer({
  injectionMode: InjectionMode.PROXY,
  strict: true
});

// --- instantiate once ---
const logger        = new Logger();               
const configService = new ConfigService({ logger });
const crossmintService = new CrossmintService({ logger });
const aiModelService = new (await import('./services/ai/aiModelService.mjs')).AIModelService;


// --- value‑register them ---
container.register({
  logger:        asValue(logger),
  configService: asValue(configService),
  crossmintService: asValue(crossmintService),
  aiModelService: asValue(aiModelService),
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
