/**
 * ThreadStateService
 * - Maintains lightweight per-thread (channel) state used by the DM planner
 * - Derives activity/participants from messages and the channel_activity collection
 */

export default class ThreadStateService {
  constructor({ logger = console, databaseService }) {
    this.logger = logger;
    this.databaseService = databaseService;
  }

  async db() {
    return await this.databaseService.getDatabase();
  }

  async colStates() {
    return (await this.db()).collection('thread_states');
  }

  async colActivity() {
    return (await this.db()).collection('channel_activity');
  }

  async colMessages() {
    return (await this.db()).collection('messages');
  }

  /**
   * List active channels by last activity within lookbackMs window
   */
  async getActiveChannels(lookbackMs = 15 * 60 * 1000, limit = 50) {
    const since = Date.now() - Math.max(0, lookbackMs);
    const col = await this.colActivity();
    const docs = await col.find({ lastActivityTimestamp: { $gte: since } })
      .sort({ lastActivityTimestamp: -1 })
      .limit(limit)
      .project({ _id: 1, guildId: 1, lastActivityTimestamp: 1 })
      .toArray();
    return docs.map(d => ({ channelId: d._id, guildId: d.guildId, lastActivityTs: d.lastActivityTimestamp }));
  }

  /**
   * Compute thread state from recent messages and upsert into thread_states
   */
  async computeAndUpsertState(channelId, guildId) {
    try {
      const messages = await (await this.colMessages()).find({ channelId })
        .sort({ timestamp: -1 }).limit(100).toArray();
      const last = messages[0];
  const participantsMap = new Map();
      for (const m of messages) {
        const id = m.authorId || m.author?.id;
        if (!id) continue;
        participantsMap.set(id, (participantsMap.get(id) || 0) + 1);
      }
  const participants = Object.fromEntries(participantsMap);
  const recentSlice = messages.slice(0, 10);
  const recentAuthorIds = [...new Set(recentSlice.map(m => m.authorId).filter(Boolean))];
  const recentAuthors = [...new Set(recentSlice.map(m => m.authorUsername).filter(Boolean))];
      const doc = {
        channelId,
        guildId: guildId || null,
        lastActivityTs: last?.timestamp || Date.now(),
        lastMessageId: last?.messageId || null,
        participants,
  participantsCount: Object.keys(participants).length,
  recentAuthorIds,
        recentAuthors,
        updatedAt: Date.now(),
      };
      const states = await this.colStates();
      await states.updateOne(
        { channelId },
        { $set: doc, $setOnInsert: { createdAt: Date.now() } },
        { upsert: true }
      );
      return doc;
    } catch (e) {
      this.logger.warn?.(`[ThreadState] compute failed for channel ${channelId}: ${e.message}`);
      return null;
    }
  }

  /**
   * Ensure states exist for currently active channels; return states list
   */
  async getActiveThreadStates(lookbackMs = 15 * 60 * 1000, limit = 20) {
    const channels = await this.getActiveChannels(lookbackMs, limit);
    const states = [];
    for (const ch of channels) {
      try {
        const col = await this.colStates();
        let st = await col.findOne({ channelId: ch.channelId });
        const stale = !st || (Date.now() - (st.updatedAt || 0) > 60 * 1000);
        if (stale) {
          st = await this.computeAndUpsertState(ch.channelId, ch.guildId);
        }
        if (st) states.push(st);
      } catch (e) {
        this.logger.debug?.(`[ThreadState] skip channel ${ch.channelId}: ${e.message}`);
      }
    }
    // Sort by lastActivityTs desc
    states.sort((a, b) => (b.lastActivityTs || 0) - (a.lastActivityTs || 0));
    return states;
  }
}
