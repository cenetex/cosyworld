/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { container } from './container.mjs';

async function main() {
  const logger = container.resolve('logger');

  try {
    for (const name of ['veoService','crossmintService','s3Service', 'aiModelService']) {
      try { await container.resolve(name)?.ping?.(); logger.info(`✓ ${name}`); }
      catch(e) { logger.error(`✗ ${name}: ${e.message}`); process.exit(1); }
    }
    
    // Step 1: Connect to database
    const db = container.resolve('databaseService');
    await db.connect();
    logger.log('[startup] Database connected');

    // Step 2: Assign DB to config if needed
    const config = container.resolve('configService');
    config.db = await db.getDatabase(); // your system relies on this


    await db.createIndexes();
    logger.log('[startup] Database indexes created');

    // Step 4: Initialize core services
    const toolService = container.resolve('toolService');
    await toolService.initialize();
    logger.log('[startup] ToolService initialized');

    // Step 5: Launch Discord bot
    const discord = container.resolve('discordService');
    await discord.login();
    logger.log('[startup] Discord bot logged in');

    // Start the MessageHandler
    const messageHandler = container.resolve('messageHandler');
    await messageHandler.start();
    logger.log('[startup] MessageHandler started');


    // Start the Web Service
    const web = container.resolve('webService');
    await web.start?.();
    logger.log('[startup] Web service started');

  } catch (err) {
    logger.error(`[fatal] Startup failed: ${err.message}\n${err.stack}`);
    process.exit(1);
  }
}

main();
