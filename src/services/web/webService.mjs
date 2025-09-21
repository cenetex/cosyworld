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
    xService,
    secretsService,
    doginalCollectionService,
  }) {
    this.logger = logger || console;
    this.configService = configService;
    this.databaseService = databaseService;
    this.discordService = discordService;
    this.s3Service = s3Service;
    this.aiModelService = aiModelService;
    this.xService = xService;
    this.secretsService = secretsService;
    this.doginalCollectionService = doginalCollectionService;

    this.started = false;

    // Initialize services
    this.services = {
      logger: this.logger,
      configService: this.configService,
      databaseService: this.databaseService,
      discordService: this.discordService,
      s3Service: this.s3Service,
      aiModelService: this.aiModelService,
      xService: this.xService,
      secretsService: this.secretsService,
      doginalCollectionService: this.doginalCollectionService,
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
