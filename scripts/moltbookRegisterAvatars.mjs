/**
 * Copyright (c) 2019-2026 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { container, containerReady } from '../src/container.mjs';
import { MoltbookClient } from '../src/services/social/moltbookClient.mjs';

const slugify = (input) => {
  const s = String(input || '').trim();
  if (!s) return 'avatar';
  return s
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'avatar';
};

const buildAgentName = (avatar) => {
  const base = slugify(avatar?.name || 'avatar');
  const id = String(avatar?._id || '').slice(-6) || Math.random().toString(16).slice(2, 8);
  return `cosy_${base}_${id}`;
};

export default async function moltbookRegisterAvatars({ limit = null, random = false } = {}) {
  await containerReady;

  const logger = (() => { try { return container.resolve('logger'); } catch { return console; } })();
  const databaseService = container.resolve('databaseService');
  const socialPlatformService = container.resolve('socialPlatformService');

  if (socialPlatformService?.initialize) {
    await socialPlatformService.initialize();
  }

  const db = await databaseService.getDatabase();
  const avatars = db.collection('avatars');

  const desired = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : null;

  const client = new MoltbookClient();

  let created = 0;
  let skipped = 0;
  let failed = 0;

  logger.info('[moltbook] Registering Moltbook accounts for avatars...');

  const registerOne = async (avatar) => {
    const avatarId = String(avatar._id);

    try {
      const existing = await socialPlatformService.getConnection('moltbook', avatarId);
      if (existing?.credentials?.cipherText) {
        skipped += 1;
        return { ok: false, skipped: true };
      }

      const desiredName = buildAgentName(avatar);
      const description = String(avatar.description || avatar.personality || 'CosyWorld avatar').slice(0, 160);

      let attemptName = desiredName;
      let reg = null;

      for (let i = 0; i < 3; i += 1) {
        try {
          reg = await client.registerAgent({ name: attemptName, description });
          break;
        } catch (e) {
          const isConflict = e?.status === 409
            || String(e?.message || '').toLowerCase().includes('taken')
            || String(e?.message || '').toLowerCase().includes('exists');
          if (!isConflict || i === 2) throw e;
          attemptName = `${desiredName}_${Math.random().toString(16).slice(2, 6)}`;
        }
      }

      const apiKey = reg?.agent?.api_key || reg?.agent?.apiKey;
      const claimUrl = reg?.agent?.claim_url || reg?.agent?.claimUrl;
      const verificationCode = reg?.agent?.verification_code || reg?.agent?.verificationCode;

      if (!apiKey) {
        throw new Error('Moltbook register succeeded but returned no api_key');
      }

      await socialPlatformService.connectAvatar(
        'moltbook',
        avatarId,
        {
          apiKey,
          agentName: attemptName,
          claimUrl,
          verificationCode
        },
        {
          metadata: {
            agentName: attemptName
          }
        }
      );

      created += 1;

      // Print claim info for the human to complete activation
      console.log(`[moltbook] ${avatar.emoji || ''} ${avatar.name || avatarId} -> ${attemptName}`);
      if (claimUrl) console.log(`  claim_url: ${claimUrl}`);
      if (verificationCode) console.log(`  verification_code: ${verificationCode}`);

      return { ok: true };
    } catch (e) {
      failed += 1;
      logger.warn(`[moltbook] Failed for avatar ${avatarId}: ${e?.message || e}`);
      return { ok: false, skipped: false };
    }
  };

  if (!random) {
    const cursor = avatars.find({});
    if (desired) cursor.limit(desired);

    for await (const avatar of cursor) {
      await registerOne(avatar);
      if (desired && created >= desired) break;
    }
  } else {
    if (!desired) {
      throw new Error('Random mode requires a positive --limit');
    }

    const seen = new Set();
    let passes = 0;
    while (created < desired && passes < 10) {
      passes += 1;
      const remaining = desired - created;
      const batchSize = Math.max(remaining * 5, remaining + 5);
      const sampled = await avatars.aggregate([{ $sample: { size: batchSize } }]).toArray();
      if (!sampled.length) break;

      for (const avatar of sampled) {
        if (created >= desired) break;
        const avatarId = String(avatar._id);
        if (seen.has(avatarId)) continue;
        seen.add(avatarId);
        await registerOne(avatar);
      }
    }
  }

  logger.info(`[moltbook] Done. created=${created} skipped=${skipped} failed=${failed}`);
  return { created, skipped, failed };
}
