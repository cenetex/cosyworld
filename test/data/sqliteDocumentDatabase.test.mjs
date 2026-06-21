import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { ObjectId } from '../../src/utils/objectId.mjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSqliteConnection } from '../../src/data/sqlite/sqliteConnection.mjs';
import { SqliteDocumentDatabase } from '../../src/data/sqlite/sqliteDocumentDatabase.mjs';

const quietLogger = { info() {}, warn() {}, error() {}, debug() {} };

describe('SqliteDocumentDatabase', () => {
  let tempDir;
  let connection;
  let db;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cosyworld-docdb-'));
    connection = createSqliteConnection({
      logger: quietLogger,
      dbPath: path.join(tempDir, 'cosyworld.sqlite')
    });
    db = new SqliteDocumentDatabase({ sqliteConnection: connection, logger: quietLogger });
  });

  afterEach(async () => {
    connection?.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('supports common collection CRUD and cursor operations', async () => {
    const avatars = db.collection('avatars');
    const id = new ObjectId();

    await avatars.insertOne({
      _id: id,
      name: 'Moss',
      stats: { level: 3 },
      tags: ['cozy'],
      createdAt: 10
    });
    await avatars.updateOne(
      { _id: id },
      {
        $set: { 'stats.level': 4 },
        $inc: { xp: 2 },
        $addToSet: { tags: 'forest' }
      }
    );

    const doc = await avatars.findOne({ _id: id });
    expect(doc).toMatchObject({
      _id: id.toHexString(),
      name: 'Moss',
      stats: { level: 4 },
      xp: 2,
      tags: ['cozy', 'forest']
    });

    await avatars.insertMany([
      { name: 'Aster', createdAt: 20, active: true },
      { name: 'Brindle', createdAt: 5, active: false }
    ]);

    const names = await avatars
      .find({ createdAt: { $gte: 10 } })
      .sort({ createdAt: -1 })
      .project({ name: 1, _id: 0 })
      .toArray();

    expect(names).toEqual([{ name: 'Aster' }, { name: 'Moss' }]);
    expect(await avatars.countDocuments({ active: { $ne: false } })).toBe(2);
  });

  it('supports upsert, findOneAndUpdate, deleteMany, distinct, bulkWrite, and basic aggregate', async () => {
    const events = db.collection('events');

    await events.updateOne(
      { hash: 'a' },
      { $set: { type: 'combat', score: 2 }, $setOnInsert: { createdAt: 1 } },
      { upsert: true }
    );
    const updated = await events.findOneAndUpdate(
      { hash: 'a' },
      { $inc: { score: 3 } },
      { returnDocument: 'after' }
    );
    expect(updated.value.score).toBe(5);

    await events.bulkWrite([
      { insertOne: { document: { hash: 'b', type: 'chat', score: 1 } } },
      { updateOne: { filter: { hash: 'c' }, update: { $set: { type: 'combat', score: 4 } }, upsert: true } }
    ]);

    expect(await events.distinct('type')).toEqual(expect.arrayContaining(['combat', 'chat']));

    const grouped = await events.aggregate([
      { $match: { type: 'combat' } },
      { $group: { _id: '$type', total: { $sum: '$score' } } }
    ]).toArray();
    expect(grouped).toEqual([{ _id: 'combat', total: 9 }]);

    const deleted = await events.deleteMany({ score: { $lt: 5 } });
    expect(deleted.deletedCount).toBe(2);
    expect(await events.countDocuments()).toBe(1);
  });

  it('supports aggregation shapes used by public app routes', async () => {
    const locations = db.collection('locations');
    const avatars = db.collection('avatars');
    const items = db.collection('items');

    await locations.insertMany([
      { name: 'Cottage', channelId: 'cottage', createdAt: 1 },
      { name: 'Garden', channelId: 'garden', createdAt: 2 }
    ]);
    await avatars.insertMany([
      { name: 'Moss', channelId: 'cottage', emoji: '🌿', nft: { collection: 'forest', collectionName: 'Forest Folk' }, imageUrl: '/moss.png', createdAt: 10 },
      { name: 'Aster', channelId: 'cottage', emoji: '', collection: 'forest', imageUrl: '/aster.png', createdAt: 20 },
      { name: 'Brindle', channelId: 'garden', imageUrl: '/brindle.png', createdAt: 30 }
    ]);
    await items.insertMany([
      { name: 'Lantern', locationId: 'cottage', owner: null },
      { name: 'Private Map', locationId: 'cottage', owner: 'Moss' }
    ]);

    const [dungeonPage] = await locations.aggregate([
      {
        $lookup: {
          from: 'avatars',
          let: { locationChannelId: '$channelId' },
          pipeline: [
            { $match: { $expr: { $eq: ['$channelId', '$$locationChannelId'] } } },
            { $project: { name: 1, imageUrl: 1, _id: 0 } },
            { $limit: 10 }
          ],
          as: 'avatars'
        }
      },
      {
        $lookup: {
          from: 'items',
          let: { locationChannelId: '$channelId' },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$locationId', '$$locationChannelId'] }, { $eq: ['$owner', null] }] } } },
            { $project: { name: 1, _id: 0 } }
          ],
          as: 'items'
        }
      },
      { $addFields: { avatarCount: { $size: '$avatars' } } },
      { $sort: { avatarCount: -1, name: 1 } },
      { $facet: { metadata: [{ $count: 'total' }], locations: [{ $skip: 0 }, { $limit: 1 }] } }
    ]).toArray();

    expect(dungeonPage.metadata).toEqual([{ total: 2 }]);
    expect(dungeonPage.locations[0]).toMatchObject({
      name: 'Cottage',
      avatarCount: 2,
      items: [{ name: 'Lantern' }]
    });
    expect(dungeonPage.locations[0].avatars).toEqual(expect.arrayContaining([
      { name: 'Moss', imageUrl: '/moss.png' },
      { name: 'Aster', imageUrl: '/aster.png' }
    ]));

    const collections = await avatars.aggregate([
      { $addFields: { collKey: { $ifNull: ['$nft.collection', '$collection'] } } },
      { $match: { collKey: { $exists: true, $ne: null } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$collKey', count: { $sum: 1 }, sample: { $first: '$$ROOT' } } }
    ]).toArray();

    expect(collections).toEqual([
      expect.objectContaining({
        _id: 'forest',
        count: 2,
        sample: expect.objectContaining({ name: 'Aster', collKey: 'forest' })
      })
    ]);

    const tribes = await avatars.aggregate([
      {
        $project: {
          emoji: {
            $cond: [
              { $or: [{ $eq: ['$emoji', null] }, { $eq: ['$emoji', ''] }] },
              'Glitch Tribe',
              '$emoji'
            ]
          }
        }
      },
      { $group: { _id: '$emoji', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();

    expect(tribes).toEqual(expect.arrayContaining([
      { _id: 'Glitch Tribe', count: 2 },
      { _id: '🌿', count: 1 }
    ]));
  });

  it('supports Mongo push modifiers and date/string aggregation expressions', async () => {
    const avatars = db.collection('avatars');
    const txs = db.collection('x402_transactions');
    const avatarId = new ObjectId();

    await avatars.insertOne({
      _id: avatarId,
      thoughts: [{ id: 'old-1' }, { id: 'old-2' }]
    });
    await avatars.updateOne(
      { _id: avatarId },
      {
        $push: {
          thoughts: {
            $each: [{ id: 'new' }],
            $position: 0,
            $slice: 2
          }
        }
      }
    );

    expect((await avatars.findOne({ _id: avatarId })).thoughts).toEqual([{ id: 'new' }, { id: 'old-1' }]);

    await txs.insertMany([
      { status: 'paid', amount: 2, verifiedAt: new Date('2026-06-20T01:15:00.000Z') },
      { status: 'paid', amount: 3, verifiedAt: new Date('2026-06-20T01:45:00.000Z') },
      { status: 'paid', amount: 5, verifiedAt: new Date('2026-06-20T02:00:00.000Z') }
    ]);

    const hourly = await txs.aggregate([
      { $match: { verifiedAt: { $gte: new Date('2026-06-20T01:30:00.000Z') } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d-%H', date: '$verifiedAt' } },
          count: { $sum: 1 },
          volume: { $sum: '$amount' }
        }
      },
      { $sort: { _id: 1 } }
    ]).toArray();

    expect(hourly).toEqual([
      { _id: '2026-06-20-01', count: 1, volume: 3 },
      { _id: '2026-06-20-02', count: 1, volume: 5 }
    ]);
  });
});
