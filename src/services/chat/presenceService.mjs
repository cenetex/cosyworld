import { randomUUID } from 'crypto';

export class PresenceService {
  constructor({ logger, databaseService, configService }) {
    this.logger = logger || console;
    this.databaseService = databaseService;
    this.config = configService || { get: (k, d) => process.env[k] ?? d };
    this.cache = new Map(); // key: channelId:avatarId -> { score, at }
    this.CACHE_MS = 5000;
    this.MIN_INTERVAL_MS = Number(process.env.TURN_MIN_INTERVAL_SEC || 90) * 1000;
  }

  async col() { return (await this.databaseService.getDatabase()).collection('presence'); }

  async ensurePresence(channelId, avatarId) {
    const c = await this.col();
    const now = new Date();
    const upd = {
      $setOnInsert: { state: 'present', sessionId: randomUUID(), createdAt: now },
      $set: { updatedAt: now }
    };
    const res = await c.findOneAndUpdate({ channelId, avatarId }, upd, { upsert: true, returnDocument: 'after' });
    return res.value || (await c.findOne({ channelId, avatarId }));
  }

  async startSession(channelId, avatarId) {
    const c = await this.col();
    const now = new Date();
    const sessionId = randomUUID();
    const res = await c.findOneAndUpdate(
      { channelId, avatarId },
      { $set: { sessionId, state: 'present', lastSummonedAt: now, updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true, returnDocument: 'after' }
    );
    return res.value;
  }

  async focusPing(channelId, avatarId) {
    const c = await this.col();
    const now = new Date();
    await c.updateOne({ channelId, avatarId, state: 'present' }, { $set: { lastSummonedAt: now, updatedAt: now } });
  }

  async recordMention(channelId, avatarId) {
    const c = await this.col();
    await c.updateOne({ channelId, avatarId }, { $set: { lastMentionedAt: new Date(), updatedAt: new Date() } }, { upsert: true });
  }

  async recordTurn(channelId, avatarId) {
    const c = await this.col();
    await c.updateOne({ channelId, avatarId }, { $set: { lastTurnAt: new Date(), state: 'cooldown', updatedAt: new Date() } });
  }

  cooldownActive(doc, now = Date.now()) {
    const last = doc?.lastTurnAt ? new Date(doc.lastTurnAt).getTime() : 0;
    return last && (now - last) < this.MIN_INTERVAL_MS;
  }

  scoreInitiative(doc, ctx = {}) {
    const now = Date.now();
    const ageMin = (t) => t ? Math.max(0, (now - new Date(t).getTime()) / 60000) : Infinity;
    const clamp01 = (x) => Math.max(0, Math.min(1, x));

    const mentioned = !!ctx.mentionedSet?.has?.(doc.avatarId);
    const mentionBoost = mentioned ? Math.pow(0.5, ageMin(doc.lastMentionedAt) / 10) : 0;

    const a = ageMin(doc.lastSummonedAt);
    let summonRecency = 0;
    if (a <= 10) summonRecency = 1;
    else if (a >= 30) summonRecency = 0;
    else summonRecency = 1 - ((a - 10) / 20);

    const targetCadenceMin = Number(process.env.TARGET_CADENCE_MIN || 12);
    const hunger = clamp01((ageMin(doc.lastTurnAt) || 9999) / targetCadenceMin);

    const topicOverlap = (ctx.topicTags && doc.topicTags) ? (doc.topicTags.filter(t => ctx.topicTags.includes(t)).length) : 0;
    const topicMatch = clamp01(topicOverlap / 3);

    const priorityPins = clamp01((doc.priorityPins || 0) / 1);
    const socialBalance = clamp01(ctx.socialBalanceLift || 0);
    const cooldownPenalty = this.cooldownActive(doc) ? 1 : 0;
    const fatiguePenalty = clamp01((doc.fatigue || 0));

    let score = 0.45 * mentionBoost
      + 0.25 * summonRecency
      + 0.15 * hunger
      + 0.07 * topicMatch
      + 0.05 * priorityPins
      + 0.03 * socialBalance
      - 0.20 * cooldownPenalty
      - 0.10 * fatiguePenalty;
    score = clamp01(score);
    return score;
  }

  async listPresent(channelId) {
    const c = await this.col();
    return await c.find({ channelId, state: { $in: ['present','cooldown'] } }).project({}).toArray();
  }

  /**
   * Grant a limited number of guaranteed early turns to a freshly summoned avatar.
   */
  async grantNewSummonTurns(channelId, avatarId, turns = 2) {
    try {
      const c = await this.col();
      await c.updateOne({ channelId, avatarId }, { $set: { newSummonTurnsRemaining: turns, lastSummonedAt: new Date(), updatedAt: new Date() } }, { upsert: true });
    } catch (e) {
      this.logger?.warn?.(`grantNewSummonTurns failed: ${e.message}`);
    }
  }

  async consumeNewSummonTurn(channelId, avatarId) {
    try {
      const c = await this.col();
      const res = await c.findOneAndUpdate(
        { channelId, avatarId, newSummonTurnsRemaining: { $gt: 0 } },
        { $inc: { newSummonTurnsRemaining: -1 }, $set: { updatedAt: new Date() } },
        { returnDocument: 'after' }
      );
      if (res.value && res.value.newSummonTurnsRemaining <= 0) {
        await c.updateOne({ channelId, avatarId }, { $unset: { newSummonTurnsRemaining: '' }, $set: { updatedAt: new Date() } });
      }
    } catch (e) {
      this.logger?.warn?.(`consumeNewSummonTurn failed: ${e.message}`);
    }
  }
}

export default PresenceService;
