#!/usr/bin/env node
/**
 * Backfill lastActiveAt for existing avatars
 * Sets lastActiveAt to updatedAt (or createdAt if updatedAt is missing)
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = 'cosyworld8';

async function backfillLastActiveAt() {
  if (!MONGO_URI) {
    console.error('❌ MONGO_URI not found in environment');
    process.exit(1);
  }

  const client = new MongoClient(MONGO_URI);
  
  try {
    console.log('🔌 Connecting to MongoDB...');
    await client.connect();
    const db = client.db(DB_NAME);
    const avatars = db.collection('avatars');

    // Find avatars without lastActiveAt
    const count = await avatars.countDocuments({ lastActiveAt: { $exists: false } });
    console.log(`📊 Found ${count} avatars without lastActiveAt`);

    if (count === 0) {
      console.log('✅ All avatars already have lastActiveAt!');
      return;
    }

    // Update avatars: set lastActiveAt to updatedAt or createdAt
    const result = await avatars.updateMany(
      { lastActiveAt: { $exists: false } },
      [{
        $set: {
          lastActiveAt: {
            $ifNull: ['$updatedAt', '$createdAt']
          }
        }
      }]
    );

    console.log(`✅ Updated ${result.modifiedCount} avatars with lastActiveAt`);
    
    // Show some examples
    const samples = await avatars
      .find({ lastActiveAt: { $exists: true } })
      .sort({ lastActiveAt: -1 })
      .limit(5)
      .toArray();
    
    console.log('\n📝 Sample avatars with lastActiveAt:');
    samples.forEach(av => {
      const name = `${av.emoji || ''} ${av.name}`.trim();
      const lastActive = av.lastActiveAt?.toISOString().split('T')[0] || 'N/A';
      console.log(`  - ${name}: ${lastActive}`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\n👋 Done!');
  }
}

backfillLastActiveAt();
