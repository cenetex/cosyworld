/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import fsSync from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { ConfigWizardService } from './services/foundation/configWizardService.mjs';
import { ensureEncryptionKey } from './utils/ensureEncryptionKey.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function hydrateEnv() {
  const projectRoot = path.resolve(__dirname, '..');
  const envPath = process.env.ENV_FILE || process.env.CONFIG_ENV_FILE || (
    process.env.NODE_ENV === 'production' && fsSync.existsSync('/data')
      ? '/data/.env'
      : path.join(projectRoot, '.env')
  );

  if (envPath && fsSync.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
  dotenv.config();
}

async function launchConfigurationWizard({ logger = console, secretsService = null, configService = null } = {}) {
  const wizard = new ConfigWizardService({
    logger,
    secretsService,
    configService
  });

  await wizard.start();

  return new Promise(() => {
    // Never resolves - wizard mode
  });
}

async function startBootServer() {
  if (process.env.DISABLE_BOOT_SERVER === '1') return null;

  const port = Number(process.env.WEB_PORT || process.env.PORT || 3000);
  const server = http.createServer((req, res) => {
    const body = JSON.stringify({
      status: 'starting',
      timestamp: new Date().toISOString(),
      uptime: Math.round(process.uptime())
    });

    res.writeHead(req.url === '/api/health/live' ? 200 : 503, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache'
    });
    res.end(body);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      server.off('error', reject);
      console.info(`[startup] Boot health server listening on 0.0.0.0:${port}`);
      resolve();
    });
  });

  return server;
}

async function stopBootServer(server) {
  if (!server) return;

  await new Promise((resolve) => {
    server.close(() => resolve());
  });
}

async function checkConfiguration(container) {
  const logger = container.resolve('logger');
  const secretsService = container.resolve('secretsService');
  const configService = container.resolve('configService');
  
  const wizard = new ConfigWizardService({ 
    logger, 
    secretsService, 
    configService 
  });
  
  const status = await wizard.checkConfigurationStatus();
  
  if (!status.configured) {
    logger.warn('[startup] Configuration incomplete or missing');
    logger.warn(`[startup] ${status.details}`);
    logger.info('[startup] Launching configuration wizard...');

    return launchConfigurationWizard({ logger, secretsService, configService });
  }
  
  logger.info('[startup] Configuration check passed ✓');
  return true;
}

