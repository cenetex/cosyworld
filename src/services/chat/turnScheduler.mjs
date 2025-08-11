export class TurnScheduler {
  constructor({ logger, databaseService, schedulingService, presenceService, discordService, conversationManager, avatarService }) {
    this.logger = logger || console;
    this.databaseService = databaseService;
    this.schedulingService = schedulingService;
    this.presenceService = presenceService;
    this.discordService = discordService;
    this.conversationManager = conversationManager;
    this.avatarService = avatarService;
    this.DELTA_MS = Number(process.env.CHANNEL_TICK_MS || 60000);
    this.JITTER_MS = Number(process.env.CHANNEL_TICK_JITTER_MS || 15000);
  }

  async col(name) { return (await this.databaseService.getDatabase()).collection(name); }

  jitteredDelay() { return this.DELTA_MS + Math.round((Math.random() * 2 - 1) * this.JITTER_MS); }

  start() {
    if (!this.schedulingService) {
      this.logger.warn('[TurnScheduler] schedulingService not available');
      return;
    }
    this.schedulingService.addTask('channel-ticks', () => this.tickAll().catch(e => this.logger.error('[TurnScheduler] tickAll error', e)), this.jitteredDelay());
    this.logger.info('[TurnScheduler] Ambient ticks scheduled');
  }

  async currentTickId(channelId) {
    const ticks = await this.col('channel_ticks');
    const doc = await ticks.findOneAndUpdate(
      { channelId },
      { $setOnInsert: { lastTickAt: new Date(), tickId: 0 } },
      { upsert: true, returnDocument: 'after' }
    );
    return doc.value?.tickId || 0;
  }

  async nextTickId(channelId) {
    const ticks = await this.col('channel_ticks');
    const res = await ticks.findOneAndUpdate(
      { channelId },
      { $inc: { tickId: 1 }, $set: { lastTickAt: new Date() } },
      { upsert: true, returnDocument: 'after' }
    );
    return res.value.tickId;
  }

  async tryLease(channelId, avatarId, tickId) {
    const leases = await this.col('turn_leases');
    const lease = { channelId, avatarId, tickId, leaseExpiresAt: new Date(Date.now() + 90_000), status: 'pending' };
    try {
      await leases.insertOne(lease);
      return true;
    } catch (e) {
      if (String(e?.message || '').includes('duplicate key')) return false;
      throw e;
    }
  }

  async completeLease(channelId, avatarId, tickId) {
    const leases = await this.col('turn_leases');
    await leases.updateOne({ channelId, avatarId, tickId }, { $set: { status: 'completed' } });
  }

  computeK(activeHumans) {
    return Math.max(1, Math.min(3, Math.ceil((activeHumans || 0) / 5)));
  }

  async tickAll() {
    const db = await this.databaseService.getDatabase();
    const channels = await db.collection('channel_activity')
      .find()
      .sort({ lastActivityTimestamp: -1 })
      .limit(50)
      .toArray();
    for (const ch of channels) {
      try { await this.onChannelTick(ch._id); }
      catch (e) { this.logger.warn(`[TurnScheduler] tick ${ch._id} failed: ${e.message}`); }
    }
  }

  async onChannelTick(channelId) {
    // Ensure presence docs exist for avatars in channel
    const guildId = (await this.discordService.getGuildByChannelId(channelId))?.id;
    const avatars = await this.avatarService.getAvatarsInChannel(channelId, guildId);
    for (const av of avatars) {
      await this.presenceService.ensurePresence(channelId, `${av._id}`);
    }

    const tickId = await this.nextTickId(channelId);
    const present = await this.presenceService.listPresent(channelId);
    if (!present.length) return;

    const K = this.computeK(3);

    const ctx = { mentionedSet: new Set(), topicTags: [] };
    const ranked = present
      .map(doc => ({ doc, score: this.presenceService.scoreInitiative(doc, ctx) }))
      .sort((a,b) => b.score - a.score || (b.doc.priorityPins||0) - (a.doc.priorityPins||0) || new Date(b.doc.lastMentionedAt||0) - new Date(a.doc.lastMentionedAt||0) || new Date(a.doc.lastTurnAt||0) - new Date(b.doc.lastTurnAt||0) || String(a.doc.avatarId).localeCompare(String(b.doc.avatarId)) )
      .slice(0, K * 3);

    let taken = 0;
    const channel = this.discordService.client.channels.cache.get(channelId);
    for (const r of ranked) {
      if (taken >= K) break;
      if (r.doc.state !== 'present') continue;
      if (this.presenceService.cooldownActive(r.doc)) continue;
      const ok = await this.tryLease(channelId, r.doc.avatarId, tickId);
      if (!ok) continue;
      try {
        await this.conversationManager.sendResponse(channel, { _id: r.doc.avatarId });
        await this.completeLease(channelId, r.doc.avatarId, tickId);
        await this.presenceService.recordTurn(channelId, r.doc.avatarId);
        taken++;
      } catch (e) {
        this.logger.warn(`[TurnScheduler] sendResponse failed for ${r.doc.avatarId}: ${e.message}`);
      }
    }
  }

  async onHumanMessage(channelId, message) {
    const guildId = message.guild?.id;
    const avatars = await this.avatarService.getAvatarsInChannel(channelId, guildId);
    const tickId = await this.currentTickId(channelId);
    const channel = this.discordService.client.channels.cache.get(channelId);

    const content = (message.content || '').toLowerCase();
    const candidates = [];
    for (const av of avatars) {
      const name = String(av.name || '').toLowerCase();
      const emoji = String(av.emoji || '').toLowerCase();
      if (!name && !emoji) continue;
      if (name && content.includes(name) || (emoji && content.includes(emoji))) {
        await this.presenceService.ensurePresence(channelId, `${av._id}`);
        await this.presenceService.recordMention(channelId, `${av._id}`);
        candidates.push({ doc: { avatarId: `${av._id}` }, score: 1 });
      }
    }

    if (candidates.length === 0) return false;

    for (const r of candidates) {
      const ok = await this.tryLease(channelId, r.doc.avatarId, tickId);
      if (!ok) continue;
      try {
        await this.conversationManager.sendResponse(channel, { _id: r.doc.avatarId });
        await this.completeLease(channelId, r.doc.avatarId, tickId);
        await this.presenceService.recordTurn(channelId, r.doc.avatarId);
        return true;
      } catch (e) {
        this.logger.warn(`[TurnScheduler] fast-lane failed for ${r.doc.avatarId}: ${e.message}`);
      }
    }
    return false;
  }
}

export default TurnScheduler;
