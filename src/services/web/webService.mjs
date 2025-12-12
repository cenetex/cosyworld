/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import initializeApp from './server/app.js';

export class WebService {
  constructor({
    logger,
    configService,
    databaseService,
    // The DI container itself (registered as `services` for historical reasons).
    services,
  }) {
    this.logger = logger || console;
    this.configService = configService;
    this.databaseService = databaseService;

    this.container = services;

    this.started = false;

    this.services = this.#createServicesFacade();
  }

  #createServicesFacade() {
    const container = this.container;
    const base = {
      logger: this.logger,
      configService: this.configService,
      databaseService: this.databaseService,

      // Preserve historical access to the full container.
      services: container,
    };

    // Lazy resolve services on property access to avoid a giant constructor
    // and keep the web layer decoupled from the full dependency graph.
    return new Proxy(base, {
      get: (target, prop) => {
        if (prop in target) return target[prop];
        if (!container || typeof prop !== 'string') return undefined;

        // Back-compat aliases
        if (prop === 'openRouterAIService') {
          return container.registrations.openrouterAIService
            ? container.resolve('openrouterAIService')
            : undefined;
        }
        if (prop === 'openrouterAIService') {
          return container.registrations.openrouterAIService
            ? container.resolve('openrouterAIService')
            : undefined;
        }
        if (prop === 'aiService') {
          return container.registrations.aiService ? container.resolve('aiService') : undefined;
        }

        if (container.registrations[prop]) {
          return container.resolve(prop);
        }

        return undefined;
      },
    });
  }

  async start() {
    try {
      this.logger.info('Starting WebService...');
      
      // Initialize marketplace service registry
      const marketplaceServiceRegistry = this.services.marketplaceServiceRegistry;
      if (marketplaceServiceRegistry) {
        this.logger.info('Initializing marketplace service registry...');
        await marketplaceServiceRegistry.initialize();
        this.logger.info('Marketplace service registry initialized successfully.');
      }
      
      await initializeApp(this.services);
      this.logger.info('WebService started successfully.');
    } catch (error) {
      this.logger.error('Failed to start WebService:', error);
      throw error;
    }
  }

  async stop() {
    try {
      this.logger.info('Stopping WebService...');
      // Perform any cleanup if necessary
      this.logger.info('WebService stopped successfully.');
    } catch (error) {
      this.logger.error('Failed to stop WebService:', error);
      throw error;
    }
  }
}