async function main() {
  const startTime = Date.now();
  const logTiming = (label) => console.log(`[startup:timing] ${label}: +${Date.now() - startTime}ms`);

  hydrateEnv();
  ensureEncryptionKey();

  const preflightWizard = new ConfigWizardService({ logger: console });
  const preflightStatus = await preflightWizard.checkConfigurationStatus();
  if (!preflightStatus.configured) {
    console.warn('[startup] Configuration incomplete or missing');
    console.warn(`[startup] ${preflightStatus.details}`);
    console.info('[startup] Launching configuration wizard before service container initialization...');
    return launchConfigurationWizard({ logger: console });
  }

  console.info('[startup] Configuration preflight passed; initializing service container...');
  const bootServer = await startBootServer();
  const { container, containerReady } = await import('./container.mjs');
  
  // Ensure container finished async initialization
  await containerReady;
  logTiming('Container ready');
  
  const logger = container.resolve('logger');

  try {
    // Check if configuration is complete FIRST before any service initialization
    const configured = await checkConfiguration(container);
    logTiming('Configuration checked');
    if (!configured) {
      // Wizard is running, exit main startup
      return;
    }
    
    // Now that we're configured, initialize services
    // Note: Some services (like S3) are optional and may not be fully configured
    for (const name of ['veoService','crossmintService','s3Service', 'aiModelService']) {
      try { 
        const result = await container.resolve(name)?.ping?.(); 
        if (result?.configured === false) {
          logger.warn(`⚠️  ${name}: ${result.message || 'Not configured (optional)'}`);
        } else {
          logger.info(`✓ ${name}`);
        }
      }
      catch(e) { 
        logger.warn(`⚠️  ${name}: ${e.message} (may need configuration)`);
      }
    }
    
    // Step 1: Connect to database
    const db = container.resolve('databaseService');
    await db.connect();
    logTiming('Database connected');
    logger.log('[startup] Database connected');

    // Step 2: Assign DB to config if needed
    const config = container.resolve('configService');
    config.db = await db.getDatabase(); // your system relies on this

    try {
      await config.refreshTokenPreferences({ force: true, seedIfMissing: true });
      logger.log('[startup] Token preferences loaded');
    } catch (e) {
      logger.warn(`[startup] Token preferences not loaded: ${e.message}`);
    }

    // Attach SecretsService to Mongo so secrets persist in the 'secrets' collection
    try {
      const secrets = container.resolve('secretsService');
      await secrets.attachDB(config.db, { collectionName: 'secrets' });
      logger.log('[startup] SecretsService attached to Mongo');
    } catch (e) {
      logger.error(`[startup] Failed to attach SecretsService to Mongo: ${e.message}`);
    }


    await db.createIndexes();
    logTiming('Database indexes created');
    logger.log('[startup] Database indexes created');

    // Start HTTP before bot/background services so Fly health checks can pass
    // while the rest of the runtime finishes warming up.
    try {
      logger.info('[startup] Starting web service...');
      await stopBootServer(bootServer);
      const web = container.resolve('webService');
      await web.start?.();
      logTiming('Web service started');
      logger.log('[startup] Web service started');
    } catch (e) {
      logger.error(`[startup] Web service failed to start: ${e.message}`);
      logger.error(e.stack);
      logTiming('Web service failed');
    }

    // Step 4: Initialize core services
    const toolService = container.resolve('toolService');
    await toolService.initialize();
    logTiming('ToolService initialized');
    logger.log('[startup] ToolService initialized');

    // Start Memory nightly job (if enabled)
    try {
      const memoryScheduler = container.resolve('memoryScheduler');
      memoryScheduler.start?.();
      logger.log('[startup] MemoryScheduler started');
    } catch (e) {
      logger.warn(`[startup] MemoryScheduler not started: ${e.message}`);
    }

  // Video jobs removed: using inline generation via VeoService in tools

    // Start Turn Scheduler for ambient ticks
    try {
      const turnScheduler = container.resolve('turnScheduler');
      turnScheduler?.start?.();
      logger.log('[startup] TurnScheduler started');
    } catch (e) {
      logger.warn(`[startup] TurnScheduler not started: ${e.message}`);
    }

    // Start ResponseCoordinator maintenance
    try {
      const responseCoordinator = container.resolve('responseCoordinator');
      const schedulingService = container.resolve('schedulingService');
      if (responseCoordinator && schedulingService) {
        responseCoordinator.startMaintenance(schedulingService);
        logger.log('[startup] ResponseCoordinator maintenance started');
      }
    } catch (e) {
      logger.warn(`[startup] ResponseCoordinator maintenance not started: ${e.message}`);
    }

    // Step 5: Launch Discord bot
    const discord = container.resolve('discordService');
    await discord.login();
    logTiming('Discord bot logged in');
    logger.log('[startup] Discord bot logged in');

    // Initialize Buybot Service
    try {
      const buybotService = container.resolve('buybotService');
      await buybotService.initialize();
      logger.log('[startup] BuybotService initialized');
    } catch (e) {
      logger.warn(`[startup] BuybotService not initialized: ${e.message}`);
    }

    // Start the MessageHandler
    const messageHandler = container.resolve('messageHandler');
    await messageHandler.start();
    logger.log('[startup] MessageHandler started');

    // Start DM Planner (lightweight periodic planner)
    try {
      const dmPlannerService = container.resolve('dmPlannerService');
      dmPlannerService?.start?.();
      logger.log('[startup] DMPlannerService started');
    } catch (e) {
      logger.warn(`[startup] DMPlannerService not started: ${e.message}`);
    }


    // Initialize Telegram global bot in background (don't block startup)
    setImmediate(async () => {
      try {
        logger.info('[startup] Initializing Telegram bot in background...');
        const telegramService = container.resolve('telegramService');
        const initialized = await telegramService.initializeGlobalBot();
        logTiming('Telegram bot initialized');
        if (initialized) {
          logger.log('[startup] Telegram global bot initialized');
        } else {
          logger.debug('[startup] Telegram global bot not configured (optional)');
        }
      } catch (e) {
        logger.warn(`[startup] Telegram bot initialization failed: ${e.message}`);
        logTiming('Telegram bot failed');
      }
    });

  } catch (err) {
    logger.error(`[fatal] Startup failed: ${err.message}\n${err.stack}`);
    process.exit(1);
  }
}

main();
