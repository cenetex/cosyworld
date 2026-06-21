/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import { writeFileSync } from 'fs';
import { stringify } from 'csv-stringify/sync';
import { openDatabase } from './lib/openDatabase.mjs';

dotenv.config();

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
  const handle = await openDatabase();
  const collection = handle.db.collection('items');

  const docs = await collection.find().toArray();
  let updated = 0;
  let nonCompliant = [];
  let allItems = [];

  for (const doc of docs) {
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
  await handle.close();
}

addUUIDsAndCheckCompliance();
