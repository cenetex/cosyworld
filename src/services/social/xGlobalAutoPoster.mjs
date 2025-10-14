/**
 * Global X Auto Poster
 * Listens for internal media generation events and posts via XService.postGlobalMediaUpdate
 * when enabled.
 */
import eventBus from '../../utils/eventBus.mjs';

export function registerXGlobalAutoPoster({ xService, aiService, logger }) {
  if (!xService) return;
  logger?.info?.('[XGlobalAutoPoster] Initialising (DB-config governed)');

  const imageHandler = async (payload) => {
    try {
      if (!payload?.imageUrl) return;
      // Elevate to info so operators always see that the event was captured (even without DEBUG flag)
      logger?.info?.('[XGlobalAutoPoster] evt MEDIA.IMAGE.GENERATED', { imageUrl: payload.imageUrl });
      if (process.env.DEBUG_GLOBAL_X === '1') {
        logger?.info?.('[XGlobalAutoPoster][diag] image event payload', { keys: Object.keys(payload||{}) });
      }
      
      // Pass through context from the event (e.g., avatar introduction, location description)
      const text = payload.context || payload.prompt || null;
      
      await xService.postGlobalMediaUpdate({ 
        mediaUrl: payload.imageUrl, 
        type: 'image', 
        text,
        guildId: payload.guildId || payload.serverId || null 
      }, { aiService });
    } catch (e) {
      logger?.warn?.(`[XGlobalAutoPoster] image post failed: ${e.message}`);
    }
  };

  const videoHandler = async (payload) => {
    try {
      if (!payload?.videoUrl) return;
      logger?.info?.('[XGlobalAutoPoster] evt MEDIA.VIDEO.GENERATED', { videoUrl: payload.videoUrl });
      if (process.env.DEBUG_GLOBAL_X === '1') {
        logger?.info?.('[XGlobalAutoPoster][diag] video event payload', { keys: Object.keys(payload||{}) });
      }
  await xService.postGlobalMediaUpdate({ mediaUrl: payload.videoUrl, type: 'video', guildId: payload.guildId || payload.serverId || null }, { aiService });
    } catch (e) {
      logger?.warn?.(`[XGlobalAutoPoster] video post failed: ${e.message}`);
    }
  };

  eventBus.on('MEDIA.IMAGE.GENERATED', imageHandler);
  eventBus.on('MEDIA.VIDEO.GENERATED', videoHandler);
}
export default registerXGlobalAutoPoster;
