/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Wallet Avatar Example
 * 
 * Demonstrates the wallet avatar system that creates unique personas
 * for Solana wallet addresses, similar to Discord user avatars.
 * 
 * Run: node examples/wallet-avatar-example.mjs
 */

import { container, containerReady } from '../src/container.mjs';

async function main() {
  try {
    console.log('🚀 Initializing CosyWorld container...\n');
    await containerReady;
    
    const walletAvatarService = container.resolve('walletAvatarService');
    const logger = container.resolve('logger');
    
    console.log('✅ Container ready!\n');
    console.log('═'.repeat(60));
    console.log('WALLET AVATAR DEMONSTRATION');
    console.log('═'.repeat(60));
    console.log();
    
    // Example wallet addresses
    const wallets = [
      {
        address: '7Xg2gNoQ6HcF9xUwZEMhvK1XkZKmg5zGx9Qd3mK9pump',
        context: { tokenSymbol: 'PRIME', amount: '1000', usdValue: 500 }
      },
      {
        address: 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG7pqBvX',
        context: { tokenSymbol: 'SOL', amount: '50', usdValue: 2500 }
      },
      {
        address: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
        context: { tokenSymbol: 'BONK', amount: '1000000', usdValue: 100 }
      }
    ];
    
    // Create avatars for each wallet
    for (const wallet of wallets) {
      console.log(`\n🔍 Looking up wallet: ${wallet.address.slice(0, 8)}...${wallet.address.slice(-8)}`);
      console.log(`   Context: ${wallet.context.amount} ${wallet.context.tokenSymbol} ($${wallet.context.usdValue})`);
      console.log();
      
      const avatar = await walletAvatarService.getOrCreateWalletAvatar(
        wallet.address,
        wallet.context
      );
      
      console.log(`   ${avatar.emoji} Name: ${avatar.name}`);
      console.log(`   📝 Description: ${avatar.description}`);
      console.log(`   🎭 Personality: ${avatar.personality}`);
      console.log(`   📅 Created: ${avatar.createdAt.toISOString()}`);
      console.log(`   📊 Activity Count: ${avatar.activityCount}`);
      
      if (avatar.context?.firstSeenToken) {
        console.log(`   🎯 First Seen: ${avatar.context.firstSeenToken} ($${avatar.context.firstSeenUsd})`);
      }
      
      console.log();
    }
    
    console.log('─'.repeat(60));
    console.log('SUBSEQUENT LOOKUPS (Should Return Cached Avatars)');
    console.log('─'.repeat(60));
    console.log();
    
    // Look up the first wallet again - should return cached avatar
    const firstWallet = wallets[0];
    console.log(`\n🔄 Re-fetching: ${firstWallet.address.slice(0, 8)}...${firstWallet.address.slice(-8)}`);
    
    const cachedAvatar = await walletAvatarService.getOrCreateWalletAvatar(
      firstWallet.address,
      firstWallet.context
    );
    
    console.log(`   ${cachedAvatar.emoji} ${cachedAvatar.name} (Activity: ${cachedAvatar.activityCount})`);
    console.log(`   ✅ Returned cached avatar with updated activity count`);
    console.log();
    
    // Get top traders
    console.log('─'.repeat(60));
    console.log('TOP TRADERS');
    console.log('─'.repeat(60));
    console.log();
    
    const topTraders = await walletAvatarService.getTopTraders(5);
    
    if (topTraders.length > 0) {
      console.log(`Found ${topTraders.length} wallet avatar(s):\n`);
      
      topTraders.forEach((trader, index) => {
        console.log(`${index + 1}. ${trader.emoji} ${trader.name}`);
        console.log(`   Activity: ${trader.activityCount} event(s)`);
        console.log(`   Last Active: ${trader.lastActivityAt.toISOString()}`);
        console.log();
      });
    } else {
      console.log('No traders found yet.');
    }
    
    console.log('═'.repeat(60));
    console.log('EXAMPLE NOTIFICATION FORMAT');
    console.log('═'.repeat(60));
    console.log();
    
    const exampleAvatar = cachedAvatar;
    const exampleWallet = firstWallet.address;
    
    console.log('Before (Raw Address):');
    console.log(`  👤 Buyer: \`${exampleWallet.slice(0, 4)}...${exampleWallet.slice(-4)}\``);
    console.log();
    
    console.log('After (With Avatar):');
    console.log(`  ${exampleAvatar.emoji} Buyer: *${exampleAvatar.name}*`);
    console.log(`      \`${exampleWallet.slice(0, 4)}...${exampleWallet.slice(-4)}\``);
    console.log();
    
    console.log('✅ Wallet Avatar Demo Complete!');
    console.log();
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Run the example
main().catch(console.error);
