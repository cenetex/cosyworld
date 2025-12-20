#!/usr/bin/env node
/**
 * Reset an avatar's model to a specific value.
 * Usage: node scripts/reset-avatar-model.mjs "avatar name" "model-id"
 */
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('MONGO_URI not set');
  process.exit(1);
}

const avatarName = process.argv[2];
const newModel = process.argv[3];

if (!avatarName || !newModel) {
  console.log('Usage: node scripts/reset-avatar-model.mjs "avatar name" "model-id"');
  console.log('Example: node scripts/reset-avatar-model.mjs "flux.2 MAX (Black Forest Labs)" "black-forest-labs/flux.2-max"');
  process.exit(1);
}

const client = new MongoClient(MONGO_URI);

async function main() {
  try {
    await client.connect();
    const dbName = process.env.MONGO_DB_NAME || 'cosyworld8';
    const db = client.db(dbName);
    console.log(`Using database: ${dbName}`);
    
    // Find the avatar
    const avatar = await db.collection('avatars').findOne({ name: avatarName });
    if (!avatar) {
      console.log(`Avatar "${avatarName}" not found. Trying regex...`);
      const regex = new RegExp(avatarName, 'i');
      const found = await db.collection('avatars').findOne({ name: regex });
      if (found) {
        console.log(`Found: "${found.name}" with model "${found.model}"`);
        console.log('Re-run with the exact name if you want to update it.');
      } else {
        console.log('No matching avatar found.');
      }
      return;
    }
    
    console.log(`Found avatar: "${avatar.name}"`);
    console.log(`Current model: "${avatar.model}"`);
    console.log(`Setting model to: "${newModel}"`);
    
    const result = await db.collection('avatars').updateOne(
      { _id: avatar._id },
      { $set: { model: newModel } }
    );
    
    console.log(`Updated: ${result.modifiedCount} document(s)`);
  } finally {
    await client.close();
  }
}

main().catch(console.error);
