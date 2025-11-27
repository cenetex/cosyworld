/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Telegram Member Manager
 * Handles member tracking, trust levels, and spam prevention
 */

import { SPAM_CONFIG } from './constants.mjs';
import { escapeRegExp } from './utils.mjs';

/**
 * MemberManager handles all member-related operations
 */
export class MemberManager {
  constructor({ logger, databaseService, cacheManager }) {
    this.logger = logger;
    this.databaseService = databaseService;
    this.cache = cacheManager;
  }

  // ============================================================================
  // Member Record Formatting
  // ============================================================================

  /**
   * Format a member record for API response
   * @param {Object} member - Raw member document
   * @returns {Object|null} - Formatted member record
   */
  formatMemberRecord(member) {
    if (!member) return null;

    return {
      id: member._id ? String(member._id) : null,
      channelId: member.channelId || null,
      userId: member.userId || null,
      username: member.username || null,
      firstName: member.firstName || null,
      lastName: member.lastName || null,
      displayName: member.displayName || null,
      trustLevel: member.trustLevel || 'new',
      joinedAt: member.joinedAt || null,
      firstMessageAt: member.firstMessageAt || null,
      lastMessageAt: member.lastMessageAt || null,
      leftAt: member.leftAt || null,
      joinedViaLink: Boolean(member.joinedViaLink),
      messageCount: member.messageCount || 0,
      spamStrikes: member.spamStrikes || 0,
      lastSpamStrike: member.lastSpamStrike || null,
      penaltyExpires: member.penaltyExpires || null,
      permanentlyBlacklisted: Boolean(member.permanentlyBlacklisted),
      mentionedBotCount: member.mentionedBotCount || 0,
      receivedResponseCount: member.receivedResponseCount || 0,
      adminNotes: member.adminNotes || null,
      updatedAt: member.updatedAt || null,
    };
  }

  // ============================================================================
  // Member Fetching
  // ============================================================================

  /**
   * Fetch a member record (with caching)
   * @param {string} channelId - Channel ID
   * @param {string} userId - User ID
   * @param {Object} options - Options
   * @returns {Promise<Object|null>}
   */
  async fetchMemberRecord(channelId, userId, { force = false } = {}) {
    if (!this.databaseService) return null;

    if (!force) {
      const cached = this.cache.getMember(channelId, userId);
      if (cached) return cached;
    }

    try {
      const db = await this.databaseService.getDatabase();
      const record = await db.collection('telegram_members').findOne({ channelId, userId });
      if (record) {
        this.cache.setMember(channelId, userId, record);
      }
      return record;
    } catch (error) {
      this.logger?.error?.('[MemberManager] Failed to fetch member record:', error);
      return null;
    }
  }

  // ============================================================================
  // Member Tracking
  // ============================================================================

  /**
   * Track a user joining a channel
   * @param {string} channelId - Channel ID
   * @param {Object} member - Telegram user object
   * @param {Object} context - Join context
   */
  async trackUserJoin(channelId, member, context = {}) {
    if (!this.databaseService || !member?.id) return;

    const userId = String(member.id);
    const joinedViaLink = Boolean(context?.invite_link);

    let existing = null;
    try {
      existing = await this.fetchMemberRecord(channelId, userId, { force: true });
    } catch (error) {
      this.logger?.debug?.('[MemberManager] Existing member lookup failed:', error?.message);
    }

    const trustLevel = existing?.permanentlyBlacklisted ? (existing.trustLevel || 'banned') : 'new';

    try {
      const db = await this.databaseService.getDatabase();
      await db.collection('telegram_members').updateOne(
        { channelId, userId },
        {
          $setOnInsert: {
            userId,
            channelId,
            joinedAt: new Date(),
            messageCount: 0,
            spamStrikes: 0,
            permanentlyBlacklisted: false,
            mentionedBotCount: 0,
            receivedResponseCount: 0,
            createdAt: new Date(),
          },
          $set: {
            username: member.username || null,
            firstName: member.first_name || null,
            lastName: member.last_name || null,
            joinedViaLink,
            updatedAt: new Date(),
            leftAt: null,
            trustLevel,
          },
        },
        { upsert: true }
      );

      this.cache.invalidateMember(channelId, userId);
      this.logger?.info?.(`[MemberManager] Tracked member join: ${userId} in ${channelId}`);
    } catch (error) {
      this.logger?.error?.('[MemberManager] Failed to track member join:', error);
    }
  }

