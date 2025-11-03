/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Check for wallet avatar in database
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME || 'cosyworld';

if (!MONGO_URI) {
  console.error('Error: MONGO_URI environment variable not set');
  process.exit(1);
}

async function checkWallet() {
  const client = new MongoClient(MONGO_URI);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB\n');
    
    const db = client.db(DB_NAME);
    
    // List all collections
    const collections = await db.listCollections().toArray();
    console.log('Available collections:');
    collections.forEach(c => console.log(`  - ${c.name}`));
    console.log('');
    
    // Search for the 5Q5...e4j1 wallet
    const walletAddress = '5Q54LDvGmkenD5SxuKPm5xtkQ4U8N6ApoikP5PzXe4j1';
    const shortAddress = `5Q54...e4j1`;
    
    console.log(`Searching for wallet ${shortAddress}...\n`);
    
    // Check avatars collection
    const avatarsCollection = db.collection('avatars');
    const avatarsCount = await avatarsCollection.countDocuments();
    console.log(`Total avatars in collection: ${avatarsCount}`);
    
    const avatar = await avatarsCollection.findOne({ walletAddress });
    if (avatar) {
      console.log(`\n✅ Found avatar in 'avatars' collection:`);
      console.log(`  Name: ${avatar.name}`);
      console.log(`  Emoji: ${avatar.emoji}`);
      console.log(`  Wallet: ${avatar.walletAddress}`);
      console.log(`  Status: ${avatar.status}`);
      console.log(`  Created: ${avatar.createdAt}`);
      console.log(`  Model: ${avatar.model}`);
      console.log(`  Has image: ${!!avatar.imageUrl}`);
    } else {
      console.log(`\n❌ No avatar found in 'avatars' collection for ${shortAddress}`);
    }
    
    // Check if wallet_avatars collection exists
    if (collections.some(c => c.name === 'wallet_avatars')) {
      const walletAvatarsCollection = db.collection('wallet_avatars');
      const walletAvatarsCount = await walletAvatarsCollection.countDocuments();
      console.log(`\nTotal wallet_avatars in collection: ${walletAvatarsCount}`);
      
      const walletAvatar = await walletAvatarsCollection.findOne({ walletAddress });
      if (walletAvatar) {
        console.log(`\n✅ Found avatar in 'wallet_avatars' collection:`);
        console.log(`  Name: ${walletAvatar.name}`);
        console.log(`  Emoji: ${walletAvatar.emoji}`);
        console.log(`  Wallet: ${walletAvatar.walletAddress}`);
        console.log(`  Status: ${walletAvatar.status}`);
        console.log(`  Created: ${walletAvatar.createdAt}`);
      } else {
        console.log(`\n❌ No avatar found in 'wallet_avatars' collection for ${shortAddress}`);
      }
    }
    
    // Search for any avatar with wallet in any field
    console.log(`\nSearching for ${shortAddress} in any avatar field...`);
    const anyMatch = await avatarsCollection.findOne({
      $or: [
        { walletAddress },
        { walletAddress: { $regex: '5Q54.*e4j1' } },
        { summoner: `wallet:${walletAddress}` }
      ]
    });
    
    if (anyMatch) {
      console.log(`\n✅ Found matching avatar:`);
      console.log(JSON.stringify(anyMatch, null, 2));
    } else {
      console.log(`\n❌ No matches found`);
    }
    
  } catch (error) {
    console.error('Error:', error);
    throw error;
  } finally {
    await client.close();
  }
}

checkWallet();
