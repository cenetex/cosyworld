#!/usr/bin/env node

/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * Diagnostic script to check Buybot status
 */

import 'dotenv/config';
import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'moonstone';
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

async function checkBuybotStatus() {
  console.log('🔍 Checking Buybot Status\n');
  
  // Check environment variables
  console.log('📋 Environment Configuration:');
  console.log(`   HELIUS_API_KEY: ${HELIUS_API_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log(`   MONGO_URI: ${MONGO_URI ? '✅ Set' : '❌ Missing'}`);
  console.log(`   MONGO_DB_NAME: ${MONGO_DB_NAME}`);
  console.log(`   BUYBOT_POLL_INTERVAL_MS: ${process.env.BUYBOT_POLL_INTERVAL_MS || '300000 (default 5 min)'}`);
  console.log('');
  
  if (!HELIUS_API_KEY) {
    console.log('❌ HELIUS_API_KEY is not set. Buybot service will not initialize.');
    console.log('   Set HELIUS_API_KEY in your .env file to enable buybot functionality.\n');
  }
  
  if (!MONGO_URI) {
    console.log('❌ MONGO_URI is not set. Cannot check database.\n');
    return;
  }
  
  // Connect to database
  const client = new MongoClient(MONGO_URI);
  
  try {
    await client.connect();
    const db = client.db(MONGO_DB_NAME);
    
    console.log('📊 Database Status:');
    
    // Check tracked tokens
    const trackedTokens = await db.collection('buybot_tracked_tokens')
      .find({ active: true })
      .toArray();
    
    console.log(`   Active tracked tokens: ${trackedTokens.length}`);
    
    if (trackedTokens.length === 0) {
      console.log('   ⚠️  No tokens are currently being tracked.');
      console.log('   Use !ca <token_address> in Discord or /ca in Telegram to add tokens.\n');
    } else {
      console.log('\n   Tracked Tokens:');
      for (const token of trackedTokens) {
        const platform = token.platform || 'discord';
        const lastChecked = token.lastCheckedAt ? new Date(token.lastCheckedAt).toLocaleString() : 'Never';
        const errorCount = token.errorCount || 0;
        
        console.log(`   • ${token.tokenSymbol || 'Unknown'} (${token.tokenAddress.substring(0, 8)}...)`);
        console.log(`     Platform: ${platform} | Channel: ${token.channelId}`);
        console.log(`     Last checked: ${lastChecked}`);
        if (errorCount > 0) {
          console.log(`     ⚠️  Error count: ${errorCount}`);
        }
      }
      console.log('');
    }
    
    // Check recent events
    const recentEvents = await db.collection('buybot_token_events')
      .find({})
      .sort({ timestamp: -1 })
      .limit(10)
      .toArray();
    
    console.log(`   Recent events (last 10): ${recentEvents.length}`);
    
    if (recentEvents.length > 0) {
      console.log('\n   Latest Events:');
      for (const event of recentEvents.slice(0, 5)) {
        const date = new Date(event.timestamp).toLocaleString();
        const amount = event.amount ? (event.amount / Math.pow(10, event.decimals)).toFixed(4) : '?';
        console.log(`   • ${event.type} - ${amount} tokens - ${date}`);
        console.log(`     TX: ${event.signature.substring(0, 16)}...`);
      }
      console.log('');
    } else {
      console.log('   ℹ️  No events detected yet.\n');
    }
    
    // Check collections if any
    const trackedCollections = await db.collection('buybot_tracked_collections')
      .find({ active: true })
      .toArray();
    
    if (trackedCollections.length > 0) {
      console.log(`   Active tracked collections: ${trackedCollections.length}`);
      for (const coll of trackedCollections) {
        console.log(`   • ${coll.collectionAddress.substring(0, 8)}... in channel ${coll.channelId}`);
      }
      console.log('');
    }
    
    // Recommendations
    console.log('💡 Recommendations:');
    
    if (!HELIUS_API_KEY) {
      console.log('   1. Set HELIUS_API_KEY in your .env file');
      console.log('      Get a free API key at: https://helius.dev');
    }
    
    if (trackedTokens.length === 0) {
      console.log('   2. Add tokens to track using commands:');
      console.log('      Discord: !ca <token_address>');
      console.log('      Telegram: /ca in a channel or DM');
    }
    
    if (trackedTokens.length > 0 && recentEvents.length === 0) {
      console.log('   3. No recent events detected. Possible reasons:');
      console.log('      • No trades have occurred for tracked tokens');
      console.log('      • Token addresses may be incorrect');
      console.log('      • Polling may not be running (check logs)');
      console.log('      • HELIUS_API_KEY may be invalid or rate-limited');
    }
    
    const pollIntervalMinutes = (parseInt(process.env.BUYBOT_POLL_INTERVAL_MS, 10) || 300000) / 60000;
    if (pollIntervalMinutes >= 5) {
      console.log(`   4. Current polling interval is ${pollIntervalMinutes} minutes.`);
      console.log('      For more frequent updates, set BUYBOT_POLL_INTERVAL_MS=30000 (30 seconds)');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
  }
}

// Run the check
checkBuybotStatus().catch(console.error);