  /**
   * Track a user leaving a channel
   * @param {string} channelId - Channel ID
   * @param {string} userId - User ID
   */
  async trackUserLeft(channelId, userId) {
    if (!this.databaseService || !userId) return;

    try {
      const db = await this.databaseService.getDatabase();
      await db.collection('telegram_members').updateOne(
        { channelId, userId },
        {
          $set: {
            leftAt: new Date(),
            updatedAt: new Date(),
            trustLevel: 'left',
          },
        }
      );

      this.cache.invalidateMember(channelId, userId);
      this.logger?.info?.(`[MemberManager] Member left tracked: ${userId} from ${channelId}`);
    } catch (error) {
      this.logger?.error?.('[MemberManager] Failed to track member left:', error);
    }
  }

  /**
   * Update member activity
   * @param {string} channelId - Channel ID
   * @param {string} userId - User ID
   * @param {Object} options - Options
   */
  async updateMemberActivity(channelId, userId, { isMentioned = false } = {}) {
    if (!this.databaseService || !userId) return;

    try {
      const db = await this.databaseService.getDatabase();
      const incFields = { messageCount: 1 };
      if (isMentioned) {
        incFields.mentionedBotCount = 1;
      }

      await db.collection('telegram_members').updateOne(
        { channelId, userId },
        {
          $set: {
            lastMessageAt: new Date(),
            updatedAt: new Date(),
          },
          $setOnInsert: {
            firstMessageAt: new Date(),
          },
          $inc: incFields,
        },
        { upsert: true }
      );

      this.cache.invalidateMember(channelId, userId);
      await this.updateUserTrustLevel(channelId, userId);
    } catch (error) {
      this.logger?.error?.('[MemberManager] Failed to update member activity:', error);
    }
  }

  /**
   * Record that the bot responded to a user
   * @param {string} channelId - Channel ID
   * @param {string} userId - User ID
   */
  async recordBotResponse(channelId, userId) {
    if (!this.databaseService || !userId) return;

    try {
      const db = await this.databaseService.getDatabase();
      await db.collection('telegram_members').updateOne(
        { channelId, userId },
        {
          $inc: { receivedResponseCount: 1 },
          $set: { updatedAt: new Date() },
        }
      );
      this.cache.invalidateMember(channelId, userId);
    } catch (error) {
      this.logger?.error?.('[MemberManager] Failed to record bot response:', error);
    }
  }

  // ============================================================================
  // Trust Level Management
  // ============================================================================

  /**
   * Update a user's trust level based on activity
   * @param {string} channelId - Channel ID
   * @param {string} userId - User ID
   */
  async updateUserTrustLevel(channelId, userId) {
    if (!this.databaseService || !userId) return;

    try {
      const member = await this.fetchMemberRecord(channelId, userId, { force: true });
      if (!member || member.permanentlyBlacklisted) return;

      const now = Date.now();
      const joinedAt = member.joinedAt ? new Date(member.joinedAt).getTime() : now;
      const membershipDuration = now - joinedAt;
      const messageCount = member.messageCount || 0;

      let nextTrust = member.trustLevel || 'new';

      if (membershipDuration >= 30 * 24 * 60 * 60 * 1000 && messageCount >= 50) {
        nextTrust = 'trusted';
      } else if (membershipDuration >= 7 * 24 * 60 * 60 * 1000 && messageCount >= 10) {
        nextTrust = 'probation';
      } else if (membershipDuration >= SPAM_CONFIG.PROBATION_MS) {
        nextTrust = 'new';
      }

      if (nextTrust !== member.trustLevel) {
        const db = await this.databaseService.getDatabase();
        await db.collection('telegram_members').updateOne(
          { channelId, userId },
          {
            $set: {
              trustLevel: nextTrust,
              updatedAt: new Date(),
            },
          }
        );
        this.cache.invalidateMember(channelId, userId);
        this.logger?.info?.(`[MemberManager] Updated trust level for ${userId}: ${member.trustLevel} -> ${nextTrust}`);
      }
    } catch (error) {
      this.logger?.error?.('[MemberManager] Failed to update trust level:', error);
    }
  }

