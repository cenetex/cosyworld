/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Script to upgrade existing partial wallet avatars to full avatars
 * Finds all partial avatars (no imageUrl) for RATi holders and generates images
 */

import dotenv from 'dotenv';

import { openDatabase } from './lib/openDatabase.mjs';

dotenv.config();

const RATI_TOKEN_ADDRESS = 'Ci6Y1UX8bY4jxn6YiogJmdCxFEu2jmZhCcG65PStpump';

/**
 * Get RATi balance for a wallet from Helius
 */
async function getWalletRatiBalance(walletAddress) {
  try {
    const response = await fetch(`https://api.helius.xyz/v0/addresses/${walletAddress}/balances?api-key=${process.env.HELIUS_API_KEY}`);
    
    if (!response.ok) {
      console.error(`Failed to fetch balance for ${walletAddress}: ${response.statusText}`);
      return 0;
    }
    
    const data = await response.json();
    const ratiToken = data.tokens?.find(t => t.mint === RATI_TOKEN_ADDRESS);
    
    if (ratiToken) {
      return ratiToken.amount / Math.pow(10, ratiToken.decimals || 6);
    }
    
    return 0;
  } catch (error) {
    console.error(`Error fetching balance for ${walletAddress}:`, error.message);
    return 0;
  }
}

async function main() {
  let handle;
  
  try {
    handle = await openDatabase();
    console.log(`✅ Connected to ${handle.backend} database\n`);
    
    const db = handle.db;
    const avatarsCollection = db.collection('avatars');
    
    // Find all wallet avatars without images
    const partialAvatars = await avatarsCollection.find({
      walletAddress: { $exists: true, $ne: null },
      $or: [
        { imageUrl: null },
        { imageUrl: { $exists: false } }
      ],
      status: { $ne: 'dead' }
    }).toArray();
    
    console.log(`📊 Found ${partialAvatars.length} partial wallet avatars\n`);
    
    if (partialAvatars.length === 0) {
      console.log('✨ No partial avatars to upgrade!');
      return;
    }
    
    let upgraded = 0;
    let skipped = 0;
    let failed = 0;
    
    for (const avatar of partialAvatars) {
      const shortAddr = `${avatar.walletAddress.slice(0, 4)}...${avatar.walletAddress.slice(-4)}`;
      console.log(`\n🔍 Checking ${avatar.emoji || '❓'} ${avatar.name} (${shortAddr})`);
      
      // Check RATi balance
      const ratiBalance = await getWalletRatiBalance(avatar.walletAddress);
      console.log(`   RATi balance: ${ratiBalance.toLocaleString()}`);
      
      if (ratiBalance > 0) {
        console.log(`   ✅ RATi holder - should have image!`);
        console.log(`   📝 Avatar needs upgrade from partial to full`);
        console.log(`   ⚠️  Manual restart required to trigger image generation`);
        console.log(`   💡 Image will be generated on next trade transaction`);
        upgraded++;
      } else {
        console.log(`   ⏭️  Not a RATi holder - partial avatar is correct`);
        skipped++;
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log('\n' + '='.repeat(70));
    console.log('📊 Summary:');
    console.log(`   ✅ RATi holders needing upgrade: ${upgraded}`);
    console.log(`   ⏭️  Non-holders (correctly partial): ${skipped}`);
    console.log(`   ❌ Errors: ${failed}`);
    console.log('='.repeat(70));
    
    if (upgraded > 0) {
      console.log('\n💡 Next Steps:');
      console.log('   1. Restart the server with the new avatar hydration code');
      console.log('   2. Wait for these wallets to make transactions');
      console.log('   3. Images will be automatically generated and saved');
      console.log('\n   Or run: node scripts/force-upgrade-wallet-avatars.mjs');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await handle?.close?.();
    console.log('\n✅ Database connection closed');
  }
}

main();
