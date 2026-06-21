#!/usr/bin/env node
/**
 * Backfill lastActiveAt for existing avatars
 * Sets lastActiveAt to updatedAt (or createdAt if updatedAt is missing)
 */

import dotenv from 'dotenv';

import { openDatabase } from './lib/openDatabase.mjs';

dotenv.config();

async function backfillLastActiveAt() {
  let handle;
  
  try {
    handle = await openDatabase();
    console.log(`🔌 Connected to ${handle.backend} database`);
    const db = handle.db;
    const avatars = db.collection('avatars');

    // Find avatars without lastActiveAt
    const count = await avatars.countDocuments({ lastActiveAt: { $exists: false } });
    console.log(`📊 Found ${count} avatars without lastActiveAt`);

    if (count === 0) {
      console.log('✅ All avatars already have lastActiveAt!');
      return;
    }

    const missing = await avatars.find({ lastActiveAt: { $exists: false } }).toArray();
    let modifiedCount = 0;
    for (const avatar of missing) {
      await avatars.updateOne(
        { _id: avatar._id },
        { $set: { lastActiveAt: avatar.updatedAt || avatar.createdAt || new Date() } }
      );
      modifiedCount += 1;
    }

    console.log(`✅ Updated ${modifiedCount} avatars with lastActiveAt`);
    
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
    await handle?.close?.();
    console.log('\n👋 Done!');
  }
}

backfillLastActiveAt();