  // ============================================================================
  // Spam Prevention
  // ============================================================================

  /**
   * Get the penalty tier for a given strike count
   * @param {number} strikeCount - Number of strikes
   * @returns {Object|null} - Penalty tier or null
   */
  getPenaltyTier(strikeCount) {
    if (!Array.isArray(SPAM_CONFIG.PENALTY_TIERS) || !SPAM_CONFIG.PENALTY_TIERS.length) {
      return null;
    }
    const normalized = Math.max(1, Number(strikeCount) || 1);
    return SPAM_CONFIG.PENALTY_TIERS.find(tier => normalized <= tier.strikes) 
      || SPAM_CONFIG.PENALTY_TIERS[SPAM_CONFIG.PENALTY_TIERS.length - 1];
  }

  /**
   * Record a spam strike for a user
   * @param {string} channelId - Channel ID
   * @param {string} userId - User ID
   * @param {number} strikeCount - Current strike count
   */
  async recordSpamStrike(channelId, userId, strikeCount) {
    if (!this.databaseService || !userId) return;

    try {
      const db = await this.databaseService.getDatabase();
      const tier = this.getPenaltyTier(strikeCount);
      const penaltyMs = tier?.durationMs ?? 60_000;
      const isPermanent = !Number.isFinite(penaltyMs);
      const penaltyExpires = isPermanent
        ? new Date(8640000000000000)
        : new Date(Date.now() + penaltyMs);

      const update = {
        $set: {
          lastSpamStrike: new Date(),
          penaltyExpires,
          updatedAt: new Date(),
        },
        $inc: {
          spamStrikes: 1,
        },
      };

      if (isPermanent) {
        update.$set.permanentlyBlacklisted = true;
        update.$set.trustLevel = 'banned';
        this.logger?.error?.(`[MemberManager] User ${userId} permanently blacklisted in ${channelId}`);
      }

      await db.collection('telegram_members').updateOne({ channelId, userId }, update, { upsert: true });
      this.cache.invalidateMember(channelId, userId);
      this.cache.clearSpamTracker(userId);

      const notice = tier?.notice ? ` ${tier.notice}` : '';
      this.logger?.warn?.(`[MemberManager] Spam strike for ${userId} -> ${strikeCount}.${notice}`);
    } catch (error) {
      this.logger?.error?.('[MemberManager] Failed to record spam strike:', error);
    }
  }

