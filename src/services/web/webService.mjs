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
    discordService,
    s3Service,
    aiModelService,
    // Provide AI services for downstream consumers (global X poster needs analyzeImage)
    aiService,
    openrouterAIService,
    xService,
    secretsService,
    setupStatusService,
    promptService,
    globalBotService,
  }) {
    this.logger = logger || console;
    this.configService = configService;
    this.databaseService = databaseService;
    this.discordService = discordService;
    this.s3Service = s3Service;
    this.aiModelService = aiModelService;
    this.aiService = aiService;
    this.openrouterAIService = openrouterAIService;
    this.xService = xService;
    this.secretsService = secretsService;
    this.setupStatusService = setupStatusService;
    this.promptService = promptService;
    this.globalBotService = globalBotService;

    this.started = false;

    // Initialize services
    this.services = {
      logger: this.logger,
      configService: this.configService,
      databaseService: this.databaseService,
      discordService: this.discordService,
      s3Service: this.s3Service,
      aiModelService: this.aiModelService,
      // Expose both alias and concrete provider; keep a camelCase alias for backward compat
      aiService: this.aiService || this.openrouterAIService,
      openrouterAIService: this.openrouterAIService,
      // Back-compat for modules referencing openRouterAIService (note the capital R)
      openRouterAIService: this.openrouterAIService,
      xService: this.xService,
      secretsService: this.secretsService,
      setupStatusService: this.setupStatusService,
      promptService: this.promptService,
      globalBotService: this.globalBotService,
    };
  }

  async start() {
    try {
      this.logger.info('Starting WebService...');
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
