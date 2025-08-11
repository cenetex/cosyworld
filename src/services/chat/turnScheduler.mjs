export class TurnScheduler {
  constructor({ logger, databaseService, schedulingService, presenceService, discordService, conversationManager, avatarService }) {
    this.logger = logger || console;
    this.databaseService = databaseService;
    this.schedulingService = schedulingService;
    this.presenceService = presenceService;
    this.discordService = discordService;
    this.conversationManager = conversationManager;
    this.avatarService = avatarService;
  // Default: 1 hour ticks with ±5 minutes jitter
  this.DELTA_MS = Number(process.env.CHANNEL_TICK_MS || 3600000);
  this.JITTER_MS = Number(process.env.CHANNEL_TICK_JITTER_MS || 300000);
  // Global ambient budget per sweep across channels (fairness limiter)
  this.AMBIENT_GLOBAL_BUDGET = Number(process.env.CHANNEL_TICK_GLOBAL_BUDGET || 6);
  // Cap per-channel selections even if activity is high
  this.MAX_K = Number(process.env.CHANNEL_TICK_MAX_K || 3);
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
    try {
      const doc = await ticks.findOneAndUpdate(
        { channelId },
        { $setOnInsert: { lastTickAt: new Date(), tickId: 0 } },
        { upsert: true, returnDocument: 'after' }
      );
      if (doc?.value && typeof doc.value.tickId === 'number') return doc.value.tickId;
    } catch {}
    const found = await ticks.findOne({ channelId });
    if (found?.tickId != null) return found.tickId;
    try { await ticks.insertOne({ channelId, tickId: 0, lastTickAt: new Date() }); } catch {}
    const again = await ticks.findOne({ channelId });
    return again?.tickId || 0;
  }

  async nextTickId(channelId) {
    const ticks = await this.col('channel_ticks');
    try {
      const res = await ticks.findOneAndUpdate(
        { channelId },
        { $inc: { tickId: 1 }, $set: { lastTickAt: new Date() } },
        { upsert: true, returnDocument: 'after' }
      );
      if (res?.value && typeof res.value.tickId === 'number') return res.value.tickId;
    } catch {}
    // Fallback path
    await ticks.updateOne(
      { channelId },
      { $setOnInsert: { tickId: 0, lastTickAt: new Date() } },
      { upsert: true }
    );
    const cur = await this.currentTickId(channelId);
    const next = cur + 1;
    await ticks.updateOne({ channelId }, { $set: { tickId: next, lastTickAt: new Date() } });
    return next;
  }

  async tryLease(channelId, avatarId, tickId) {
    const leases = await this.col('turn_leases');
  const lease = { channelId, avatarId, tickId, createdAt: new Date(), leaseExpiresAt: new Date(Date.now() + 90_000), status: 'pending' };
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
    await leases.updateOne(
      { channelId, avatarId, tickId },
      { $set: { status: 'completed', completedAt: new Date() } }
    );
  }

  async failLease(channelId, avatarId, tickId, error) {
    const leases = await this.col('turn_leases');
    await leases.updateOne(
      { channelId, avatarId, tickId },
      { $set: { status: 'failed', failedAt: new Date(), error: String(error?.message || error || 'unknown') } }
    );
  }

  computeK(activeHumans) {
    // Base K grows with active humans; clamp by MAX_K
    return Math.max(1, Math.min(this.MAX_K, Math.ceil((activeHumans || 0) / 5)));
  }

  async tickAll() {
    const db = await this.databaseService.getDatabase();
    const channels = await db.collection('channel_activity')
      .find()
      .sort({ lastActivityTimestamp: -1 })
      .limit(50)
      .toArray();
    let budgetLeft = this.AMBIENT_GLOBAL_BUDGET;
    for (const ch of channels) {
      if (budgetLeft <= 0) break;
      try {
        const taken = await this.onChannelTick(ch._id, budgetLeft);
        budgetLeft -= taken;
      }
      catch (e) { this.logger.warn(`[TurnScheduler] tick ${ch._id} failed: ${e.message}`); }
    }
    if (this.AMBIENT_GLOBAL_BUDGET > 0) {
      const used = this.AMBIENT_GLOBAL_BUDGET - budgetLeft;
      this.logger.debug?.(`[TurnScheduler] Ambient sweep used ${used}/${this.AMBIENT_GLOBAL_BUDGET} budget across ${channels.length} channels`);
    }
  }

  async onChannelTick(channelId, budgetAllowed = Infinity) {
    // Ensure presence docs exist for avatars in channel
    const guildId = (await this.discordService.getGuildByChannelId(channelId))?.id;
    const avatars = await this.avatarService.getAvatarsInChannel(channelId, guildId);
    for (const av of avatars) {
      await this.presenceService.ensurePresence(channelId, `${av._id}`);
    }

    const tickId = await this.nextTickId(channelId);
    const present = await this.presenceService.listPresent(channelId);
    if (!present.length) return 0;

    // Estimate human activity in last 10 minutes
    let activeHumans = 0;
    try {
      const db = await this.databaseService.getDatabase();
      const since = Date.now() - 10 * 60 * 1000;
      activeHumans = await db.collection('messages').distinct('authorId', { channelId, timestamp: { $gt: since }, 'author.bot': false }).then(a => a.length).catch(() => 0);
    } catch {}

  let K = this.computeK(activeHumans);
  if (Number.isFinite(budgetAllowed)) K = Math.min(K, Math.max(0, budgetAllowed));

    const ctx = { mentionedSet: new Set(), topicTags: [] };
    const ranked = present
      .map(doc => ({ doc, score: this.presenceService.scoreInitiative(doc, ctx) }))
      .sort((a,b) => b.score - a.score || (b.doc.priorityPins||0) - (a.doc.priorityPins||0) || new Date(b.doc.lastMentionedAt||0) - new Date(a.doc.lastMentionedAt||0) || new Date(a.doc.lastTurnAt||0) - new Date(b.doc.lastTurnAt||0) || String(a.doc.avatarId).localeCompare(String(b.doc.avatarId)) )
      .slice(0, K * 3);

    let taken = 0;
  let channel = this.discordService.client.channels.cache.get(channelId);
    if (!channel && this.discordService.client.channels?.fetch) {
      try { channel = await this.discordService.client.channels.fetch(channelId); }
      catch {}
    }
  if (!channel) return 0;
    for (const r of ranked) {
      if (taken >= K) break;
      if (r.doc.state !== 'present') continue;
      if (this.presenceService.cooldownActive(r.doc)) continue;
      const ok = await this.tryLease(channelId, r.doc.avatarId, tickId);
      if (!ok) continue;
      try {
        const avatar = await this.avatarService.getAvatarById(r.doc.avatarId);
        if (!avatar) { await this.completeLease(channelId, r.doc.avatarId, tickId); continue; }
        await this.conversationManager.sendResponse(channel, avatar);
        await this.completeLease(channelId, r.doc.avatarId, tickId);
        await this.presenceService.recordTurn(channelId, r.doc.avatarId);
        taken++;
      } catch (e) {
        this.logger.warn(`[TurnScheduler] sendResponse failed for ${r.doc.avatarId}: ${e.message}`);
        try { await this.failLease(channelId, r.doc.avatarId, tickId, e); } catch {}
      }
    }
    return taken;
  }

  async onHumanMessage(channelId, message) {
    const guildId = message.guild?.id;
    const avatars = await this.avatarService.getAvatarsInChannel(channelId, guildId);
    const tickId = await this.currentTickId(channelId);
    let channel = this.discordService.client.channels.cache.get(channelId);
    if (!channel && this.discordService.client.channels?.fetch) {
      try { channel = await this.discordService.client.channels.fetch(channelId); }
      catch {}
    }

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
    const avatar = await this.avatarService.getAvatarById(r.doc.avatarId);
    if (!avatar) { await this.completeLease(channelId, r.doc.avatarId, tickId); continue; }
    await this.conversationManager.sendResponse(channel, avatar);
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