  /**
   * Check if a user should be processed or blocked
   * @param {Object} ctx - Telegram context
   * @param {string} channelId - Channel ID
   * @param {string} userId - User ID
   * @param {Object} options - Options
   * @returns {Promise<boolean>} - True if user should be processed
   */
  async shouldProcessUser(ctx, channelId, userId, { isMentioned = false, isPrivate = false } = {}) {
    if (isPrivate || !userId) {
      return true;
    }

    if (!this.databaseService) {
      return true;
    }

    try {
      let member = await this.fetchMemberRecord(channelId, userId);

      if (!member) {
        await this.trackUserJoin(channelId, ctx.message?.from, ctx.message);
        member = await this.fetchMemberRecord(channelId, userId, { force: true });
      }

      if (!member) {
        return true;
      }

      // Check blacklist
      if (member.permanentlyBlacklisted || member.trustLevel === 'banned') {
        this.logger?.warn?.(`[MemberManager] Ignoring blacklisted user ${userId}`);
        return false;
      }

      // Check penalty
      const now = Date.now();
      const penaltyUntil = member.penaltyExpires ? new Date(member.penaltyExpires).getTime() : 0;
      if (penaltyUntil && penaltyUntil > now) {
        this.logger?.debug?.(`[MemberManager] User ${userId} under penalty until ${new Date(penaltyUntil).toISOString()}`);
        return false;
      }

      const joinedAt = member.joinedAt ? new Date(member.joinedAt).getTime() : now;
      const membershipDuration = now - joinedAt;
      const preExistingStrikes = member.spamStrikes || 0;

      await this.updateMemberActivity(channelId, userId, { isMentioned });

      // Check spam
      const windowCount = this.cache.checkSpamWindow(userId, SPAM_CONFIG.WINDOW_MS, SPAM_CONFIG.THRESHOLD);
      if (windowCount > SPAM_CONFIG.THRESHOLD) {
        const nextStrike = preExistingStrikes + 1;
        await this.recordSpamStrike(channelId, userId, nextStrike);
        const tier = this.getPenaltyTier(nextStrike);
        const warning = tier?.notice ? `⚠️ ${tier.notice}` : '⚠️ Slow down.';
        if (ctx?.reply) {
          try {
            await ctx.reply(warning);
          } catch (warnErr) {
            this.logger?.debug?.('[MemberManager] Failed to send spam warning:', warnErr?.message);
          }
        }
        return false;
      }

      // Check probation
      if (membershipDuration < SPAM_CONFIG.PROBATION_MS && !isMentioned) {
        this.logger?.debug?.(`[MemberManager] User ${userId} in probation`);
        return false;
      }

      return true;
    } catch (error) {
      this.logger?.error?.('[MemberManager] shouldProcessUser failed:', error);
      return true;
    }
  }

  // ============================================================================
  // Admin Operations
  // ============================================================================

  /**
   * List members in a channel
   * @param {string} channelId - Channel ID
   * @param {Object} options - List options
   * @returns {Promise<Object>} - { total, limit, offset, members }
   */
  async listMembers(channelId, options = {}) {
    if (!this.databaseService) {
      return { total: 0, limit: 0, offset: 0, members: [] };
    }

    const {
      limit = 50,
      offset = 0,
      trustLevels,
      includeLeft = false,
      search = '',
    } = options;

    const parsedLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const parsedOffset = Math.max(0, Number(offset) || 0);

    try {
      const db = await this.databaseService.getDatabase();
      const collection = db.collection('telegram_members');
      const clauses = [{ channelId: String(channelId) }];

      if (!includeLeft) {
        clauses.push({
          $or: [{ leftAt: { $exists: false } }, { leftAt: null }],
        });
      }

      if (Array.isArray(trustLevels) && trustLevels.length > 0) {
        clauses.push({ trustLevel: { $in: trustLevels } });
      }

      if (search && typeof search === 'string' && search.trim()) {
        const trimmed = search.trim();
        const regex = new RegExp(escapeRegExp(trimmed), 'i');
        clauses.push({
          $or: [
            { userId: trimmed },
            { userId: regex },
            { username: regex },
            { firstName: regex },
            { lastName: regex },
          ],
        });
      }

      const filter = clauses.length === 1 ? clauses[0] : { $and: clauses };

      const cursor = collection
        .find(filter)
        .sort({ permanentlyBlacklisted: -1, spamStrikes: -1, updatedAt: -1 })
        .skip(parsedOffset)
        .limit(parsedLimit);

      const [members, total] = await Promise.all([
        cursor.toArray(),
        collection.countDocuments(filter),
      ]);

      return {
        total,
        limit: parsedLimit,
        offset: parsedOffset,
        members: members.map((m) => this.formatMemberRecord(m)),
      };
    } catch (error) {
      this.logger?.error?.('[MemberManager] Failed to list members:', error);
      throw error;
    }
  }

