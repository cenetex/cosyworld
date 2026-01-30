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

export default async function moltbookRegisterAvatars({ limit = null } = {}) {
  await containerReady;

  const logger = (() => { try { return container.resolve('logger'); } catch { return console; } })();
  const databaseService = container.resolve('databaseService');
  const socialPlatformService = container.resolve('socialPlatformService');

  if (socialPlatformService?.initialize) {
    await socialPlatformService.initialize();
  }

  const db = await databaseService.getDatabase();
  const avatars = db.collection('avatars');

  const cursor = avatars.find({});
  if (Number.isFinite(Number(limit)) && Number(limit) > 0) {
    cursor.limit(Number(limit));
  }

  const client = new MoltbookClient();

  let created = 0;
  let skipped = 0;
  let failed = 0;

  logger.info('[moltbook] Registering Moltbook accounts for avatars...');

  // eslint-disable-next-line no-restricted-syntax
  for await (const avatar of cursor) {
    const avatarId = String(avatar._id);

    try {
      const existing = await socialPlatformService.getConnection('moltbook', avatarId);
      if (existing?.credentials?.cipherText) {
        skipped += 1;
        continue;
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
          const isConflict = e?.status === 409 || String(e?.message || '').toLowerCase().includes('taken') || String(e?.message || '').toLowerCase().includes('exists');
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
      // eslint-disable-next-line no-console
      console.log(`[moltbook] ${avatar.emoji || ''} ${avatar.name || avatarId} -> ${attemptName}`);
      // eslint-disable-next-line no-console
      if (claimUrl) console.log(`  claim_url: ${claimUrl}`);
      // eslint-disable-next-line no-console
      if (verificationCode) console.log(`  verification_code: ${verificationCode}`);
    } catch (e) {
      failed += 1;
      logger.warn(`[moltbook] Failed for avatar ${avatarId}: ${e?.message || e}`);
    }
  }

  logger.info(`[moltbook] Done. created=${created} skipped=${skipped} failed=${failed}`);
  return { created, skipped, failed };
}
