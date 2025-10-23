#!/usr/bin/env node
/**
 * Database Index Creation Script
 * Phase 2 Production Deployment
 * 
 * Creates optimized indexes for:
 * - presence collection
 * - conversation_sessions collection
 * - response_locks collection
 * 
 * Run before production deployment:
 * node scripts/create-indexes.js
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'cosyworld';

async function createIndexes() {
  console.log('🔧 Starting index creation for Phase 2 deployment...\n');
  
  const client = new MongoClient(MONGO_URI);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    const db = client.db(MONGO_DB_NAME);
    
    // ========================================================================
    // PRESENCE COLLECTION INDEXES
    // ========================================================================
    console.log('\n📊 Creating indexes for presence collection...');
    
    const presenceCollection = db.collection('presence');
    
    // Get existing indexes
    const existingPresenceIndexes = await presenceCollection.indexes();
    const existingPresenceNames = existingPresenceIndexes.map(idx => idx.name);
    
    // Primary lookup: channelId + avatarId (unique)
    if (!existingPresenceNames.includes('channelId_avatarId_unique')) {
      try {
        await presenceCollection.createIndex(
          { channelId: 1, avatarId: 1 },
          { unique: true, name: 'channelId_avatarId_unique' }
        );
        console.log('  ✓ Created unique index: channelId + avatarId');
      } catch (error) {
        if (error.code === 85 || error.codeName === 'IndexOptionsConflict') {
          console.log('  ℹ️  Index exists (different name): channelId + avatarId');
        } else {
          throw error;
        }
      }
    } else {
      console.log('  ✓ Index already exists: channelId + avatarId');
    }
    
    // State-based queries (listing present avatars)
    if (!existingPresenceNames.includes('channelId_state')) {
      try {
        await presenceCollection.createIndex(
          { channelId: 1, state: 1 },
          { name: 'channelId_state' }
        );
        console.log('  ✓ Created index: channelId + state');
      } catch (error) {
        if (error.code === 85) {
          console.log('  ℹ️  Index exists (different name): channelId + state');
        } else {
          throw error;
        }
      }
    } else {
      console.log('  ✓ Index already exists: channelId + state');
    }
    
    // Turn sorting (finding oldest lastTurnAt for hunger)
    if (!existingPresenceNames.includes('channelId_lastTurnAt')) {
      try {
        await presenceCollection.createIndex(
          { channelId: 1, lastTurnAt: 1 },
          { name: 'channelId_lastTurnAt' }
        );
        console.log('  ✓ Created index: channelId + lastTurnAt');
      } catch (error) {
        if (error.code === 85) {
          console.log('  ℹ️  Index exists (different name): channelId + lastTurnAt');
        } else {
          throw error;
        }
      }
    } else {
      console.log('  ✓ Index already exists: channelId + lastTurnAt');
    }
    
    // Summon turn queries
    if (!existingPresenceNames.includes('channelId_summonTurns')) {
      try {
        await presenceCollection.createIndex(
          { channelId: 1, newSummonTurnsRemaining: 1 },
          { name: 'channelId_summonTurns', sparse: true }
        );
        console.log('  ✓ Created index: channelId + newSummonTurnsRemaining');
      } catch (error) {
        if (error.code === 85) {
          console.log('  ℹ️  Index exists (different name): channelId + newSummonTurnsRemaining');
        } else {
          throw error;
        }
      }
    } else {
      console.log('  ✓ Index already exists: channelId + newSummonTurnsRemaining');
    }
    
    // ========================================================================
    // CONVERSATION_SESSIONS COLLECTION INDEXES
    // ========================================================================
    console.log('\n📊 Creating indexes for conversation_sessions collection...');
    
    const sessionsCollection = db.collection('conversation_sessions');
    
    const existingSessionIndexes = await sessionsCollection.indexes();
    const existingSessionNames = existingSessionIndexes.map(idx => idx.name);
    
    // Primary lookup: channelId + userId (unique)
    if (!existingSessionNames.includes('channelId_userId_unique')) {
      try {
        await sessionsCollection.createIndex(
          { channelId: 1, userId: 1 },
          { unique: true, name: 'channelId_userId_unique' }
        );
        console.log('  ✓ Created unique index: channelId + userId');
      } catch (error) {
        if (error.code === 85) {
          console.log('  ℹ️  Index exists (different name): channelId + userId');
        } else {
          throw error;
        }
      }
    } else {
      console.log('  ✓ Index already exists: channelId + userId');
    }
    
    // TTL index for auto-cleanup (30 minutes)
    if (!existingSessionNames.includes('lastInteractionAt_ttl')) {
      try {
        await sessionsCollection.createIndex(
          { lastInteractionAt: 1 },
          { expireAfterSeconds: 1800, name: 'lastInteractionAt_ttl' }
        );
        console.log('  ✓ Created TTL index: lastInteractionAt (30 min expiry)');
      } catch (error) {
        if (error.code === 85) {
          console.log('  ℹ️  Index exists (different name): lastInteractionAt TTL');
        } else {
          throw error;
        }
      }
    } else {
      console.log('  ✓ Index already exists: lastInteractionAt TTL');
    }
    
    // ========================================================================
    // RESPONSE_LOCKS COLLECTION INDEXES
    // ========================================================================
    console.log('\n📊 Creating indexes for response_locks collection...');
    
    const locksCollection = db.collection('response_locks');
    
    const existingLockIndexes = await locksCollection.indexes();
    const existingLockNames = existingLockIndexes.map(idx => idx.name);
    
    // TTL index for auto-cleanup
    if (!existingLockNames.includes('expiresAt_ttl')) {
      try {
        await locksCollection.createIndex(
          { expiresAt: 1 },
          { expireAfterSeconds: 0, name: 'expiresAt_ttl' }
        );
        console.log('  ✓ Created TTL index: expiresAt (immediate expiry)');
      } catch (error) {
        if (error.code === 85) {
          console.log('  ℹ️  Index exists (different name): expiresAt TTL');
        } else {
          throw error;
        }
      }
    } else {
      console.log('  ✓ Index already exists: expiresAt TTL');
    }
    
    // Lookup by channel and avatar
    if (!existingLockNames.includes('channelId_avatarId')) {
      try {
        await locksCollection.createIndex(
          { channelId: 1, avatarId: 1 },
          { name: 'channelId_avatarId' }
        );
        console.log('  ✓ Created index: channelId + avatarId');
      } catch (error) {
        if (error.code === 85) {
          console.log('  ℹ️  Index exists (different name): channelId + avatarId');
        } else {
          throw error;
        }
      }
    } else {
      console.log('  ✓ Index already exists: channelId + avatarId');
    }
    
    // ========================================================================
    // TELEGRAM MESSAGES COLLECTION INDEXES
    // ========================================================================
    console.log('\n📊 Creating indexes for telegram_messages collection...');
    
    const telegramMessagesCollection = db.collection('telegram_messages');
    
    // Get existing indexes (collection may not exist yet)
    let existingTelegramIndexes = [];
    let existingTelegramNames = [];
    try {
      existingTelegramIndexes = await telegramMessagesCollection.indexes();
      existingTelegramNames = existingTelegramIndexes.map(idx => idx.name);
    } catch (error) {
      if (error.code === 26) {
        console.log('  ℹ️  Collection does not exist yet, will be created on first insert');
        existingTelegramNames = [];
      } else {
        throw error;
      }
    }
    
    // Primary lookup: channelId + date (for conversation history retrieval)
    if (!existingTelegramNames.includes('channelId_date')) {
      try {
        await telegramMessagesCollection.createIndex(
          { channelId: 1, date: -1 },
          { name: 'channelId_date' }
        );
        console.log('  ✓ Created index: channelId + date');
      } catch (error) {
        if (error.code === 85) {
          console.log('  ℹ️  Index exists (different name): channelId + date');
        } else {
          throw error;
        }
      }
    } else {
      console.log('  ✓ Index already exists: channelId + date');
    }
    
    // TTL index: auto-delete old messages after 30 days
    if (!existingTelegramNames.includes('createdAt_ttl')) {
      try {
        await telegramMessagesCollection.createIndex(
          { createdAt: 1 },
          { 
            name: 'createdAt_ttl',
            expireAfterSeconds: 30 * 24 * 60 * 60 // 30 days
          }
        );
        console.log('  ✓ Created TTL index: createdAt (30 days)');
      } catch (error) {
        if (error.code === 85) {
          console.log('  ℹ️  TTL index exists (different name): createdAt');
        } else {
          throw error;
        }
      }
    } else {
      console.log('  ✓ Index already exists: createdAt (TTL)');
    }
    
    // ========================================================================
    // TELEGRAM MEDIA USAGE COLLECTION INDEXES
    // ========================================================================
    console.log('\n📊 Creating indexes for telegram_media_usage collection...');
    
    const mediaUsageCollection = db.collection('telegram_media_usage');
    
    // Get existing indexes (collection may not exist yet)
    let existingMediaIndexes = [];
    let existingMediaNames = [];
    try {
      existingMediaIndexes = await mediaUsageCollection.indexes();
      existingMediaNames = existingMediaIndexes.map(idx => idx.name);
    } catch (error) {
      if (error.code === 26) {
        console.log('  ℹ️  Collection does not exist yet, will be created on first insert');
        existingMediaNames = [];
      } else {
        throw error;
      }
    }
    
    // Primary lookup: userId + mediaType + createdAt (for cooldown checks)
    if (!existingMediaNames.includes('userId_mediaType_createdAt')) {
      try {
        await mediaUsageCollection.createIndex(
          { userId: 1, mediaType: 1, createdAt: -1 },
          { name: 'userId_mediaType_createdAt' }
        );
        console.log('  ✓ Created index: userId + mediaType + createdAt');
      } catch (error) {
        if (error.code === 85) {
          console.log('  ℹ️  Index exists (different name): userId + mediaType + createdAt');
        } else {
          throw error;
        }
      }
    } else {
      console.log('  ✓ Index already exists: userId + mediaType + createdAt');
    }
    
    // TTL index: auto-delete old usage records after 30 days
    if (!existingMediaNames.includes('createdAt_ttl_media')) {
      try {
        await mediaUsageCollection.createIndex(
          { createdAt: 1 },
          { 
            name: 'createdAt_ttl_media',
            expireAfterSeconds: 30 * 24 * 60 * 60 // 30 days
          }
        );
        console.log('  ✓ Created TTL index: createdAt (30 days)');
      } catch (error) {
        if (error.code === 85) {
          console.log('  ℹ️  TTL index exists (different name): createdAt');
        } else {
          throw error;
        }
      }
    } else {
      console.log('  ✓ Index already exists: createdAt (TTL)');
    }
    
    // ========================================================================
    // VERIFICATION
    // ========================================================================
    console.log('\n🔍 Verifying indexes...');
    
    const presenceIndexes = await presenceCollection.indexes();
    console.log(`  ✓ presence: ${presenceIndexes.length} indexes`);
    
    const sessionIndexes = await sessionsCollection.indexes();
    console.log(`  ✓ conversation_sessions: ${sessionIndexes.length} indexes`);
    
    const lockIndexes = await locksCollection.indexes();
    console.log(`  ✓ response_locks: ${lockIndexes.length} indexes`);
    
    try {
      const telegramIndexes = await telegramMessagesCollection.indexes();
      console.log(`  ✓ telegram_messages: ${telegramIndexes.length} indexes`);
    } catch (error) {
      if (error.code === 26) {
        console.log(`  ℹ️  telegram_messages: indexes will be created on first use`);
      } else {
        throw error;
      }
    }
    
    try {
      const mediaIndexes = await mediaUsageCollection.indexes();
      console.log(`  ✓ telegram_media_usage: ${mediaIndexes.length} indexes`);
    } catch (error) {
      if (error.code === 26) {
        console.log(`  ℹ️  telegram_media_usage: indexes will be created on first use`);
      } else {
        throw error;
      }
    }
    
    console.log('\n✅ All indexes created successfully!');
    console.log('\n📝 Summary:');
    console.log('  - presence: 5 indexes (unique, state, turn timing, summons)');
    console.log('  - conversation_sessions: 2 indexes (unique, TTL)');
    console.log('  - response_locks: 2 indexes (TTL, lookup)');
    console.log('  - telegram_messages: 2 indexes (channelId+date, TTL 30d)');
    console.log('  - telegram_media_usage: 2 indexes (userId+mediaType+date, TTL 30d)');
    console.log('\n🚀 Database is ready for Phase 2 production deployment!');
    
  } catch (error) {
    console.error('\n❌ Error creating indexes:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Run the script
createIndexes().catch(console.error);
