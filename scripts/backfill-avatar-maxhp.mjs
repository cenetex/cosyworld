#!/usr/bin/env node
/**
 * Backfill avatar max HP from character sheets.
 *
 * Usage:
 *   node scripts/backfill-avatar-maxhp.mjs [--dry-run] [--limit=100] [--only-missing]
 */
import 'dotenv/config';
import { container, containerReady } from '../src/container.mjs';
import { CLASSES } from '../src/data/dnd/classes.mjs';

const logger = container.resolve('logger') || console;
const databaseService = container.resolve('databaseService');

function parseArgs(argv) {
  const limitArg = argv.find(arg => arg.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : null;
  return {
    dryRun: argv.includes('--dry-run'),
    onlyMissing: argv.includes('--only-missing'),
    limit: Number.isFinite(limit) && limit > 0 ? limit : null
  };
}

function getConstitution(stats, fallbackStats) {
  const fromAvatar = stats?.constitution;
  if (Number.isFinite(fromAvatar)) return fromAvatar;
  const fromDungeon = fallbackStats?.constitution;
  if (Number.isFinite(fromDungeon)) return fromDungeon;
  return 10;
}

function computeMaxHp({ level, hitDice, conMod }) {
  const parsedLevel = Number(level);
  const safeLevel = Number.isFinite(parsedLevel) ? Math.max(1, parsedLevel) : 1;
  const base = hitDice + conMod;
  const perLevel = Math.floor(hitDice / 2) + 1 + conMod;
  const total = base + Math.max(0, safeLevel - 1) * perLevel;
  return Math.max(1, total);
}

async function run() {
  await containerReady;

  const { dryRun, onlyMissing, limit } = parseArgs(process.argv.slice(2));
  const db = await databaseService.getDatabase();
  const sheets = db.collection('character_sheets');
  const avatars = db.collection('avatars');
  const dungeonStatsCol = db.collection('dungeon_stats');

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let missingAvatar = 0;
  let missingClass = 0;
  let missingStats = 0;

  const cursor = sheets.find({});
  while (await cursor.hasNext()) {
    const sheet = await cursor.next();
    if (!sheet) break;
    processed += 1;
    if (limit && processed > limit) break;

    const avatar = await avatars.findOne({ _id: sheet.avatarId });
    if (!avatar) {
      missingAvatar += 1;
      continue;
    }

    const classKey = String(sheet.class || '').toLowerCase();
    const classDef = CLASSES[classKey];
    if (!classDef?.hitDice) {
      missingClass += 1;
      continue;
    }

    const dungeonStats = await dungeonStatsCol.findOne({ avatarId: sheet.avatarId });
    const conScore = getConstitution(avatar.stats, dungeonStats);
    const conMod = Math.floor((conScore - 10) / 2);
    const expectedMaxHp = computeMaxHp({
      level: sheet.level || 1,
      hitDice: classDef.hitDice,
      conMod
    });

    const existingMaxHp = Number.isFinite(avatar?.stats?.maxHp)
      ? avatar.stats.maxHp
      : (Number.isFinite(dungeonStats?.maxHp)
          ? dungeonStats.maxHp
          : (Number.isFinite(dungeonStats?.hp)
              ? dungeonStats.hp
              : avatar?.stats?.hp));

    if (onlyMissing && Number.isFinite(existingMaxHp) && existingMaxHp > 0) {
      skipped += 1;
      continue;
    }

    const roundedExisting = Number.isFinite(existingMaxHp) ? Math.round(existingMaxHp) : null;
    if (roundedExisting !== null && roundedExisting === Math.round(expectedMaxHp)) {
      skipped += 1;
      continue;
    }

    const currentHp = Number.isFinite(avatar?.stats?.hp) ? avatar.stats.hp : expectedMaxHp;
    const nextHp = Math.min(currentHp, expectedMaxHp);

    if (dryRun) {
      logger.info(`[dry-run] ${avatar.name || avatar._id}: maxHp ${roundedExisting ?? 'n/a'} -> ${expectedMaxHp}`);
      skipped += 1;
      continue;
    }

    await avatars.updateOne(
      { _id: avatar._id },
      { $set: { 'stats.maxHp': expectedMaxHp, 'stats.hp': nextHp, updatedAt: new Date() } }
    );

    if (dungeonStats) {
      await dungeonStatsCol.updateOne(
        { _id: dungeonStats._id },
        { $set: { hp: expectedMaxHp, maxHp: expectedMaxHp } }
      );
    } else {
      missingStats += 1;
    }

    updated += 1;
  }

  logger.info(`Backfill complete processed=${processed} updated=${updated} skipped=${skipped}`);
  logger.info(`Missing: avatars=${missingAvatar} classes=${missingClass} dungeon_stats=${missingStats}`);
  process.exit(0);
}

run().catch(err => {
  logger.error('Backfill failed:', err);
  process.exit(1);
});
