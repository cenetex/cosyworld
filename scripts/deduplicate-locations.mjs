/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file deduplicate-locations.mjs
 * @description Script to identify and clean up duplicate location records
 * 
 * This script:
 * 1. Finds locations with duplicate channelId values
 * 2. For each duplicate set, keeps the oldest record (by createdAt)
 * 3. Removes all newer duplicates
 * 4. Creates unique index on channelId if it doesn't exist
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('Error: MONGO_URI environment variable is not set');
  process.exit(1);
}

async function deduplicateLocations() {
  const client = new MongoClient(MONGO_URI);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db();
    const locationsCollection = db.collection('locations');
    
    // Find duplicate channelIds
    const duplicates = await locationsCollection.aggregate([
      {
        $group: {
          _id: '$channelId',
          count: { $sum: 1 },
          docs: { $push: { _id: '$_id', createdAt: '$createdAt', name: '$name' } }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      }
    ]).toArray();
    
    if (duplicates.length === 0) {
      console.log('✅ No duplicate locations found!');
      return;
    }
    
    console.log(`\n⚠️  Found ${duplicates.length} channelIds with duplicates:\n`);
    
    let totalDuplicates = 0;
    const idsToDelete = [];
    
    for (const dup of duplicates) {
      const channelId = dup._id;
      const docs = dup.docs;
      
      console.log(`\nChannel ID: ${channelId} (${dup.count} duplicates)`);
      
      // Sort by createdAt (oldest first)
      docs.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt) : new Date(0);
        const dateB = b.createdAt ? new Date(b.createdAt) : new Date(0);
        return dateA - dateB;
      });
      
      // Keep the oldest (first in sorted array)
      const keepDoc = docs[0];
      console.log(`  ✓ Keeping: ${keepDoc.name} (${keepDoc.createdAt || 'no date'})`);
      
      // Mark the rest for deletion
      for (let i = 1; i < docs.length; i++) {
        const deleteDoc = docs[i];
        console.log(`  ✗ Deleting: ${deleteDoc.name} (${deleteDoc.createdAt || 'no date'})`);
        idsToDelete.push(deleteDoc._id);
        totalDuplicates++;
      }
    }
    
    console.log(`\n📊 Summary:`);
    console.log(`   - Total duplicate location records to remove: ${totalDuplicates}`);
    console.log(`   - Unique locations to keep: ${duplicates.length}`);
    
    // Ask for confirmation
    console.log('\n⚠️  This will permanently delete the duplicate records!');
    console.log('   Run with --execute flag to proceed with deletion.\n');
    
    if (process.argv.includes('--execute')) {
      if (idsToDelete.length > 0) {
        const result = await locationsCollection.deleteMany({
          _id: { $in: idsToDelete }
        });
        console.log(`\n✅ Deleted ${result.deletedCount} duplicate location records`);
      }
      
      // Create unique index
      try {
        await locationsCollection.createIndex(
          { channelId: 1 },
          { unique: true, background: true }
        );
        console.log('✅ Created unique index on channelId');
      } catch (err) {
        if (err.code === 85 || err.code === 86) {
          console.log('ℹ️  Unique index on channelId already exists');
        } else {
          console.error('❌ Failed to create unique index:', err.message);
        }
      }
    } else {
      console.log('💡 Tip: Run with --execute flag to perform the cleanup:');
      console.log('   node scripts/deduplicate-locations.mjs --execute\n');
    }
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\nDisconnected from MongoDB');
  }
}

// Run the script
deduplicateLocations();
