/**
 * Core DI container setup for CosyWorld.
 *
 * This module owns:
 * - Creating the Awilix container
 * - Registering the global eventBus
 * - Instantiating and registering core singleton values (logger, secretsService, configService)
 * - Pre-registering a few foundational singletons that must exist before async init
 */

import { createContainer, asClass, InjectionMode, asValue } from 'awilix';

import eventBus from '../utils/eventBus.mjs';
import { ensureEncryptionKey } from '../utils/ensureEncryptionKey.mjs';

import { Logger } from '../services/logger/logger.mjs';
import { SecretsService } from '../services/security/secretsService.mjs';
import { ConfigService } from '../services/foundation/configService.mjs';

import { ItemService } from '../services/item/itemService.mjs';
import { GuildConnectionRepository } from '../dal/GuildConnectionRepository.mjs';

ensureEncryptionKey();

export const container = createContainer({
  injectionMode: InjectionMode.PROXY,
  strict: true,
});

container.register({
  eventBus: asValue(eventBus),
});

const logger = new Logger();
const secretsService = new SecretsService({ logger });

secretsService.hydrateFromEnv([
  'OPENROUTER_API_KEY',
  'OPENROUTER_API_TOKEN',
  'GOOGLE_API_KEY',
  'GOOGLE_AI_API_KEY',
  'REPLICATE_API_TOKEN',
  'MONGO_URI',
  'DISCORD_BOT_TOKEN',
  'DISCORD_CLIENT_ID',
]);

const configService = new ConfigService({ logger, secretsService });

container.register({
  container: asValue(container),
  logger: asValue(logger),
  secretsService: asValue(secretsService),
  configService: asValue(configService),

  // Keep a couple of foundational singletons explicit.
  itemService: asClass(ItemService).singleton(),
  guildConnectionRepository: asClass(GuildConnectionRepository).singleton(),
});

export { logger, secretsService, configService };
