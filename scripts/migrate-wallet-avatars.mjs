/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Migrate wallet_avatars collection to avatars collection
 * The old WalletAvatarService created a separate collection that needs to be merged
 */

import dotenv from 'dotenv';

import { openDatabase } from './lib/openDatabase.mjs';

dotenv.config();

async function migrate() {
  let handle;
  
  try {
    handle = await openDatabase();
    console.log(`Connected to ${handle.backend} database`);
    
    const db = handle.db;
    
    // Check if wallet_avatars collection exists
    const collections = await db.listCollections().toArray();
    const walletAvatarsExists = collections.some(c => c.name === 'wallet_avatars');
    
    if (!walletAvatarsExists) {
      console.log('No wallet_avatars collection found - nothing to migrate');
      return;
    }
    
    const walletAvatars = db.collection('wallet_avatars');
    const avatars = db.collection('avatars');
    
    // Get all wallet avatars
    const walletAvatarDocs = await walletAvatars.find({}).toArray();
    console.log(`Found ${walletAvatarDocs.length} documents in wallet_avatars collection`);
    
    let migrated = 0;
    let skipped = 0;
    let updated = 0;
    
    for (const walletAvatar of walletAvatarDocs) {
      const walletAddress = walletAvatar.walletAddress;
      
      if (!walletAddress) {
        console.warn(`Skipping wallet avatar without wallet address:`, walletAvatar._id);
        skipped++;
        continue;
      }
      
      // Check if avatar already exists in avatars collection
      const existing = await avatars.findOne({ walletAddress });
      
      if (existing) {
        console.log(`Avatar already exists for ${walletAddress.substring(0, 4)}...${walletAddress.slice(-4)}, updating...`);
        
        // Merge data - prefer wallet_avatars if it has better data
        const updates = {};
        
        if (walletAvatar.name && !existing.name) {
          updates.name = walletAvatar.name;
        }
        if (walletAvatar.emoji && !existing.emoji) {
          updates.emoji = walletAvatar.emoji;
        }
        if (walletAvatar.description && !existing.description) {
          updates.description = walletAvatar.description;
        }
        if (walletAvatar.personality && !existing.personality) {
          updates.personality = walletAvatar.personality;
        }
        if (walletAvatar.imageUrl && !existing.imageUrl) {
          updates.imageUrl = walletAvatar.imageUrl;
        }
        if (walletAvatar.tokenBalances && Object.keys(walletAvatar.tokenBalances).length > 0) {
          updates.tokenBalances = { ...existing.tokenBalances, ...walletAvatar.tokenBalances };
        }
        if (walletAvatar.nftBalances && Object.keys(walletAvatar.nftBalances).length > 0) {
          updates.nftBalances = { ...existing.nftBalances, ...walletAvatar.nftBalances };
        }
        
        if (Object.keys(updates).length > 0) {
          updates.updatedAt = new Date();
          await avatars.updateOne({ _id: existing._id }, { $set: updates });
          console.log(`Updated avatar with wallet_avatars data: ${Object.keys(updates).join(', ')}`);
          updated++;
        } else {
          console.log(`No new data to merge for ${walletAddress.substring(0, 4)}...${walletAddress.slice(-4)}`);
          skipped++;
        }
      } else {
        // Create new avatar from wallet_avatars data
        console.log(`Migrating wallet avatar for ${walletAddress.substring(0, 4)}...${walletAddress.slice(-4)}`);
        
        const newAvatar = {
          name: walletAvatar.name || `Trader ${walletAddress.substring(0, 4)}...${walletAddress.slice(-4)}`,
          emoji: walletAvatar.emoji || '👤',
          description: walletAvatar.description || 'A trader on Solana',
          personality: walletAvatar.personality || 'mysterious',
          imageUrl: walletAvatar.imageUrl || null,
          model: walletAvatar.model || 'migrated',
          walletAddress: walletAddress,
          tokenBalances: walletAvatar.tokenBalances || {},
          nftBalances: walletAvatar.nftBalances || {},
          channelId: walletAvatar.channelId || null,
          guildId: walletAvatar.guildId || null,
          summoner: walletAvatar.summoner || `wallet:${walletAddress}`,
          lives: walletAvatar.lives ?? 3,
          status: walletAvatar.status || 'alive',
          createdAt: walletAvatar.createdAt || new Date(),
          updatedAt: new Date()
        };
        
        await avatars.insertOne(newAvatar);
        migrated++;
      }
    }
    
    console.log(`\nMigration complete:`);
    console.log(`  - Migrated: ${migrated}`);
    console.log(`  - Updated: ${updated}`);
    console.log(`  - Skipped: ${skipped}`);
    console.log(`  - Total: ${walletAvatarDocs.length}`);
    
    // Ask if we should rename the old collection
    console.log(`\nTo archive the old collection, run:`);
    console.log(`db.wallet_avatars.renameCollection('wallet_avatars_archived')`);
    
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await handle?.close?.();
  }
}

migrate();
