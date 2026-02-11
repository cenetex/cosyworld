/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { resolveAdminAvatarId } from '../social/adminAvatarResolver.mjs';

export async function postFightPoster({
  attacker,
  defender,
  encounterChannelId,
  locationChannelId,
  battleMediaService,
  discordService,
  mapService,
  encounterService,
  configService,
  logger
}) {
  try {
    if (!battleMediaService?.generateFightPoster || !discordService?.client) return null;
    const loc = await mapService?.getLocationAndAvatars?.(locationChannelId);
    const poster = await battleMediaService.generateFightPoster({ attacker, defender, location: loc?.location });
    if (!poster?.imageUrl) return poster || null;

    // Store poster URL on encounter for later video generation reuse
    try {
      const enc = encounterService?.getEncounter?.(encounterChannelId);
      if (enc) enc.fightPosterUrl = poster.imageUrl;
    } catch {}

    const channel = await discordService.client.channels.fetch(encounterChannelId);
    if (channel?.isTextBased()) {
      const embed = {
        title: `Combat Initiated: ${attacker?.name || 'Unknown'} vs ${defender?.name || 'Unknown'}`,
        description: loc?.location?.name ? `Location: ${loc.location.name}` : undefined,
        color: 0xff4757,
        image: { url: poster.imageUrl },
      };
      await channel.send({ embeds: [embed] });
    }

    // Optional: auto-post to X for admin account and attach tweet info to encounter
    try {
      const autoX = String(process.env.X_AUTO_POST_BATTLES || 'false').toLowerCase();
      const xsvc = configService?.services?.xService;
      if (autoX === 'true' && xsvc && poster.imageUrl) {
        let admin = null;
        try {
          const envId = resolveAdminAvatarId();
          if (envId && /^[a-f0-9]{24}$/i.test(envId)) {
            admin = await configService.services.avatarService.getAvatarById(envId);
          } else {
            const aiCfg = configService?.getAIConfig?.(process.env.AI_SERVICE);
            const model = aiCfg?.chatModel || aiCfg?.model || process.env.OPENROUTER_CHAT_MODEL || process.env.GOOGLE_AI_CHAT_MODEL || 'default';
            const safe = String(model).toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
            admin = { _id: `model:${safe}`, name: `System (${model})`, username: process.env.X_ADMIN_USERNAME || undefined };
          }
        } catch {}
        if (admin) {
          const locName = loc?.location?.name || 'Unknown Arena';
          const text = `⚔️ ${attacker?.name || 'Someone'} vs ${defender?.name || 'Someone'} — ${locName}`;
          const { tweetId, tweetUrl } = await xsvc.postImageToXDetailed(admin, poster.imageUrl, text);
          try {
            const enc = encounterService?.getEncounter?.(encounterChannelId);
            if (enc) { enc._xTweetId = tweetId; enc._xTweetUrl = tweetUrl; }
          } catch {}
        }
      }
    } catch (e) {
      logger?.warn?.(`[BattleMediaHelper] auto X poster post failed: ${e.message}`);
    }

    return poster;
  } catch (e) {
    logger?.warn?.(`[BattleMediaHelper] poster generation failed: ${e.message}`);
    return null;
  }
}
