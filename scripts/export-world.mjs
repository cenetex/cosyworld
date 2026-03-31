/**
 * Export and inspect core world entities: avatars, locations, items.
 *
 * Outputs:
 * - summary.json (counts + field/type stats + relationship sanity checks)
 * - avatars.jsonl / locations.jsonl / items.jsonl (newline-delimited JSON)
 *
 * Usage:
 *   node scripts/export-world.mjs --out exports/world-export
 *   node scripts/export-world.mjs --sample 100
 */

import 'dotenv/config';

import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { MongoClient, ObjectId } from 'mongodb';

function parseArgs(argv) {
  const args = {
    out: null,
    sample: 50,
    limit: null,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith('--')) continue;
    const [k, v] = raw.includes('=') ? raw.split('=') : [raw, argv[i + 1]];
    const key = k.replace(/^--/, '').trim();

    if (key === 'out') {
      args.out = v;
      if (!raw.includes('=')) i += 1;
      continue;
    }

    if (key === 'sample') {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) args.sample = Math.floor(n);
      if (!raw.includes('=')) i += 1;
      continue;
    }

    if (key === 'limit') {
      const n = Number(v);
      args.limit = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
      if (!raw.includes('=')) i += 1;
      continue;
    }

    if (key === 'help' || key === 'h') {
      args.help = true;
    }
  }

  return args;
}

function maskSecret(v) {
  if (!v || typeof v !== 'string') return null;
  if (v.length < 14) return '***';
  return `${v.slice(0, 8)}***${v.slice(-4)}`;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeBson(value) {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof ObjectId) return value.toString();

  if (Array.isArray(value)) return value.map(normalizeBson);

  // Handle common BSON types without importing all of them.
  if (isPlainObject(value) && typeof value._bsontype === 'string') {
    if (typeof value.toString === 'function') return value.toString();
  }

  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalizeBson(v);
    return out;
  }

  return value;
}

function typeTag(value) {
  if (value == null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'date';
  if (value instanceof ObjectId) return 'objectId';
  if (typeof value === 'object') return value._bsontype ? `bson:${value._bsontype}` : 'object';
  return typeof value;
}

function bump(map, key, amount = 1) {
  map[key] = (map[key] || 0) + amount;
}

async function writeJson(filePath, data) {
  const json = JSON.stringify(data, null, 2);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, json, 'utf8');
}

async function writeLine(stream, line) {
  return new Promise((resolve, reject) => {
    const ok = stream.write(line, 'utf8');
    if (ok) return resolve();
    stream.once('drain', resolve);
    stream.once('error', reject);
  });
}

async function exportCollection({ db, collectionName, outDir, limit = null }) {
  const filePath = path.join(outDir, `${collectionName}.jsonl`);
  const stream = createWriteStream(filePath, { encoding: 'utf8' });

  const col = db.collection(collectionName);
  const cursor = col.find({});
  if (limit) cursor.limit(limit);

  let written = 0;
  try {
    for await (const doc of cursor) {
      const normalized = normalizeBson(doc);
      await writeLine(stream, `${JSON.stringify(normalized)}\n`);
      written += 1;
    }
  } finally {
    await new Promise((resolve) => stream.end(resolve));
  }

  return { filePath, written };
}

async function inspectCollection({ db, collectionName, sample = 50 }) {
  const col = db.collection(collectionName);
  const total = await col.countDocuments();

  const sampleDocs = await col.find({}).limit(sample).toArray();
  const topLevelKeys = {};
  const fieldTypes = {}; // key -> { typeTag: count }

  for (const doc of sampleDocs) {
    for (const [k, v] of Object.entries(doc || {})) {
      bump(topLevelKeys, k);
      fieldTypes[k] = fieldTypes[k] || {};
      bump(fieldTypes[k], typeTag(v));
    }
  }

  return {
    total,
    sampleSize: sampleDocs.length,
    topLevelKeys,
    fieldTypes,
  };
}

