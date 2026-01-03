/**
 * Async container initialization.
 *
 * Kept separate from `src/container.mjs` to avoid a single "god container" file.
 * This should not change runtime behavior.
 */

import { asClass, asFunction, asValue } from 'awilix';
import { globby } from 'globby';
import path from 'path';
import { fileURLToPath } from 'url';

import { validateEnv } from '../config/validateEnv.mjs';

import { CrossmintService } from '../services/crossmint/crossmintService.mjs';
import { DatabaseService } from '../services/foundation/databaseService.mjs';
import { DiscordService } from '../services/social/discordService.mjs';
import { BuybotService } from '../services/social/buybotService.mjs';
import { WebService } from '../services/web/webService.mjs';
import { MessageHandler } from '../services/chat/messageHandler.mjs';
import { ToolService } from '../services/tools/ToolService.mjs';
import { AIModelService } from '../services/ai/aiModelService.mjs';
import { CombatNarrativeService } from '../services/combat/CombatNarrativeService.mjs';
import { GoogleAIService } from '../services/ai/googleAIService.mjs';
import { ResponseCoordinator } from '../services/chat/responseCoordinator.mjs';
import { ToolSchemaGenerator } from '../services/tools/toolSchemaGenerator.mjs';
import { ToolExecutor } from '../services/tools/toolExecutor.mjs';
import { ToolDecisionService } from '../services/tools/toolDecisionService.mjs';
import { AgentContinuationService } from '../services/tools/agentContinuationService.mjs';
import { EmbeddingService } from '../services/memory/embeddingService.mjs';
import { MemoryScheduler } from '../services/memory/memoryScheduler.mjs';
import WalletInsights from '../services/social/buybot/walletInsights.mjs';
import { XService } from '../services/social/xService.mjs';
import { TelegramService } from '../services/social/telegramService.mjs';
import { GlobalBotService } from '../services/social/globalBotService.mjs';
import { BotService } from '../services/bot/botService.mjs';
import { SocialPlatformService } from '../services/social/socialPlatformService.mjs';
import { UnifiedAIService } from '../services/ai/unifiedAIService.mjs';
import { StoryStateService } from '../services/story/storyStateService.mjs';
import { WorldContextService } from '../services/story/worldContextService.mjs';
import { NarrativeGeneratorService } from '../services/story/narrativeGeneratorService.mjs';
import { StoryPlannerService } from '../services/story/storyPlannerService.mjs';
import { StorySchedulerService } from '../services/story/storySchedulerService.mjs';
import { StoryPostingService } from '../services/story/storyPostingService.mjs';
import { StoryArchiveService } from '../services/story/storyArchiveService.mjs';
import { CharacterContinuityService } from '../services/story/characterContinuityService.mjs';
import { ChapterContextService } from '../services/story/chapterContextService.mjs';
import { X402Service } from '../services/payment/x402Service.mjs';
import { AgentWalletService } from '../services/payment/agentWalletService.mjs';
import { PricingService } from '../services/payment/pricingService.mjs';
import { MarketplaceService } from '../services/payment/marketplaceService.mjs';
import { MarketplaceServiceRegistry } from '../services/marketplace/marketplaceServiceRegistry.mjs';
import { MetricsService } from '../services/monitoring/metricsService.mjs';
import { MediaGenerationService } from '../services/media/mediaGenerationService.mjs';
import { MediaIndexService } from '../services/media/mediaIndexService.mjs';
import { WikiService } from '../services/wiki/wikiService.mjs';
import { WikiGardenerService } from '../services/wiki/wikiGardenerService.mjs';
import { ImageGenerationRateLimiter } from '../services/ai/imageGenerationRateLimiter.mjs';
import { UnifiedChatAgent } from '../services/agent/unifiedChatAgent.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, '..');

