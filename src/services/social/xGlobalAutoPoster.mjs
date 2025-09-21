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
      logger?.debug?.('[XGlobalAutoPoster] received MEDIA.IMAGE.GENERATED', { imageUrl: payload.imageUrl });
      await xService.postGlobalMediaUpdate({ mediaUrl: payload.imageUrl, type: 'image' }, { aiService });
    } catch (e) {
      logger?.warn?.(`[XGlobalAutoPoster] image post failed: ${e.message}`);
    }
  };

  const videoHandler = async (payload) => {
    try {
      if (!payload?.videoUrl) return;
      logger?.debug?.('[XGlobalAutoPoster] received MEDIA.VIDEO.GENERATED', { videoUrl: payload.videoUrl });
      await xService.postGlobalMediaUpdate({ mediaUrl: payload.videoUrl, type: 'video' }, { aiService });
    } catch (e) {
      logger?.warn?.(`[XGlobalAutoPoster] video post failed: ${e.message}`);
    }
  };

  eventBus.on('MEDIA.IMAGE.GENERATED', imageHandler);
  eventBus.on('MEDIA.VIDEO.GENERATED', videoHandler);
}
export default registerXGlobalAutoPoster;