  /**
   * Get detailed member info
   * @param {string} channelId - Channel ID
   * @param {string} userId - User ID
   * @param {Object} options - Options
   * @returns {Promise<Object|null>}
   */
  async getMember(channelId, userId, { includeMessages = true, messageLimit = 20 } = {}) {
    if (!this.databaseService) return null;

    try {
      const db = await this.databaseService.getDatabase();
      const member = await db.collection('telegram_members').findOne({
        channelId: String(channelId),
        userId: String(userId),
      });

      if (!member) return null;

      let recentMessages = [];
      if (includeMessages) {
        const limit = Math.max(0, Math.min(100, Number(messageLimit) || 20));
        recentMessages = await db
          .collection('telegram_messages')
          .find({ channelId: String(channelId), userId: String(userId) })
          .sort({ date: -1 })
          .limit(limit)
          .project({ _id: 0, text: 1, date: 1, isBot: 1 })
          .toArray();
      }

      return {
        member: this.formatMemberRecord(member),
        recentMessages,
      };
    } catch (error) {
      this.logger?.error?.('[MemberManager] Failed to get member:', error);
      throw error;
    }
  }

  /**
   * Update a member's settings
   * @param {string} channelId - Channel ID
   * @param {string} userId - User ID
   * @param {Object} updates - Updates to apply
   * @returns {Promise<Object|null>}
   */
  async updateMember(channelId, userId, updates = {}) {
    if (!this.databaseService) return null;

    const allowedTrustLevels = new Set(['new', 'probation', 'trusted', 'suspicious', 'banned', 'left']);
    const setFields = { updatedAt: new Date() };
    const unsetFields = {};

    if (typeof updates.trustLevel === 'string') {
      const desired = updates.trustLevel.trim();
      if (!allowedTrustLevels.has(desired)) {
        throw new Error(`Invalid trust level: ${desired}`);
      }
      setFields.trustLevel = desired;
    }

    if (typeof updates.permanentlyBlacklisted === 'boolean') {
      setFields.permanentlyBlacklisted = updates.permanentlyBlacklisted;
      if (updates.permanentlyBlacklisted) {
        setFields.trustLevel = 'banned';
      }
    }

    if ('penaltyExpires' in updates) {
      if (updates.penaltyExpires === null || updates.penaltyExpires === '') {
        unsetFields.penaltyExpires = '';
      } else {
        const penaltyDate = new Date(updates.penaltyExpires);
        if (Number.isNaN(penaltyDate.getTime())) {
          throw new Error('Invalid penaltyExpires value');
        }
        setFields.penaltyExpires = penaltyDate;
      }
    }

    if (updates.clearPenalty) {
      unsetFields.penaltyExpires = '';
      unsetFields.lastSpamStrike = '';
    }

    if (typeof updates.spamStrikes === 'number' && Number.isFinite(updates.spamStrikes)) {
      setFields.spamStrikes = Math.max(0, Math.floor(updates.spamStrikes));
    }

    if (typeof updates.adminNotes === 'string') {
      const trimmed = updates.adminNotes.trim();
      if (trimmed) {
        setFields.adminNotes = trimmed;
      } else {
        unsetFields.adminNotes = '';
      }
    }

    try {
      const db = await this.databaseService.getDatabase();
      const update = { $set: setFields };
      if (Object.keys(unsetFields).length > 0) {
        update.$unset = unsetFields;
      }

      const result = await db.collection('telegram_members').findOneAndUpdate(
        { channelId: String(channelId), userId: String(userId) },
        update,
        { returnDocument: 'after' }
      );

      const updated = result.value || null;
      if (updated) {
        this.cache.invalidateMember(String(channelId), String(userId));
        this.logger?.info?.(`[MemberManager] Updated member ${userId}`);
        return this.formatMemberRecord(updated);
      }

      return null;
    } catch (error) {
      this.logger?.error?.('[MemberManager] Failed to update member:', error);
      throw error;
    }
  }

