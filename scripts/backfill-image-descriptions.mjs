#!/usr/bin/env node
/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * Backfill script for image descriptions
 * Usage: node scripts/backfill-image-descriptions.mjs [limit]
 */

import '../src/index.mjs';
import { container, containerReady } from '../src/container.mjs';

async function main() {
  const limit = parseInt(process.argv[2]) || 100;
  
  console.log('🖼️  Image Description Backfill Tool\n');
  console.log(`Waiting for services to initialize...`);
  
  await containerReady;
  
  try {
    const analyzer = container.resolve('backgroundImageAnalyzer');
    
    // Get stats first
    console.log('\n📊 Current Statistics:');
    const stats = await analyzer.getStats();
    if (stats) {
      console.log(`   Total cached: ${stats.total}`);
      console.log(`   Completed: ${stats.completed}`);
      console.log(`   Processing: ${stats.processing}`);
      console.log(`   Failed: ${stats.failed}`);
      console.log(`   Queue size: ${stats.queueSize}`);
    }
    
    console.log(`\n🔄 Starting backfill (limit: ${limit})...`);
    await analyzer.backfillImageDescriptions(limit);
    
    // Get updated stats
    console.log('\n📊 Updated Statistics:');
    const updatedStats = await analyzer.getStats();
    if (updatedStats) {
      console.log(`   Total cached: ${updatedStats.total}`);
      console.log(`   Completed: ${updatedStats.completed}`);
      console.log(`   Processing: ${updatedStats.processing}`);
      console.log(`   Failed: ${updatedStats.failed}`);
    }
    
    console.log('\n✅ Backfill complete!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Backfill failed:', err);
    process.exit(1);
  }
}

main();