async function relationshipSanity({ db, sample = 200 }) {
  const itemsCol = db.collection('items');
  const avatarsCol = db.collection('avatars');
  const locationsCol = db.collection('locations');

  const items = await itemsCol.find({}).limit(sample).project({ owner: 1, locationId: 1 }).toArray();
  const avatars = await avatarsCol.find({}).limit(sample).project({ channelId: 1, locationId: 1 }).toArray();
  const locations = await locationsCol.find({}).limit(sample).project({ channelId: 1, type: 1 }).toArray();

  const itemOwnerTypes = {};
  const itemLocationIdTypes = {};
  const avatarChannelIdTypes = {};
  const avatarLocationIdTypes = {};
  const locationChannelIdTypes = {};

  for (const it of items) {
    bump(itemOwnerTypes, typeTag(it?.owner));
    bump(itemLocationIdTypes, typeTag(it?.locationId));
  }
  for (const av of avatars) {
    bump(avatarChannelIdTypes, typeTag(av?.channelId));
    bump(avatarLocationIdTypes, typeTag(av?.locationId));
  }
  for (const loc of locations) {
    bump(locationChannelIdTypes, typeTag(loc?.channelId));
  }

  return {
    sampleSize: {
      items: items.length,
      avatars: avatars.length,
      locations: locations.length,
    },
    items: {
      ownerTypes: itemOwnerTypes,
      locationIdTypes: itemLocationIdTypes,
    },
    avatars: {
      channelIdTypes: avatarChannelIdTypes,
      locationIdTypes: avatarLocationIdTypes,
    },
    locations: {
      channelIdTypes: locationChannelIdTypes,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('Usage: node scripts/export-world.mjs [--out DIR] [--sample N] [--limit N]');
    process.exit(0);
  }

  const mongoUri = process.env.MONGO_URI;
  const dbName = process.env.MONGO_DB_NAME || process.env.DB_NAME || 'cosyworld8';

  if (!mongoUri) {
    console.error('❌ Missing MONGO_URI in environment (.env).');
    process.exit(1);
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = args.out || path.join('exports', `world-export-${ts}`);
  await mkdir(outDir, { recursive: true });

  console.log(`🔌 Connecting to MongoDB: ${maskSecret(mongoUri)}`);
  console.log(`📦 Database: ${dbName}`);
  console.log(`📁 Output: ${outDir}`);

  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const db = client.db(dbName);

    const collections = ['avatars', 'locations', 'items'];

    const inspected = {};
    for (const name of collections) {
      console.log(`\n🔎 Inspecting ${name}...`);
      inspected[name] = await inspectCollection({ db, collectionName: name, sample: args.sample });
      console.log(`  total=${inspected[name].total}, sampled=${inspected[name].sampleSize}`);
    }

    console.log('\n🔗 Checking relationships...');
    const rel = await relationshipSanity({ db, sample: Math.max(args.sample, 200) });

    console.log('\n⬇️  Exporting collections...');
    const exported = {};
    for (const name of collections) {
      const res = await exportCollection({ db, collectionName: name, outDir, limit: args.limit });
      exported[name] = { file: res.filePath, written: res.written };
      console.log(`  ${name}: wrote ${res.written} docs -> ${res.filePath}`);
    }

    const summary = {
      generatedAt: new Date().toISOString(),
      db: {
        name: dbName,
        uriMasked: maskSecret(mongoUri),
      },
      options: {
        sample: args.sample,
        limit: args.limit,
      },
      inspected,
      relationships: rel,
      exported,
      notes: {
        joinsObservedInCode: {
          avatarsToLocations: 'avatars.channelId ↔ locations.channelId (used by dungeon/admin flows)',
          itemsToAvatars: 'items.owner ↔ avatars._id (owner sometimes stored as ObjectId or string)',
          itemsToLocations: 'items.locationId ↔ locations.channelId (used by dungeon route lookups)',
        },
      },
    };

    await writeJson(path.join(outDir, 'summary.json'), summary);
    console.log(`\n✅ Wrote summary -> ${path.join(outDir, 'summary.json')}`);
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error('❌ Export failed:', err);
  process.exit(1);
});
