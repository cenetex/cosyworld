/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

// scripts/add_uuid_to_items.js
import { MongoClient } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import { writeFileSync } from 'fs';
import { stringify } from 'csv-stringify/sync';
dotenv.config();

const uri = process.env.MONGO_URI || 'mongodb://localhost:27017'; // Update with your MongoDB URI
const dbName = 'cosyworld89'; // Update if needed

// Define a basic schema for compliance checking
const basicSchema = {
  required: ['name', 'description', 'type', 'rarity', 'createdAt', 'updatedAt', 'uuid'],
  allowedTypes: ['weapon', 'armor', 'consumable', 'quest', 'key', 'artifact'],
  allowedRarities: ['common', 'uncommon', 'rare', 'epic', 'legendary']
};

function checkCompliance(item) {
  // Check required fields
  for (const field of basicSchema.required) {
    if (!(field in item)) return false;
  }
  // Check type
  if (!basicSchema.allowedTypes.includes(item.type)) return false;
  // Check rarity
  if (!basicSchema.allowedRarities.includes(item.rarity)) return false;
  // Check uuid format (basic check)
  if (typeof item.uuid !== 'string' || item.uuid.length < 10) return false;
  return true;
}

async function addUUIDsAndCheckCompliance() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const collection = db.collection('items');

  const cursor = collection.find();
  let updated = 0;
  let nonCompliant = [];
  let allItems = [];

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    // Add uuid if missing
    if (!doc.uuid) {
      await collection.updateOne(
        { _id: doc._id },
        { $set: { uuid: uuidv4() } }
      );
      updated++;
      doc.uuid = 'added'; // Mark for compliance check
    }
    // Check compliance
    if (!checkCompliance(doc)) {
      nonCompliant.push({ _id: doc._id, name: doc.name });
    }
    // Collect all items
    allItems.push(doc);
  }

  // Output to CSV
  const csv = stringify(allItems, { header: true });
  writeFileSync('items_export.csv', csv);
  console.log('Exported items to items_export.csv');

  console.log(`\nAdded UUIDs to ${updated} items.`);
  if (nonCompliant.length) {
    console.log('\nNon-compliant items:');
    nonCompliant.forEach(item => console.log(item));
  } else {
    console.log('\nAll items are compliant with the basic schema.');
  }
  await client.close();
}

addUUIDsAndCheckCompliance();