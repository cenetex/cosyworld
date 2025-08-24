/**
 * SummarizerService
 * - Provides short per-thread summaries for the planner.
 * - Uses ConversationManager channel summary per avatar, defaulting to a generic summarizer avatar if needed.
 */

export default class SummarizerService {
  constructor({ logger = console, databaseService, avatarService, getConversationManager }) {
    this.logger = logger;
    this.databaseService = databaseService;
    this.avatarService = avatarService;
    this.getConversationManager = getConversationManager; // late-binding getter
  this.defaultSummarizerName = process.env.PLANNER_SUMMARIZER_NAME || 'Narrator';
  }

  async db() { return await this.databaseService.getDatabase(); }
  async col() { return (await this.db()).collection('thread_summaries'); }

  async pickSummarizerAvatar(channelId) {
    // Prefer a dedicated "Narrator" if present
    try {
      const av = await this.avatarService.getAvatarByName?.(this.defaultSummarizerName);
      if (av) return av;
    } catch {}
    // Otherwise choose an avatar from the channel if any
    try {
      const channelAvatars = await this.avatarService.getAvatarsInChannel?.(channelId);
      if (channelAvatars && channelAvatars.length) return channelAvatars[0];
    } catch {}
    // Fallback to any active avatar
    try {
      const any = await this.avatarService.getActiveAvatars?.({ limit: 1 });
      if (any && any.length) return any[0];
    } catch {}
    return null;
  }

  async getSummary(channelId, maxStalenessMs = 5 * 60 * 1000) {
    const col = await this.col();
    const cached = await col.findOne({ channelId });
    const now = Date.now();
    if (cached && now - (cached.updatedAt || 0) < maxStalenessMs && cached.summary) return cached.summary;
    // Regenerate via ConversationManager using the summarizer avatar
  let avatar = await this.pickSummarizerAvatar(channelId);
    const cm = this.getConversationManager?.();
    if (!cm || !avatar) return cached?.summary || '';
    try {
      const summary = await cm.getChannelSummary(avatar._id, channelId);
      if (summary) {
        await col.updateOne(
          { channelId },
          { $set: { channelId, summary, updatedAt: now }, $setOnInsert: { createdAt: now } },
          { upsert: true }
        );
        return summary;
      }
    } catch (e) {
      this.logger.debug?.(`[Summarizer] summary failed for ${channelId}: ${e.message}`);
    }
    return cached?.summary || '';
  }
}
