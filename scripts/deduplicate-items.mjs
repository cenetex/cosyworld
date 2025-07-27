/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';

async function dedupeAndReindex() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017';
  const client = new MongoClient(uri, { useUnifiedTopology: true });
  await client.connect();
  const db = client.db('cosyworld8');
  const coll = db.collection('items');

  // 1) Assign new uuids for null or missing uuid fields
  const nullCursor = coll.find({ $or: [{ uuid: null }, { uuid: { $exists: false } }] });
  while (await nullCursor.hasNext()) {
    const doc = await nullCursor.next();
    await coll.updateOne(
      { _id: doc._id },
      { $set: { uuid: uuidv4() } }
    );
  }
  console.log('Assigned new uuids to formerly null/missing');

  // 2) Find duplicate uuid groups
  const dupCursor = coll.aggregate([
    { $group: { _id: '$uuid', ids: { $push: '$_id' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }
  ]);

  let totalDeleted = 0;
  for await (const { _id: dupeUuid, ids } of dupCursor) {
    // keep first, delete the rest
    const [, ...toDelete] = ids;
    const { deletedCount } = await coll.deleteMany({ _id: { $in: toDelete } });
    totalDeleted += deletedCount;
    console.log(`uuid=${dupeUuid}: deleted ${deletedCount}`);
  }
  console.log(`Total duplicates removed: ${totalDeleted}`);

  // 3) Drop old index and create a unique one on non-null uuids
  try {
    await coll.dropIndex('uuid_1');
    console.log('Dropped existing uuid_1 index');
  } catch (e) { /* ignore if not exist */ }

  await coll.createIndex(
    { uuid: 1 },
    {
      unique: true,
      partialFilterExpression: { uuid: { $type: 'string' } }
    }
  );
  console.log('Created unique index on uuid (non-null strings only)');

  await client.close();
  console.log('Done!');
}

dedupeAndReindex().catch(err => {
  console.error(err);
  process.exit(1);
});