  /**
   * Unban a member
   * @param {string} channelId - Channel ID
   * @param {string} userId - User ID
   * @param {Object} options - Unban options
   * @returns {Promise<Object|null>}
   */
  async unbanMember(channelId, userId, options = {}) {
    if (!this.databaseService) return null;

    const clearStrikes = options.clearStrikes !== false;
    const targetTrustLevel = typeof options.trustLevel === 'string' ? options.trustLevel.trim() : 'probation';

    try {
      const db = await this.databaseService.getDatabase();
      const update = {
        $set: {
          permanentlyBlacklisted: false,
          updatedAt: new Date(),
          trustLevel: ['new', 'probation', 'trusted', 'suspicious'].includes(targetTrustLevel)
            ? targetTrustLevel
            : 'probation',
        },
        $unset: {
          penaltyExpires: '',
          lastSpamStrike: '',
        },
      };

      if (clearStrikes) {
        update.$set.spamStrikes = 0;
      }

      const result = await db.collection('telegram_members').findOneAndUpdate(
        { channelId: String(channelId), userId: String(userId) },
        update,
        { returnDocument: 'after' }
      );

      const updated = result.value || null;
      if (updated) {
        this.cache.invalidateMember(String(channelId), String(userId));
        this.logger?.info?.(`[MemberManager] Unbanned member ${userId}`);
        return this.formatMemberRecord(updated);
      }

      return null;
    } catch (error) {
      this.logger?.error?.('[MemberManager] Failed to unban member:', error);
      throw error;
    }
  }

  /**
   * Get spam statistics for a channel
   * @param {string} channelId - Channel ID
   * @returns {Promise<Object|null>}
   */
  async getSpamStats(channelId) {
    if (!this.databaseService) return null;

    try {
      const db = await this.databaseService.getDatabase();
      const collection = db.collection('telegram_members');
      const channelFilter = { channelId: String(channelId) };
      const activeFilter = {
        channelId: String(channelId),
        $or: [{ leftAt: { $exists: false } }, { leftAt: null }],
      };
      const now = new Date();
      const lookback24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const [
        totalMembers,
        activeMembers,
        probationMembers,
        trustedMembers,
        blacklistedMembers,
        penalizedMembers,
        recentJoins,
        recentStrikes,
      ] = await Promise.all([
        collection.countDocuments(channelFilter),
        collection.countDocuments(activeFilter),
        collection.countDocuments({
          ...channelFilter,
          trustLevel: { $in: ['new', 'probation'] },
          permanentlyBlacklisted: { $ne: true },
        }),
        collection.countDocuments({
          ...channelFilter,
          trustLevel: 'trusted',
          permanentlyBlacklisted: { $ne: true },
        }),
        collection.countDocuments({ ...channelFilter, permanentlyBlacklisted: true }),
        collection.countDocuments({ ...channelFilter, penaltyExpires: { $gt: now } }),
        collection.countDocuments({ ...channelFilter, joinedAt: { $gt: lookback24h } }),
        collection.countDocuments({ ...channelFilter, lastSpamStrike: { $gt: lookback24h } }),
      ]);

      return {
        channelId: String(channelId),
        totals: {
          totalMembers,
          activeMembers,
          probationMembers,
          trustedMembers,
          blacklistedMembers,
          penalizedMembers,
        },
        recent24h: {
          joins: recentJoins,
          spamStrikes: recentStrikes,
        },
        generatedAt: now,
      };
    } catch (error) {
      this.logger?.error?.('[MemberManager] Failed to get spam stats:', error);
      throw error;
    }
  }
}

export default MemberManager;
