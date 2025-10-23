/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * ChannelSummaryService
 * 
 * Unified service for aggregating and managing channel summaries across all platforms
 * (Discord, Telegram, X/Twitter). Provides a single source of truth for what's happening
 * in the CosyWorld community conversations.
 * 
 * Summaries are used as the primary context source for story generation instead of raw events.
 */
export class ChannelSummaryService {
  constructor({ databaseService, conversationManager, logger }) {
    this.databaseService = databaseService;
    this.conversationManager = conversationManager;
    this.logger = logger || console;
  }

  async _db() {
    return await this.databaseService.getDatabase();
  }

  // ============================================================================
  // Channel Summary Management
  // ============================================================================

  /**
   * Get or create a unified channel summary for a specific platform and channel
   * @param {string} platform - 'discord', 'telegram', or 'x'
   * @param {string} channelId - Platform-specific channel ID
   * @param {string} channelName - Human-readable channel name
   * @returns {Promise<Object>} Channel summary object
   */
  async getChannelSummary(platform, channelId, channelName = null) {
    const db = await this._db();
    const summaries = db.collection('unified_channel_summaries');
    
    const compositeId = `${platform}:${channelId}`;
    let summary = await summaries.findOne({ compositeId });
    
    if (!summary) {
      // Create new summary entry
      summary = {
        compositeId,
        platform,
        channelId,
        channelName,
        summary: '',
        lastUpdated: new Date(),
        messageCount: 0,
        activeAvatarIds: [],
        topics: [],
        sentiment: 'neutral',
        createdAt: new Date()
      };
      await summaries.insertOne(summary);
      this.logger.info(`[ChannelSummary] Created new summary for ${compositeId}`);
    }
    
    return summary;
  }

  /**
   * Update a channel summary using the conversation manager
   * @param {string} platform - 'discord', 'telegram', or 'x'
   * @param {string} channelId - Platform-specific channel ID
   * @param {Object} options - Update options
   * @returns {Promise<Object>} Updated summary
   */
  async updateChannelSummary(platform, channelId, options = {}) {
    try {
      const {
        avatarId = null,
        forceRefresh = false,
        channelName = null
      } = options;
      
      const db = await this._db();
      const summaries = db.collection('unified_channel_summaries');
      const compositeId = `${platform}:${channelId}`;
      
      // Get existing summary or create new one
      let existing = await this.getChannelSummary(platform, channelId, channelName);
      
      // Check if refresh needed
      const hoursSinceUpdate = (Date.now() - existing.lastUpdated.getTime()) / (1000 * 60 * 60);
      if (!forceRefresh && hoursSinceUpdate < 1) {
        this.logger.debug(`[ChannelSummary] Skipping ${compositeId}, updated ${Math.round(hoursSinceUpdate * 60)}m ago`);
        return existing;
      }
      
      // Get fresh summary from conversation manager
      let newSummaryText = '';
      let activeAvatarIds = [];
      
      if (this.conversationManager && avatarId) {
        try {
          newSummaryText = await this.conversationManager.getChannelSummary(avatarId, channelId);
          this.logger.info(`[ChannelSummary] Generated summary for ${compositeId} via avatar ${avatarId}`);
        } catch (error) {
          this.logger.warn(`[ChannelSummary] Failed to generate summary via conversation manager:`, error.message);
          newSummaryText = existing.summary || 'No recent activity';
        }
      } else {
        // Fallback: Get recent messages directly
        const messages = await db.collection('messages')
          .find({ channelId, platform })
          .sort({ timestamp: -1 })
          .limit(50)
          .toArray();
        
        if (messages.length > 0) {
          activeAvatarIds = [...new Set(messages.map(m => m.avatarId?.toString()).filter(Boolean))];
          newSummaryText = `Recent activity in this channel (${messages.length} messages from ${activeAvatarIds.length} avatars)`;
        } else {
          newSummaryText = 'No recent activity';
        }
      }
      
      // Get active avatars from recent presence
      if (activeAvatarIds.length === 0) {
        const presence = await db.collection('presence')
          .find({ 
            channelId,
            lastActiveAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // Last 7 days
          })
          .toArray();
        activeAvatarIds = presence.map(p => p.avatarId.toString());
      }
      
      // Get message count
      const messageCount = await db.collection('messages')
        .countDocuments({ channelId, platform });
      
      // Update summary
      const updated = {
        $set: {
          summary: newSummaryText,
          lastUpdated: new Date(),
          messageCount,
          activeAvatarIds: [...new Set(activeAvatarIds)],
          channelName: channelName || existing.channelName
        }
      };
      
      await summaries.updateOne({ compositeId }, updated);
      
      this.logger.info(`[ChannelSummary] Updated ${compositeId}: ${activeAvatarIds.length} active avatars, ${messageCount} total messages`);
      
      return await summaries.findOne({ compositeId });
      
    } catch (error) {
      this.logger.error(`[ChannelSummary] Error updating ${platform}:${channelId}:`, error);
      throw error;
    }
  }

