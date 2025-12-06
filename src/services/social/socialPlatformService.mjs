/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { EventEmitter } from 'events';
import { TelegramProvider } from './providers/telegramProvider.mjs';
import { XProvider } from './providers/xProvider.mjs';

/**
 * SocialPlatformService
 * 
 * Unified service for managing social platform integrations (Telegram, X, Discord).
 * Orchestrates per-avatar connections and delegates platform-specific logic to providers.
 */
export class SocialPlatformService extends EventEmitter {
  constructor({
    logger,
    databaseService,
    configService,
    secretsService,
    aiService,
    // Legacy services to be migrated/wrapped
    telegramService,
    xService,
    discordService
  }) {
    super();
    this.logger = logger;
    this.db = databaseService;
    this.config = configService;
    this.secrets = secretsService;
    this.ai = aiService;
    
    // Legacy services
    this.telegramService = telegramService;
    this.xService = xService;
    this.discordService = discordService;

    this.providers = new Map();
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    
    this.logger.info('Initializing SocialPlatformService...');
    
    // Initialize providers
    this.registerProvider('telegram', new TelegramProvider(this));
    this.registerProvider('x', new XProvider(this));
    
    await Promise.all([
      this.getProvider('telegram').initialize(),
      this.getProvider('x').initialize()
    ]);
    
    this.initialized = true;
    this.logger.info('SocialPlatformService initialized');
  }

  /**
   * Register a platform provider
   * @param {string} platformName 
   * @param {object} providerInstance 
   */
  registerProvider(platformName, providerInstance) {
    this.providers.set(platformName.toLowerCase(), providerInstance);
    this.logger.info(`Registered provider for platform: ${platformName}`);
  }

  /**
   * Get a provider by name
   * @param {string} platformName 
   * @returns {object|null}
   */
  getProvider(platformName) {
    return this.providers.get(platformName.toLowerCase()) || null;
  }
}
