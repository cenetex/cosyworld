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
      // TELEGRAM RECENT MEDIA COLLECTION INDEXES
      // ========================================================================
      console.log('\n🖼️  Creating indexes for telegram_recent_media collection...');

      const recentMediaCollection = db.collection('telegram_recent_media');
      let existingRecentMediaNames = [];
      try {
        const indexes = await recentMediaCollection.indexes();
        existingRecentMediaNames = indexes.map(idx => idx.name);
      } catch (error) {
        if (error.code === 26) {
          console.log('  ℹ️  Collection does not exist yet, will be created on first insert');
          existingRecentMediaNames = [];
        } else {
          throw error;
        }
      }

      if (!existingRecentMediaNames.includes('channelId_createdAt')) {
        try {
          await recentMediaCollection.createIndex(
            { channelId: 1, createdAt: -1 },
            { name: 'channelId_createdAt' }
          );
          console.log('  ✓ Created index: channelId + createdAt');
        } catch (error) {
          if (error.code === 85) {
            console.log('  ℹ️  Index exists (different name): channelId + createdAt');
          } else {
            throw error;
          }
        }
      } else {
        console.log('  ✓ Index already exists: channelId + createdAt');
      }

      if (!existingRecentMediaNames.includes('createdAt_ttl_recent_media')) {
        try {
          await recentMediaCollection.createIndex(
            { createdAt: 1 },
            {
              name: 'createdAt_ttl_recent_media',
              expireAfterSeconds: 3 * 24 * 60 * 60 // 3 days
            }
          );
          console.log('  ✓ Created TTL index: createdAt (3 days)');
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
    // TELEGRAM AGENT PLANS COLLECTION INDEXES
    // ========================================================================
    console.log('\n🧠  Creating indexes for telegram_agent_plans collection...');

    const agentPlansCollection = db.collection('telegram_agent_plans');
    let existingAgentPlanNames = [];
    try {
      const indexes = await agentPlansCollection.indexes();
      existingAgentPlanNames = indexes.map(idx => idx.name);
    } catch (error) {
      if (error.code === 26) {
        console.log('  ℹ️  Collection does not exist yet, will be created on first insert');
        existingAgentPlanNames = [];
      } else {
        throw error;
      }
    }

    if (!existingAgentPlanNames.includes('channelId_createdAt_agent_plan')) {
      try {
        await agentPlansCollection.createIndex(
          { channelId: 1, createdAt: -1 },
          { name: 'channelId_createdAt_agent_plan' }
        );
        console.log('  ✓ Created index: channelId + createdAt');
      } catch (error) {
        if (error.code === 85) {
          console.log('  ℹ️  Index exists (different name): channelId + createdAt');
        } else {
          throw error;
        }
      }
    } else {
      console.log('  ✓ Index already exists: channelId + createdAt');
    }

    if (!existingAgentPlanNames.includes('createdAt_ttl_agent_plan')) {
      try {
        await agentPlansCollection.createIndex(
          { createdAt: 1 },
          {
            name: 'createdAt_ttl_agent_plan',
            expireAfterSeconds: 3 * 24 * 60 * 60 // 3 days
          }
        );
        console.log('  ✓ Created TTL index: createdAt (3 days)');
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
    // TELEGRAM MEMBERS COLLECTION INDEXES
    // ========================================================================
    console.log('\n📊 Creating indexes for telegram_members collection...');

    const telegramMembersCollection = db.collection('telegram_members');

    let existingMemberIndexes = [];
    let existingMemberNames = [];
    try {
      existingMemberIndexes = await telegramMembersCollection.indexes();
      existingMemberNames = existingMemberIndexes.map(idx => idx.name);
    } catch (error) {
      if (error.code === 26) {
        console.log('  ℹ️  Collection does not exist yet, will be created on first insert');
        existingMemberNames = [];
      } else {
        throw error;
      }
    }

    if (!existingMemberNames.includes('channelId_userId_unique')) {
      try {
        await telegramMembersCollection.createIndex(
          { channelId: 1, userId: 1 },
          { unique: true, name: 'channelId_userId_unique' }
        );
        console.log('  ✓ Created unique index: channelId + userId');
      } catch (error) {
        if (error.code === 85 || error.codeName === 'IndexOptionsConflict') {
          console.log('  ℹ️  Unique index already exists for channelId + userId');
        } else {
          throw error;
        }
      }
    } else {
      console.log('  ✓ Index already exists: channelId + userId');
    }

    if (!existingMemberNames.includes('channelId_trustLevel')) {
      try {
        await telegramMembersCollection.createIndex(
          { channelId: 1, trustLevel: 1 },
          { name: 'channelId_trustLevel' }
        );
        console.log('  ✓ Created index: channelId + trustLevel');
      } catch (error) {
        if (error.code === 85) {
          console.log('  ℹ️  Index exists (different name): channelId + trustLevel');
        } else {
          throw error;
        }
      }
    } else {
      console.log('  ✓ Index already exists: channelId + trustLevel');
    }

    if (!existingMemberNames.includes('channelId_joinedAt')) {
      try {
        await telegramMembersCollection.createIndex(
          { channelId: 1, joinedAt: 1 },
          { name: 'channelId_joinedAt' }
        );
        console.log('  ✓ Created index: channelId + joinedAt');
      } catch (error) {
        if (error.code === 85) {
          console.log('  ℹ️  Index exists (different name): channelId + joinedAt');
        } else {
          throw error;
        }
      }
    } else {
      console.log('  ✓ Index already exists: channelId + joinedAt');
    }

    if (!existingMemberNames.includes('penaltyExpires')) {
      try {
        await telegramMembersCollection.createIndex(
          { penaltyExpires: 1 },
          { name: 'penaltyExpires' }
        );
        console.log('  ✓ Created index: penaltyExpires');
      } catch (error) {
        if (error.code === 85) {
          console.log('  ℹ️  Index exists (different name): penaltyExpires');
        } else {
          throw error;
        }
      }
    } else {
      console.log('  ✓ Index already exists: penaltyExpires');
    }

    // ========================================================================
    // BUYBOT TRACKED TOKENS COLLECTION INDEXES
    // ========================================================================
    console.log('\n📊 Creating indexes for buybot_tracked_tokens collection...');
    
    const buybotTokensCollection = db.collection('buybot_tracked_tokens');
    
    // Get existing indexes (collection may not exist yet)
    let existingBuybotIndexes = [];
    let existingBuybotNames = [];
    try {
      existingBuybotIndexes = await buybotTokensCollection.indexes();
      existingBuybotNames = existingBuybotIndexes.map(idx => idx.name);
    } catch (error) {
      if (error.code === 26) {
        console.log('  ℹ️  Collection does not exist yet, will be created on first insert');
        existingBuybotNames = [];
      } else {
        throw error;
      }
    }
    
    // Primary lookup: channelId + active (for listing tracked tokens)
    if (!existingBuybotNames.includes('channelId_active')) {
      try {
        await buybotTokensCollection.createIndex(
          { channelId: 1, active: 1 },
          { name: 'channelId_active' }
        );
        console.log('  ✓ Created index: channelId + active');
      } catch (error) {
        if (error.code === 85) {
          console.log('  ℹ️  Index exists (different name): channelId + active');
        } else {
          throw error;
        }
      }
    } else {
      console.log('  ✓ Index already exists: channelId + active');
    }
    
    // Token address lookup
    if (!existingBuybotNames.includes('tokenAddress')) {
      try {
        await buybotTokensCollection.createIndex(
          { tokenAddress: 1 },
          { name: 'tokenAddress' }
        );
        console.log('  ✓ Created index: tokenAddress');
      } catch (error) {
        if (error.code === 85) {
          console.log('  ℹ️  Index exists (different name): tokenAddress');
        } else {
          throw error;
        }
      }
    } else {
      console.log('  ✓ Index already exists: tokenAddress');
    }
    
    // ========================================================================
    // BUYBOT TOKEN EVENTS COLLECTION INDEXES
    // ========================================================================
    console.log('\n📊 Creating indexes for buybot_token_events collection...');
    
    const buybotEventsCollection = db.collection('buybot_token_events');
    
    // Get existing indexes (collection may not exist yet)
    let existingEventIndexes = [];
    let existingEventNames = [];
    try {
      existingEventIndexes = await buybotEventsCollection.indexes();
      existingEventNames = existingEventIndexes.map(idx => idx.name);
    } catch (error) {
      if (error.code === 26) {
        console.log('  ℹ️  Collection does not exist yet, will be created on first insert');
        existingEventNames = [];
      } else {
        throw error;
      }
    }
    
    // Primary lookup: channelId + tokenAddress + timestamp (for recent events)
    if (!existingEventNames.includes('channelId_tokenAddress_timestamp')) {
      try {
        await buybotEventsCollection.createIndex(
          { channelId: 1, tokenAddress: 1, timestamp: -1 },
          { name: 'channelId_tokenAddress_timestamp' }
        );
        console.log('  ✓ Created index: channelId + tokenAddress + timestamp');
      } catch (error) {
        if (error.code === 85) {
          console.log('  ℹ️  Index exists (different name): channelId + tokenAddress + timestamp');
        } else {
          throw error;
        }
      }
    } else {
      console.log('  ✓ Index already exists: channelId + tokenAddress + timestamp');
    }
    
    // TTL index: auto-delete old events after 30 days
    if (!existingEventNames.includes('timestamp_ttl')) {
      try {
        await buybotEventsCollection.createIndex(
          { timestamp: 1 },
          { 
            name: 'timestamp_ttl',
            expireAfterSeconds: 30 * 24 * 60 * 60 // 30 days
          }
        );
        console.log('  ✓ Created TTL index: timestamp (30 days)');
      } catch (error) {
        if (error.code === 85) {
          console.log('  ℹ️  TTL index exists (different name): timestamp');
        } else {
          throw error;
        }
      }
    } else {
      console.log('  ✓ Index already exists: timestamp (TTL)');
    }
    
    // ========================================================================
    // UNIFIED CHANNEL SUMMARIES COLLECTION INDEXES
    // ========================================================================
    console.log('\n📊 Creating indexes for unified_channel_summaries collection...');
    
    const channelSummariesCollection = db.collection('unified_channel_summaries');
    
    // Get existing indexes (collection may not exist yet)
    let existingSummaryIndexes = [];
    let existingSummaryNames = [];
    try {
      existingSummaryIndexes = await channelSummariesCollection.indexes();
      existingSummaryNames = existingSummaryIndexes.map(idx => idx.name);
    } catch (error) {
      if (error.code === 26) {
        console.log('  ℹ️  Collection does not exist yet, will be created on first insert');
        existingSummaryNames = [];
      } else {
        throw error;
      }
    }
    
    // Unique composite ID (platform + channelId)
    if (!existingSummaryNames.includes('compositeId_unique')) {
      try {
        await channelSummariesCollection.createIndex(
          { compositeId: 1 },
          { unique: true, name: 'compositeId_unique' }
        );
        console.log('  ✓ Created unique index: compositeId');
      } catch (error) {
        if (error.code === 85) {
          console.log('  ℹ️  Index exists (different name): compositeId');
        } else {
          throw error;
        }
      }
    } else {
      console.log('  ✓ Index already exists: compositeId');
    }
    
    // Platform + channelId lookup
    if (!existingSummaryNames.includes('platform_channelId')) {
      try {
        await channelSummariesCollection.createIndex(
          { platform: 1, channelId: 1 },
          { name: 'platform_channelId' }
        );
        console.log('  ✓ Created index: platform + channelId');
      } catch (error) {
        if (error.code === 85) {
          console.log('  ℹ️  Index exists (different name): platform + channelId');
        } else {
          throw error;
        }
      }
    } else {
      console.log('  ✓ Index already exists: platform + channelId');
    }
    
    // Last updated (for finding stale summaries)
    if (!existingSummaryNames.includes('lastUpdated')) {
      try {
        await channelSummariesCollection.createIndex(
          { lastUpdated: 1 },
          { name: 'lastUpdated' }
        );
        console.log('  ✓ Created index: lastUpdated');
      } catch (error) {
        if (error.code === 85) {
          console.log('  ℹ️  Index exists (different name): lastUpdated');
        } else {
          throw error;
        }
      }
    } else {
      console.log('  ✓ Index already exists: lastUpdated');
    }
    
    // Active avatars (for filtering by avatar participation)
    if (!existingSummaryNames.includes('activeAvatarIds')) {
      try {
        await channelSummariesCollection.createIndex(
          { activeAvatarIds: 1 },
          { name: 'activeAvatarIds', sparse: true }
        );
        console.log('  ✓ Created index: activeAvatarIds');
      } catch (error) {
        if (error.code === 85) {
          console.log('  ℹ️  Index exists (different name): activeAvatarIds');
        } else {
          throw error;
        }
      }
    } else {
      console.log('  ✓ Index already exists: activeAvatarIds');
    }
    
    // ========================================================================
    // STORY PLANS COLLECTION INDEXES
    // ========================================================================
    console.log('\n📊 Creating indexes for story_plans collection...');
    
    const storyPlansCollection = db.collection('story_plans');
    
    // Get existing indexes (collection may not exist yet)
    let existingPlanIndexes = [];
    let existingPlanNames = [];
    try {
      existingPlanIndexes = await storyPlansCollection.indexes();
      existingPlanNames = existingPlanIndexes.map(idx => idx.name);
    } catch (error) {
      if (error.code === 26) {
        console.log('  ℹ️  Collection does not exist yet, will be created on first insert');
        existingPlanNames = [];
      } else {
        throw error;
      }
    }
    
    // Arc ID (unique for active plans)
    if (!existingPlanNames.includes('arcId')) {
      try {
        await storyPlansCollection.createIndex(
          { arcId: 1 },
          { name: 'arcId' }
        );
        console.log('  ✓ Created index: arcId');
      } catch (error) {
        if (error.code === 85) {
          console.log('  ℹ️  Index exists (different name): arcId');
        } else {
          throw error;
        }
      }
    } else {
      console.log('  ✓ Index already exists: arcId');
    }
    
    // Status (for finding active plans)
    if (!existingPlanNames.includes('status')) {
      try {
        await storyPlansCollection.createIndex(
          { status: 1 },
          { name: 'status' }
        );
        console.log('  ✓ Created index: status');
      } catch (error) {
        if (error.code === 85) {
          console.log('  ℹ️  Index exists (different name): status');
        } else {
          throw error;
        }
      }
    } else {
      console.log('  ✓ Index already exists: status');
    }
    
    // Current chapter (for progress tracking)
    if (!existingPlanNames.includes('currentChapter')) {
      try {
        await storyPlansCollection.createIndex(
          { currentChapter: 1 },
          { name: 'currentChapter', sparse: true }
        );
        console.log('  ✓ Created index: currentChapter');
      } catch (error) {
        if (error.code === 85) {
          console.log('  ℹ️  Index exists (different name): currentChapter');
        } else {
          throw error;
        }
      }
    } else {
      console.log('  ✓ Index already exists: currentChapter');
    }
    
    // Last updated (for finding stale plans)
    if (!existingPlanNames.includes('lastUpdated_plan')) {
      try {
        await storyPlansCollection.createIndex(
          { lastUpdated: 1 },
          { name: 'lastUpdated_plan' }
        );
        console.log('  ✓ Created index: lastUpdated');
      } catch (error) {
        if (error.code === 85) {
          console.log('  ℹ️  Index exists (different name): lastUpdated');
        } else {
          throw error;
        }
      }
    } else {
      console.log('  ✓ Index already exists: lastUpdated');
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

    try {
      const memberIndexes = await telegramMembersCollection.indexes();
      console.log(`  ✓ telegram_members: ${memberIndexes.length} indexes`);
    } catch (error) {
      if (error.code === 26) {
        console.log(`  ℹ️  telegram_members: indexes will be created on first use`);
      } else {
        throw error;
      }
    }
    
    try {
      const summaryIndexes = await channelSummariesCollection.indexes();
      console.log(`  ✓ unified_channel_summaries: ${summaryIndexes.length} indexes`);
    } catch (error) {
      if (error.code === 26) {
        console.log(`  ℹ️  unified_channel_summaries: indexes will be created on first use`);
      } else {
        throw error;
      }
    }
    
    try {
      const planIndexes = await storyPlansCollection.indexes();
      console.log(`  ✓ story_plans: ${planIndexes.length} indexes`);
    } catch (error) {
      if (error.code === 26) {
        console.log(`  ℹ️  story_plans: indexes will be created on first use`);
      } else {
        throw error;
      }
    }
    
    try {
      const buybotIndexes = await buybotTokensCollection.indexes();
      console.log(`  ✓ buybot_tracked_tokens: ${buybotIndexes.length} indexes`);
    } catch (error) {
      if (error.code === 26) {
        console.log(`  ℹ️  buybot_tracked_tokens: indexes will be created on first use`);
      } else {
        throw error;
      }
    }
    
    try {
      const eventIndexes = await buybotEventsCollection.indexes();
      console.log(`  ✓ buybot_token_events: ${eventIndexes.length} indexes`);
    } catch (error) {
      if (error.code === 26) {
        console.log(`  ℹ️  buybot_token_events: indexes will be created on first use`);
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
  console.log('  - telegram_members: 4 indexes (unique member, trust lookup, joinedAt, penaltyExpires)');
    console.log('  - buybot_tracked_tokens: 2 indexes (channelId+active, tokenAddress)');
    console.log('  - buybot_token_events: 2 indexes (channelId+tokenAddress+timestamp, TTL 30d)');
    console.log('  - unified_channel_summaries: 4 indexes (unique compositeId, platform+channel, lastUpdated, avatarIds)');
    console.log('  - story_plans: 4 indexes (arcId, status, currentChapter, lastUpdated)');
    console.log('\n🚀 Database is ready for production deployment!');
    
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
