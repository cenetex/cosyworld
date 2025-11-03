#!/usr/bin/env node

/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * Test script to manually trigger buybot check
 */

import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { createHelius } from 'helius-sdk';

const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'cosyworld8';
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

async function testBuybot() {
  console.log('🧪 Testing Buybot Transaction Detection\n');
  
  if (!HELIUS_API_KEY) {
    console.error('❌ HELIUS_API_KEY not set');
    return;
  }
  
  if (!MONGO_URI) {
    console.error('❌ MONGO_URI not set');
    return;
  }
  
  const client = new MongoClient(MONGO_URI);
  const helius = createHelius({ apiKey: HELIUS_API_KEY });
  
  try {
    await client.connect();
    const db = client.db(MONGO_DB_NAME);
    
    // Get the first tracked token
    const token = await db.collection('buybot_tracked_tokens')
      .findOne({ active: true });
    
    if (!token) {
      console.log('❌ No active tracked tokens found');
      return;
    }
    
    console.log(`📍 Testing token: ${token.tokenSymbol || 'Unknown'}`);
    console.log(`   Address: ${token.tokenAddress}`);
    console.log(`   Channel: ${token.channelId}`);
    console.log(`   Platform: ${token.platform || 'discord'}`);
    console.log(`   Last checked: ${token.lastCheckedAt ? new Date(token.lastCheckedAt).toLocaleString() : 'Never'}\n`);
    
    // Fetch recent transactions
    console.log('🔍 Fetching recent transactions from Helius...');
    const response = await helius.enhanced.getTransactionsByAddress({
      address: token.tokenAddress,
      limit: 5,
    });
    
    if (!response || response.length === 0) {
      console.log('   No transactions found\n');
      return;
    }
    
    console.log(`   Found ${response.length} recent transactions:\n`);
    
    for (const tx of response) {
      const date = new Date(tx.timestamp * 1000).toLocaleString();
      const type = tx.type || 'UNKNOWN';
      const desc = tx.description || 'No description';
      
      console.log(`   • ${tx.signature.substring(0, 16)}...`);
      console.log(`     Type: ${type} | ${desc}`);
      console.log(`     Time: ${date}`);
      console.log(`     Token transfers: ${tx.tokenTransfers?.length || 0}`);
      
      // Check if this transaction was already processed
      const existing = await db.collection('buybot_token_events').findOne({
        signature: tx.signature
      });
      
      if (existing) {
        console.log(`     ✅ Already processed`);
      } else {
        console.log(`     ⚠️  NOT processed yet`);
        
        // Check if it has relevant token transfers
        const tokenTransfers = tx.tokenTransfers || [];
        const relevantTransfers = tokenTransfers.filter(
          t => t.mint === token.tokenAddress && parseFloat(t.tokenAmount || 0) > 0
        );
        
        if (relevantTransfers.length > 0) {
          console.log(`     → Has ${relevantTransfers.length} relevant transfer(s)`);
          const transfer = relevantTransfers[0];
          console.log(`       Amount: ${transfer.tokenAmount}`);
          console.log(`       From: ${transfer.fromUserAccount?.substring(0, 8)}...`);
          console.log(`       To: ${transfer.toUserAccount?.substring(0, 8)}...`);
        } else {
          console.log(`     → No relevant transfers for this token`);
        }
      }
      console.log('');
    }
    
    // Check for any errors in the token tracking
    if (token.errorCount && token.errorCount > 0) {
      console.log(`⚠️  Token has ${token.errorCount} error(s)`);
      if (token.lastErrorAt) {
        console.log(`   Last error: ${new Date(token.lastErrorAt).toLocaleString()}`);
      }
    }
    
    console.log('\n💡 Next Steps:');
    console.log('   1. If transactions are not being processed, check application logs');
    console.log('   2. Ensure Discord/Telegram services are running');
    console.log('   3. Verify channel IDs are correct');
    console.log('   4. Check if polling interval is too long (currently 5 minutes)');
    console.log('      Set BUYBOT_POLL_INTERVAL_MS=30000 for 30-second checks\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await client.close();
  }
}

testBuybot().catch(console.error);
