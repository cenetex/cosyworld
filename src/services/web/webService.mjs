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
    veoService,
    xService,
    telegramService,
    secretsService,
    setupStatusService,
    promptService,
    globalBotService,
    // Story system services
    storyStateService,
    worldContextService,
    narrativeGeneratorService,
    storyPlannerService,
    storySchedulerService,
    storyPostingService,
    storyArchiveService,
    // NFT services
    nftMetadataService,
    arweaveService,
    // Payment services
    x402Service,
    agentWalletService,
    pricingService,
    marketplaceService,
  }) {
    this.logger = logger || console;
    this.configService = configService;
    this.databaseService = databaseService;
    this.discordService = discordService;
    this.s3Service = s3Service;
    this.aiModelService = aiModelService;
    this.aiService = aiService;
    this.openrouterAIService = openrouterAIService;
    this.veoService = veoService;
    this.xService = xService;
    this.telegramService = telegramService;
    this.secretsService = secretsService;
    this.setupStatusService = setupStatusService;
    this.promptService = promptService;
    this.globalBotService = globalBotService;
    // Story system
    this.storyStateService = storyStateService;
    this.worldContextService = worldContextService;
    this.narrativeGeneratorService = narrativeGeneratorService;
    this.storyPlannerService = storyPlannerService;
    this.storySchedulerService = storySchedulerService;
    this.storyPostingService = storyPostingService;
  this.storyArchiveService = storyArchiveService;
    // NFT services
    this.nftMetadataService = nftMetadataService;
    this.arweaveService = arweaveService;
    // Payment services
    this.x402Service = x402Service;
    this.agentWalletService = agentWalletService;
    this.pricingService = pricingService;
    this.marketplaceService = marketplaceService;

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
      veoService: this.veoService,
      xService: this.xService,
      telegramService: this.telegramService,
      secretsService: this.secretsService,
      setupStatusService: this.setupStatusService,
      promptService: this.promptService,
      globalBotService: this.globalBotService,
      // Story system services
      storyStateService: this.storyStateService,
      worldContextService: this.worldContextService,
      narrativeGeneratorService: this.narrativeGeneratorService,
      storyPlannerService: this.storyPlannerService,
      storySchedulerService: this.storySchedulerService,
      storyPostingService: this.storyPostingService,
      storyArchiveService: this.storyArchiveService,
      // NFT services
      nftMetadataService: this.nftMetadataService,
      arweaveService: this.arweaveService,
      // Payment services
      x402Service: this.x402Service,
      agentWalletService: this.agentWalletService,
      pricingService: this.pricingService,
      marketplaceService: this.marketplaceService,
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
