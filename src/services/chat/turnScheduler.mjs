export class TurnScheduler {
  constructor({ logger, databaseService, schedulingService, presenceService, discordService, conversationManager, avatarService, responseCoordinator, discordChannelActivityService }) {
    this.logger = logger || console;
    this.databaseService = databaseService;
    this.schedulingService = schedulingService;
    this.presenceService = presenceService;
    this.discordService = discordService;
    this.conversationManager = conversationManager;
    this.avatarService = avatarService;
    this.responseCoordinator = responseCoordinator;
    this.discordChannelActivityService = discordChannelActivityService;
    
  // Default: 1 hour ticks with ±5 minutes jitter
  this.DELTA_MS = Number(process.env.CHANNEL_TICK_MS || 3600000);
  this.JITTER_MS = Number(process.env.CHANNEL_TICK_JITTER_MS || 300000);
  // Global ambient budget per sweep across channels (fairness limiter)
  this.AMBIENT_GLOBAL_BUDGET = Number(process.env.CHANNEL_TICK_GLOBAL_BUDGET || 6);
  // Cap per-channel selections even if activity is high
  this.MAX_K = Number(process.env.CHANNEL_TICK_MAX_K || 3);
  // Suppress ambient chatter briefly after each human message to avoid pileups
  this.blockAmbientUntil = new Map(); // channelId -> timestamp
  this.HUMAN_SUPPRESSION_MS = Number(process.env.HUMAN_SUPPRESSION_MS || 4000);
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

  async tryLease(channelId, avatarId, tickId, meta = {}) {
    const leases = await this.col('turn_leases');
    const lease = { channelId, avatarId, tickId, createdAt: new Date(), leaseExpiresAt: new Date(Date.now() + 90_000), status: 'pending', ...meta };
    try {
      await leases.insertOne(lease);
      this.logger.debug?.(`[TurnScheduler] lease granted ${channelId}:${avatarId}:${tickId} mode=${meta.mode || 'ambient'}`);
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
    const suppressedUntil = this.blockAmbientUntil.get(channelId) || 0;
    if (Date.now() < suppressedUntil) return 0;

    // Human-activity inactivity gating: if no human has spoken for N days, don't run AI ambient turns.
    // This also prevents dead-channel revive attempts from generating noise in long-inactive channels.
    try {
      let guildIdForGate = null;
      try { guildIdForGate = (await this.discordService.getGuildByChannelId(channelId))?.id; } catch {}
      if (this.discordChannelActivityService?.isChannelActiveForAI) {
        const active = await this.discordChannelActivityService.isChannelActiveForAI({
          guildId: guildIdForGate,
          channelId,
        });
        if (!active) {
          this.logger.debug?.(`[TurnScheduler] Skipping ${channelId} - inactive (no human within DISCORD_AI_INACTIVE_DAYS)`);
          return 0;
        }
      }
    } catch (e) {
      this.logger.debug?.(`[TurnScheduler] inactivity gate check failed for ${channelId}: ${e?.message || e}`);
    }

    // Check for dead channel (no human activity)
    if (this.DEAD_CHANNEL_CHECK_ENABLED) {
      const isDeadChannel = await this.checkDeadChannel(channelId);
      if (isDeadChannel) {
        const allowRevive = this.DEAD_CHANNEL_REVIVE_ENABLED && this._shouldAllowDeadChannelRevive(channelId);
        if (!allowRevive) {
          this.logger.debug?.(`[TurnScheduler] Skipping ${channelId} - dead channel (no human activity)`);
          return 0;
        }
        this.logger.info?.(`[TurnScheduler] Dead channel revive attempt allowed: ${channelId} (intervalMs=${this.DEAD_CHANNEL_REVIVE_INTERVAL_MS})`);
      }
    }

    try {
      let guildId = null;
      try { guildId = (await this.discordService.getGuildByChannelId(channelId))?.id; }
      catch (e) {
        const msg = String(e?.message || '').toLowerCase();
        if (msg.includes('missing access') || msg.includes('unknown channel')) return 0;
        this.logger.warn?.(`[TurnScheduler] getGuildByChannelId failed for ${channelId}: ${e.message}`);
        return 0;
      }

      const avatars = await this.avatarService.getAvatarsInChannel(channelId, guildId);
      for (const av of avatars) {
        await this.presenceService.ensurePresence(channelId, `${av._id}`);
      }

      let channel = this.discordService.client.channels.cache.get(channelId);
      if (!channel && this.discordService.client.channels?.fetch) {
        try { channel = await this.discordService.client.channels.fetch(channelId); }
        catch (e) {
          const m = String(e?.message || '').toLowerCase();
          if (m.includes('missing access') || m.includes('unknown channel')) return 0;
        }
      }
      if (!channel) return 0;

      // Use ResponseCoordinator for unified response handling
      const responses = await this.responseCoordinator.coordinateResponse(channel, null, {
        triggerType: 'ambient',
        guildId,
        avatars,
        budgetAllowed
      });

      return responses.length;
    } catch (e) {
      this.logger.warn(`[TurnScheduler] onChannelTick failed for ${channelId}: ${e.message}`);
      return 0;
    }
  }

  _shouldAllowDeadChannelRevive(channelId, now = Date.now()) {
    const last = this.deadChannelReviveAttemptAt.get(channelId) || 0;
    if (now - last < this.DEAD_CHANNEL_REVIVE_INTERVAL_MS) return false;

    // Only roll once per interval; even if we decline, we still record the attempt
    // to avoid repeatedly trying every tick.
    const roll = Math.random();
    const allow = roll < this.DEAD_CHANNEL_REVIVE_PROBABILITY;
    this.deadChannelReviveAttemptAt.set(channelId, now);
    if (!allow) {
      this.logger.debug?.(`[TurnScheduler] Dead channel revive declined: ${channelId} roll=${roll.toFixed(3)} p=${this.DEAD_CHANNEL_REVIVE_PROBABILITY}`);
    }
    return allow;
  }

  /**
   * Check if a message is a proxied human message
   * @param {Object} msg - Discord message object
   * @returns {boolean} True if proxied
   */
  isProxiedMessage(msg) {
    if (!msg) return false;
    return !!(msg.rati?.isProxied || msg.rati?.proxyUserId || msg.isProxied || msg.proxyUserId);
  }

  /**
   * Check if a channel is "dead" (only bot messages, no human activity)
   * NOTE: Proxied messages count as human activity since they're human-initiated
   * @param {string} channelId - Channel ID
   * @returns {Promise<boolean>} True if channel is dead
   */
  async checkDeadChannel(channelId) {
    try {
      // Prefer DB-backed detection because Discord fetches won't preserve our custom
      // `rati.*` metadata across fresh fetches.
      try {
        const db = await this.databaseService.getDatabase();
        const col = db.collection('messages');
        const docs = await col
          .find(
            { channelId: String(channelId) },
            { projection: { webhookId: 1, isProxied: 1, proxyUserId: 1, author: 1, authorId: 1, timestamp: 1 } }
          )
          .sort({ timestamp: -1 })
          .limit(this.DEAD_CHANNEL_THRESHOLD + 5)
          .toArray();

        let consecutiveBots = 0;
        for (const doc of docs) {
          const isProxied = !!(doc?.isProxied || doc?.proxyUserId);
          const authorIsBot = !!(doc?.author?.bot);
          const isWebhook = !!doc?.webhookId;

          if ((authorIsBot || isWebhook) && !isProxied) {
            consecutiveBots++;
            if (consecutiveBots >= this.DEAD_CHANNEL_THRESHOLD) {
              this.logger.info?.(`[TurnScheduler] Dead channel detected: ${channelId} (${consecutiveBots} consecutive bot messages)`);
              return true;
            }
          } else {
            if (isProxied) {
              this.logger.debug?.(`[TurnScheduler] Found proxied human message in ${channelId} (db) - channel is alive`);
            }
            return false;
          }
        }

        if (consecutiveBots >= Math.floor(this.DEAD_CHANNEL_THRESHOLD * 0.75)) {
          this.logger.info?.(`[TurnScheduler] Dead channel detected: ${channelId} (${consecutiveBots} consecutive bot messages, partial batch)`);
          return true;
        }

        return false;
      } catch (dbErr) {
        this.logger.debug?.(`[TurnScheduler] DB dead-channel check failed for ${channelId}: ${dbErr?.message || dbErr}`);
      }

      // Fallback: fetch from Discord (best-effort).
      const channel = this.discordService.client.channels.cache.get(channelId);
      if (!channel) return true; // Can't fetch = treat as dead

      const messages = await channel.messages.fetch({ limit: this.DEAD_CHANNEL_THRESHOLD + 5 });
      let consecutiveBots = 0;

      for (const msg of messages.values()) {
        const isProxied = this.isProxiedMessage(msg);
        if ((msg.author.bot || msg.webhookId) && !isProxied) {
          consecutiveBots++;
          if (consecutiveBots >= this.DEAD_CHANNEL_THRESHOLD) {
            this.logger.info?.(`[TurnScheduler] Dead channel detected: ${channelId} (${consecutiveBots} consecutive bot messages)`);
            return true;
          }
        } else {
          if (isProxied) {
            this.logger.debug?.(`[TurnScheduler] Found proxied human message in ${channelId} - channel is alive`);
          }
          return false;
        }
      }
      
      // If we exhausted messages and all were bots, mark as dead if we have enough samples
      if (consecutiveBots >= Math.floor(this.DEAD_CHANNEL_THRESHOLD * 0.75)) {
        this.logger.info?.(`[TurnScheduler] Dead channel detected: ${channelId} (${consecutiveBots} consecutive bot messages, partial batch)`);
        return true;
      }
      
      return false;
    } catch (e) {
      this.logger.warn?.(`[TurnScheduler] checkDeadChannel failed for ${channelId}: ${e.message}`);
      return false; // Fail open - allow ambient responses on error
    }
  }

  async onHumanMessage(channelId, message) {
    // Start suppression window for ambient chatter
    this.blockAmbientUntil.set(channelId, Date.now() + this.HUMAN_SUPPRESSION_MS);
    
    try {
      const guildId = message.guild?.id;
      const avatars = await this.avatarService.getAvatarsInChannel(channelId, guildId);
      
      // Ensure presence for all avatars
      for (const av of avatars) {
        await this.presenceService.ensurePresence(channelId, `${av._id}`);
      }

      // Record mentions for presence tracking
      const content = (message.content || '').toLowerCase();
      for (const av of avatars) {
        const name = String(av.name || '').toLowerCase();
        const emoji = String(av.emoji || '').toLowerCase();
        if ((name && content.includes(name)) || (emoji && content.includes(emoji))) {
          await this.presenceService.recordMention(channelId, `${av._id}`);
          
          // Grant priority turn if none pending
          try {
            const c = await this.presenceService.col();
            const doc = await c.findOne({ channelId, avatarId: `${av._id}` }, { projection: { newSummonTurnsRemaining: 1 } });
            if (!doc?.newSummonTurnsRemaining) {
              await this.presenceService.grantNewSummonTurns(channelId, `${av._id}`, 1);
            }
          } catch (e) {
            this.logger.warn(`[TurnScheduler] mention boost failed: ${e.message}`);
          }
        }
      }

      let channel = this.discordService.client.channels.cache.get(channelId);
      if (!channel && this.discordService.client.channels?.fetch) {
        try { channel = await this.discordService.client.channels.fetch(channelId); }
        catch {}
      }
      if (!channel) return false;

      // Use ResponseCoordinator for unified response handling
      const responses = await this.responseCoordinator.coordinateResponse(channel, message, {
        guildId,
        avatars,
        overrideCooldown: true
      });

      return responses.length > 0;
    } catch (e) {
      this.logger.error(`[TurnScheduler] onHumanMessage failed: ${e.message}`);
      return false;
    }
  }
}

export default TurnScheduler;