  /**
   * Get all channel summaries, optionally filtered by platform
   * @param {string} platform - Optional platform filter
   * @param {number} limit - Maximum number of summaries
   * @returns {Promise<Array>} Channel summaries
   */
  async getAllChannelSummaries(platform = null, limit = 100) {
    const db = await this._db();
    const summaries = db.collection('unified_channel_summaries');
    
    const filter = platform ? { platform } : {};
    
    return await summaries
      .find(filter)
      .sort({ lastUpdated: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Get recently active channel summaries
   * @param {number} hours - Consider channels active within this many hours
   * @param {number} limit - Maximum number of summaries
   * @returns {Promise<Array>}
   */
  async getRecentlyActiveChannels(hours = 24, limit = 50) {
    const db = await this._db();
    const summaries = db.collection('unified_channel_summaries');
    
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    return await summaries
      .find({
        lastUpdated: { $gte: cutoff },
        messageCount: { $gt: 0 }
      })
      .sort({ lastUpdated: -1 })
      .limit(limit)
      .toArray();
  }

  // ============================================================================
  // Meta-Summary Generation (Summarize the Summaries)
  // ============================================================================

  /**
   * Generate a meta-summary from all channel summaries
   * This provides a high-level view of what's happening across all of CosyWorld
   * @param {Object} aiService - AI service for generating meta-summary
   * @param {Object} options - Options
   * @returns {Promise<Object>} Meta-summary with key themes, active locations, avatars
   */
  async generateMetaSummary(aiService, options = {}) {
    try {
      const {
        hoursOfActivity = 24,
        maxChannels = 20,
        includeAvatars = true,
        includeLocations = true
      } = options;
      
      const db = await this._db();
      
      // Get recent channel summaries
      const channelSummaries = await this.getRecentlyActiveChannels(hoursOfActivity, maxChannels);
      
      if (channelSummaries.length === 0) {
        return {
          summary: 'CosyWorld is quiet at the moment, with no recent activity across channels.',
          channels: [],
          activeAvatarIds: [],
          keyThemes: [],
          timestamp: new Date()
        };
      }
      
      // Collect all active avatar IDs
      const allActiveAvatarIds = [...new Set(
        channelSummaries.flatMap(cs => cs.activeAvatarIds || [])
      )];
      
      // Get avatar details
      let avatars = [];
      if (includeAvatars && allActiveAvatarIds.length > 0) {
        const { ObjectId } = await import('mongodb');
        const objectIds = allActiveAvatarIds
          .filter(id => id && ObjectId.isValid(id))
          .map(id => new ObjectId(id));
        
        avatars = await db.collection('avatars')
          .find({ _id: { $in: objectIds } })
          .toArray();
      }
      
      // Get locations mentioned in channels
      let locations = [];
      if (includeLocations) {
        locations = await db.collection('locations')
          .find({})
          .limit(10)
          .toArray();
      }
      
      // Build context for AI
      let contextPrompt = '=== COSYWORLD CHANNEL SUMMARIES ===\n\n';
      contextPrompt += `Time period: Last ${hoursOfActivity} hours\n`;
      contextPrompt += `Active channels: ${channelSummaries.length}\n`;
      contextPrompt += `Active avatars: ${allActiveAvatarIds.length}\n\n`;
      
      contextPrompt += '--- CHANNEL ACTIVITY ---\n';
      for (const cs of channelSummaries.slice(0, 15)) {
        contextPrompt += `${cs.platform}/${cs.channelName || cs.channelId}:\n`;
        contextPrompt += `  ${cs.summary}\n`;
        contextPrompt += `  (${cs.activeAvatarIds?.length || 0} active avatars, ${cs.messageCount} total messages)\n\n`;
      }
      
      if (avatars.length > 0) {
        contextPrompt += '--- ACTIVE AVATARS ---\n';
        for (const avatar of avatars.slice(0, 20)) {
          contextPrompt += `• ${avatar.name} ${avatar.emoji || ''}: ${avatar.description || 'A resident of CosyWorld'}\n`;
        }
        contextPrompt += '\n';
      }
      
      if (locations.length > 0) {
        contextPrompt += '--- KNOWN LOCATIONS ---\n';
        for (const loc of locations) {
          contextPrompt += `• ${loc.name}: ${loc.description || 'A place in CosyWorld'}\n`;
        }
        contextPrompt += '\n';
      }
      
      // Generate meta-summary with AI
      const aiPrompt = `${contextPrompt}

Based on the channel summaries above, create a concise meta-summary (200-300 words) that captures:
1. The overall mood and atmosphere of CosyWorld right now
2. Key themes and topics being discussed
3. Notable character interactions or developments
4. Any emerging conflicts, celebrations, or story opportunities

Write in a narrative style that would help a storyteller understand the current state of the world.`;

      let metaSummaryText = '';
      let keyThemes = [];
      
      if (aiService) {
        try {
          const response = await aiService.chat([
            { role: 'user', content: aiPrompt }
          ], {
            model: 'anthropic/claude-sonnet-4',
            max_tokens: 500,
            temperature: 0.7
          });
          
          metaSummaryText = String(response?.text || response || '').trim();
          
          // Extract themes (simple keyword extraction for now)
          const themePrompt = `From this summary, list 3-5 key themes as single words or short phrases (comma-separated):\n\n${metaSummaryText}`;
          const themeResponse = await aiService.chat([
            { role: 'user', content: themePrompt }
          ], {
            model: 'anthropic/claude-haiku-4',
            max_tokens: 100,
            temperature: 0.5
          });
          
          keyThemes = String(themeResponse?.text || themeResponse || '')
            .split(',')
            .map(t => t.trim())
            .filter(Boolean);
          
        } catch (error) {
          this.logger.warn('[ChannelSummary] Failed to generate AI meta-summary:', error.message);
          metaSummaryText = `CosyWorld is bustling with activity across ${channelSummaries.length} channels, with ${allActiveAvatarIds.length} avatars engaged in various conversations and activities.`;
        }
      } else {
        metaSummaryText = `CosyWorld is active across ${channelSummaries.length} channels with ${allActiveAvatarIds.length} avatars participating.`;
      }
      
      return {
        summary: metaSummaryText,
        channels: channelSummaries.map(cs => ({
          compositeId: cs.compositeId,
          platform: cs.platform,
          channelId: cs.channelId,
          channelName: cs.channelName,
          avatarCount: cs.activeAvatarIds?.length || 0
        })),
        activeAvatarIds: allActiveAvatarIds,
        avatars: avatars.map(a => ({
          id: a._id,
          name: a.name,
          emoji: a.emoji,
          description: a.description
        })),
        locations: locations.map(l => ({
          id: l._id,
          name: l.name,
          description: l.description
        })),
        keyThemes,
        timestamp: new Date()
      };
      
    } catch (error) {
      this.logger.error('[ChannelSummary] Error generating meta-summary:', error);
      throw error;
    }
  }

  /**
   * Refresh all channel summaries
   * Should be called periodically (e.g., every hour)
   * @param {Object} options - Refresh options
   * @returns {Promise<Object>} Refresh statistics
   */
  async refreshAllSummaries(options = {}) {
    try {
      const {
        platforms = ['discord', 'telegram', 'x'],
        maxAge = 1 // Hours
      } = options;
      
      const db = await this._db();
      const summaries = db.collection('unified_channel_summaries');
      
      const cutoff = new Date(Date.now() - maxAge * 60 * 60 * 1000);
      const stale = await summaries.find({
        platform: { $in: platforms },
        lastUpdated: { $lt: cutoff }
      }).toArray();
      
      this.logger.info(`[ChannelSummary] Refreshing ${stale.length} stale summaries...`);
      
      let updated = 0;
      let failed = 0;
      
      for (const summary of stale) {
        try {
          // Try to get a representative avatar for this channel
          const presence = await db.collection('presence')
            .findOne({ channelId: summary.channelId });
          
          const avatarId = presence?.avatarId;
          
          await this.updateChannelSummary(
            summary.platform,
            summary.channelId,
            { avatarId, forceRefresh: true, channelName: summary.channelName }
          );
          updated++;
        } catch (error) {
          this.logger.error(`[ChannelSummary] Failed to refresh ${summary.compositeId}:`, error.message);
          failed++;
        }
      }
      
      this.logger.info(`[ChannelSummary] Refresh complete: ${updated} updated, ${failed} failed`);
      
      return { total: stale.length, updated, failed };
      
    } catch (error) {
      this.logger.error('[ChannelSummary] Error refreshing summaries:', error);
      throw error;
    }
  }
}

export default ChannelSummaryService;
