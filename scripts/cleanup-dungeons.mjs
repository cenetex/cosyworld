#!/usr/bin/env node
/**
 * Cleanup old dungeons script
 * Marks all active dungeons as abandoned to allow fresh starts with threads
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGO_DB_NAME || process.env.MONGODB_DB || 'cosyworld';

async function cleanupDungeons() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db(DB_NAME);
    const dungeonsCol = db.collection('dungeons');
    
    // Find all active dungeons
    const activeDungeons = await dungeonsCol.find({ status: 'active' }).toArray();
    
    console.log(`\nFound ${activeDungeons.length} active dungeon(s):`);
    
    for (const dungeon of activeDungeons) {
      console.log(`  - ${dungeon.name} (Party: ${dungeon.partyId})`);
      console.log(`    Thread ID: ${dungeon.threadId || 'None'}`);
      console.log(`    Channel ID: ${dungeon.channelId || 'None'}`);
      console.log(`    Rooms: ${dungeon.rooms?.length || 0}`);
      console.log(`    Created: ${dungeon.createdAt}`);
    }
    
    if (activeDungeons.length === 0) {
      console.log('\nNo active dungeons to clean up.');
      return;
    }
    
    // Mark all as abandoned
    const result = await dungeonsCol.updateMany(
      { status: 'active' },
      { 
        $set: { 
          status: 'abandoned',
          abandonedAt: new Date(),
          cleanupReason: 'System reset for thread-based dungeons'
        } 
      }
    );
    
    console.log(`\n✅ Marked ${result.modifiedCount} dungeon(s) as abandoned.`);
    console.log('Players can now start fresh dungeons with threads!');
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\nDisconnected from MongoDB');
  }
}

cleanupDungeons();