export async function initializeContainer({ container, logger, configService }) {
  try {
    try {
      validateEnv(logger);
    } catch (e) {
      logger.error('[container] Env validation threw:', e.message);
    }

    await configService.loadConfig();

    // Check ffmpeg availability (required for video concatenation)
    try {
      const { checkFfmpegAvailable } = await import('../utils/videoUtils.mjs');
      const ffmpegAvailable = await checkFfmpegAvailable();
      if (ffmpegAvailable) {
        logger.info('[container] ✅ ffmpeg is available for video processing');
      } else {
        logger.warn('[container] ⚠️  ffmpeg not found - video concatenation features will not work');
        logger.warn('[container] To enable video features, install ffmpeg: https://ffmpeg.org/download.html');
      }
    } catch (e) {
      logger.warn('[container] Could not check ffmpeg availability:', e.message);
    }

    // Optional secondary Google AI service
    let googleAIService = null;
    let unifiedAIService = null;
    let mediaGenerationService = null;

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

    // Explicitly register core services in a known order
    container.register({
      walletInsights: asClass(WalletInsights)
        .singleton()
        .inject(() => ({
          getLambdaEndpoint: () => null,
          retryWithBackoff: async (fn) => fn(),
          getTokenInfo: () => null,
          cacheTtlMs: undefined,
          cacheMaxEntries: undefined,
        })),
      metricsService: asClass(MetricsService).singleton(),
      databaseService: asClass(DatabaseService).singleton(),
      aiModelService: asClass(AIModelService).singleton(),
      xService: asClass(XService).singleton(),
      telegramService: asClass(TelegramService).singleton(),
      globalBotService: asClass(GlobalBotService).singleton(),
      botService: asClass(BotService).singleton(),
      socialPlatformService: asClass(SocialPlatformService).singleton(),
      toolService: asClass(ToolService).singleton(),
      toolSchemaGenerator: asClass(ToolSchemaGenerator).singleton(),
      toolDecisionService: asClass(ToolDecisionService).singleton(),
      agentContinuationService: asClass(AgentContinuationService).singleton(),
      toolExecutor: asClass(ToolExecutor).singleton(),
      discordService: asClass(DiscordService)
        .singleton()
        .inject(() => ({
          getToolService: () => container.resolve('toolService'),
        })),
      buybotService: asClass(BuybotService)
        .singleton()
        .inject(() => ({
          getTelegramService: () => container.resolve('telegramService'),
          getDiscordService: () => container.resolve('discordService'),
          getConversationManager: () => container.resolve('conversationManager'),
          getResponseCoordinator: () => container.resolve('responseCoordinator'),
          services: container,
        })),
      responseCoordinator: asClass(ResponseCoordinator).singleton(),
      messageHandler: asClass(MessageHandler).singleton(),
      webService: asClass(WebService).singleton(),
      embeddingService: asClass(EmbeddingService).singleton(),
      memoryScheduler: asClass(MemoryScheduler).singleton(),
      // Wiki service for bot knowledge sharing
      wikiService: asClass(WikiService).singleton(),
      wikiGardenerService: asClass(WikiGardenerService).singleton(),
      // Story system services
      storyStateService: asClass(StoryStateService).singleton(),
      worldContextService: asClass(WorldContextService).singleton(),
      narrativeGeneratorService: asClass(NarrativeGeneratorService).singleton(),
      storyPlannerService: asClass(StoryPlannerService).singleton(),
      storySchedulerService: asClass(StorySchedulerService).singleton(),
      storyPostingService: asClass(StoryPostingService).singleton(),
      storyArchiveService: asClass(StoryArchiveService).singleton(),
      characterContinuityService: asClass(CharacterContinuityService).singleton(),
      chapterContextService: asClass(ChapterContextService).singleton(),
      // Image generation rate limiter
      imageGenerationRateLimiter: asClass(ImageGenerationRateLimiter).singleton(),
    });

    // Load payment configuration from database before creating payment services
    try {
      const databaseService = container.resolve('databaseService');
      const db = await databaseService.getDatabase();
      if (!configService.db) {
        configService.db = db;
      }

      try {
        await configService.refreshPromptDefaultsFromDatabase({ db, force: true });
        logger.info('[container] ✅ Loaded prompt defaults from database');
      } catch (promptError) {
        logger.warn(
          '[container] ⚠️  Failed to load prompt defaults from database:',
          promptError?.message || promptError
        );
      }

      const settingsCollection = db.collection('settings');
      const paymentSettings = await settingsCollection
        .find({
          key: { $regex: /^payment\./ },
          scope: 'global',
        })
        .toArray();

      if (paymentSettings.length > 0) {
        if (!configService.config.payment) {
          configService.config.payment = { x402: {}, agentWallets: {} };
        }

        for (const setting of paymentSettings) {
          const keys = setting.key.split('.');
          if (keys[0] === 'payment' && keys[1] === 'x402') {
            configService.config.payment.x402[keys[2]] = setting.value;
          } else if (keys[0] === 'payment' && keys[1] === 'agentWallets') {
            configService.config.payment.agentWallets[keys[2]] = setting.value;
          }
        }

        logger.info('[container] ✅ Loaded payment configuration from database');
        logger.debug('[container] Payment x402 config:', configService.config.payment.x402);
      }
    } catch (e) {
      logger.debug('[container] Could not load payment config from database:', e.message);
    }

    // Register payment services after loading config
    container.register({
      x402Service: asClass(X402Service).singleton(),
      agentWalletService: asClass(AgentWalletService).singleton(),
      pricingService: asClass(PricingService).singleton(),
      marketplaceService: asClass(MarketplaceService).singleton(),
      marketplaceServiceRegistry: asClass(MarketplaceServiceRegistry).singleton(),
    });

    // Dynamically register remaining services
    const servicePaths = await globby(['./services/**/*.mjs'], {
      cwd: srcDir,
      absolute: true,
      followSymbolicLinks: true,
    });

    for (const file of servicePaths) {
      try {
        const mod = await import(file);
        const isClass = (v) => typeof v === 'function' && /^\s*class\s/.test(v.toString());
        const exportsArray = Object.entries(mod);
        const defaultIsClass = isClass(mod.default);
        const namedClass = exportsArray.map(([, v]) => v).find(isClass);
        const ServiceClass = defaultIsClass ? mod.default : namedClass;
        if (!ServiceClass) continue;
        const fileName = path.basename(file, '.mjs');
        const camelName = fileName.charAt(0).toLowerCase() + fileName.slice(1);
        if (container.registrations[camelName]) continue;
        container.register(camelName, asClass(ServiceClass).singleton());
      } catch (err) {
        console.error(`Failed to register service from ${file}:`, err);
      }
    }

    // Provide a stable alias 'aiService' that prefers OpenRouter for all chat/text
    try {
      if (container.registrations.openrouterAIService) {
        const openrouterAIService = container.resolve('openrouterAIService');
        if (openrouterAIService?.ready) await openrouterAIService.ready;
        container.register({ aiService: asValue(openrouterAIService) });
        console.log('[container] Registered aiService alias pointing to openrouterAIService');
        console.log(
          `[container] OpenRouter models registered: ${container
            .resolve('aiModelService')
            .getAllModels('openrouter').length}`
        );
      } else if (container.registrations.ollamaAIService) {
        container.register({ aiService: asValue(container.resolve('ollamaAIService')) });
      } else if (container.registrations.googleAIService) {
        container.register({ aiService: asValue(container.resolve('googleAIService')) });
      }
    } catch (e) {
      console.warn('[container] Failed to set aiService alias:', e.message);
    }

    // Create MediaGenerationService after dynamic services (veoService) are available
    try {
      const veoService = container.registrations.veoService ? container.resolve('veoService') : null;
      const aiService = container.registrations.aiService ? container.resolve('aiService') : null;
      mediaGenerationService = new MediaGenerationService({
        googleAIService,
        veoService,
        aiService,
        logger,
        config: { aspectRatio: '1:1' },
      });
      container.register({ mediaGenerationService: asValue(mediaGenerationService) });
      logger.info('[container] ✅ MediaGenerationService initialized', {
        hasVeo: !!veoService,
        hasGoogleAI: !!googleAIService,
        hasAI: !!aiService,
      });
    } catch (e) {
      console.warn('[container] Failed to init MediaGenerationService:', e.message);
    }

    // Create MediaIndexService for semantic media search
    try {
      const dbService = container.resolve('databaseService');
      const mediaIndexService = new MediaIndexService({
        databaseService: dbService,
        googleAIService,
        logger,
      });
      container.register({ mediaIndexService: asValue(mediaIndexService) });
      logger.info('[container] ✅ MediaIndexService initialized');
    } catch (e) {
      console.warn('[container] Failed to init MediaIndexService:', e.message);
    }

    // Create UnifiedChatAgent for cross-platform AI agent functionality (Telegram + Discord)
    try {
      const dbService = container.resolve('databaseService');
      const aiService = container.registrations.aiService ? container.resolve('aiService') : null;
      const veoService = container.registrations.veoService ? container.resolve('veoService') : null;
      const buybotService = container.registrations.buybotService ? container.resolve('buybotService') : null;
      const xService = container.registrations.xService ? container.resolve('xService') : null;
      const globalBotService = container.registrations.globalBotService ? container.resolve('globalBotService') : null;
      const wikiService = container.registrations.wikiService ? container.resolve('wikiService') : null;
      const mediaIndexSvc = container.registrations.mediaIndexService ? container.resolve('mediaIndexService') : null;
      
      const unifiedChatAgent = new UnifiedChatAgent({
        logger,
        databaseService: dbService,
        configService,
        aiService,
        globalBotService,
        googleAIService,
        veoService,
        buybotService,
        xService,
        mediaGenerationService,
        mediaIndexService: mediaIndexSvc,
        wikiService,
      });
      
      container.register({ unifiedChatAgent: asValue(unifiedChatAgent) });
      logger.info('[container] ✅ UnifiedChatAgent initialized (Telegram + Discord AI agent)');
    } catch (e) {
      console.warn('[container] Failed to init UnifiedChatAgent:', e.message);
    }

    // Provide late-binding getters early to break circular deps
    container.register({
      getMapService: asFunction(() => () => container.resolve('mapService')).singleton(),
    });
    container.register({
      getBuybotService: asFunction(() => () => container.resolve('buybotService')).singleton(),
    });
    container.register({
      getConversationManager: asFunction(() => () => container.resolve('conversationManager')).singleton(),
    });
    container.register({
      getCombatEncounterService: asFunction(() => () => container.resolve('combatEncounterService')).singleton(),
    });
    container.register({
      getUnifiedChatAgent: asFunction(() => () => container.resolve('unifiedChatAgent')).singleton(),
    });

    // Late-binding unifiedAIService
    try {
      const preferred = ['openrouterAIService', 'ollamaAIService', 'googleAIService'];
      let wrappedName = null;
      for (const name of preferred) {
        if (container.registrations[name]) {
          wrappedName = name;
          break;
        }
      }
      if (wrappedName) {
        const base = container.resolve(wrappedName);
        if (wrappedName === 'openrouterAIService' && base?.ready) await base.ready;
        unifiedAIService = new UnifiedAIService({ aiService: base, logger, configService });
        container.register({ unifiedAIService: asValue(unifiedAIService) });
        console.log('[container] Registered unifiedAIService wrapping', wrappedName);

        try {
          if (container.registrations.decisionMaker && container.cradle.decisionMaker) {
            container.cradle.decisionMaker.unifiedAIService = unifiedAIService;
            console.log('[container] Injected unifiedAIService into existing decisionMaker instance.');
          }
        } catch (e) {
          console.warn('[container] Failed to inject unifiedAIService into decisionMaker:', e.message);
        }
      }
    } catch (e) {
      console.warn('[container] Failed late unifiedAIService init:', e.message);
    }

    console.log('🔧 registered services:', Object.keys(container.registrations));

    // Start combat narrative listeners
    try {
      if (container.registrations.combatNarrativeService) {
        const narr = container.resolve('combatNarrativeService');
        narr.start();
        console.log('[container] CombatNarrativeService started.');
      }
    } catch (e) {
      console.warn('[container] Failed to start CombatNarrativeService:', e.message);
    }

    // Initialize background image analyzer (listens to MESSAGE.CREATED events)
    try {
      if (container.registrations.backgroundImageAnalyzer) {
        container.resolve('backgroundImageAnalyzer');
        console.log('[container] BackgroundImageAnalyzer initialized and listening for image events.');
      }
    } catch (e) {
      console.warn('[container] Failed to initialize BackgroundImageAnalyzer:', e.message);
    }

    // Parallelize independent service initializations
    const parallelInits = [];

    if (container.registrations.unifiedChatAgent) {
      parallelInits.push(
        (async () => {
          try {
            const chatAgent = container.resolve('unifiedChatAgent');
            await chatAgent.initialize();
            console.log('[container] UnifiedChatAgent initialized (Telegram + Discord AI agent).');
          } catch (e) {
            console.warn('[container] Failed to initialize UnifiedChatAgent:', e.message);
          }
        })()
      );
    }

    if (container.registrations.avatarLocationMemory) {
      parallelInits.push(
        (async () => {
          try {
            const memService = container.resolve('avatarLocationMemory');
            await memService.init();
            console.log('[container] AvatarLocationMemory initialized.');
          } catch (e) {
            console.warn('[container] Failed to initialize AvatarLocationMemory:', e.message);
          }
        })()
      );
    }

    if (container.registrations.locationService) {
      parallelInits.push(
        (async () => {
          try {
            const locService = container.resolve('locationService');
            await locService.initializeDatabase();
            console.log('[container] LocationService indexes initialized.');
          } catch (e) {
            console.warn('[container] Failed to initialize LocationService:', e.message);
          }
        })()
      );
    }

    if (container.registrations.globalBotService) {
      parallelInits.push(
        (async () => {
          try {
            const globalBot = container.resolve('globalBotService');
            await globalBot.initialize();
            console.log('[container] GlobalBotService initialized.');
          } catch (e) {
            console.warn('[container] Failed to initialize GlobalBotService:', e.message);
          }
        })()
      );
    }

    if (container.registrations.storyStateService) {
      parallelInits.push(
        (async () => {
          try {
            const storyState = container.resolve('storyStateService');
            await storyState.createIndexes();
            console.log('[container] StoryStateService indexes created.');
          } catch (e) {
            console.warn('[container] Failed to create StoryStateService indexes:', e.message);
          }
        })()
      );
    }

    if (container.registrations.storyPlannerService) {
      parallelInits.push(
        (async () => {
          try {
            const storyPlanner = container.resolve('storyPlannerService');
            await storyPlanner.initialize();
            console.log('[container] StoryPlannerService initialized.');
          } catch (e) {
            console.warn('[container] Failed to initialize StoryPlannerService:', e.message);
          }
        })()
      );
    }

    if (container.registrations.storySchedulerService) {
      parallelInits.push(
        (async () => {
          try {
            const storyScheduler = container.resolve('storySchedulerService');
            await storyScheduler.initialize();
            console.log('[container] StorySchedulerService initialized.');
          } catch (e) {
            console.warn('[container] Failed to initialize StorySchedulerService:', e.message);
          }
        })()
      );
    }

    if (container.registrations.openrouterModelRosterSchedulerService) {
      parallelInits.push(
        (async () => {
          try {
            const roster = container.resolve('openrouterModelRosterSchedulerService');
            await roster.initialize();
            console.log('[container] OpenrouterModelRosterSchedulerService initialized.');
          } catch (e) {
            console.warn('[container] Failed to initialize OpenrouterModelRosterSchedulerService:', e.message);
          }
        })()
      );
    }

    await Promise.all(parallelInits);

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

    // Prevent unused import warning if kept elsewhere.
    void CombatNarrativeService;
  } catch (e) {
    logger.error('[container] Fatal container init error:', e?.message || e);
    throw e;
  }
}
