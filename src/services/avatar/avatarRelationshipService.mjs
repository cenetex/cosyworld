/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * AvatarRelationshipService - Manages avatar-to-avatar relationships
 * 
 * Tracks trading history, conversations, and builds relationship summaries
 * with sentiment analysis and key memories
 */

/**
 * @typedef {Object} RelationshipMemory
 * @property {string} type - Type of memory (trade, conversation, milestone)
 * @property {string} description - Description of the memory
 * @property {Date} timestamp - When this memory occurred
 * @property {number} importance - Importance score (0-10)
 */

/**
 * @typedef {Object} TradeRecord
 * @property {string} tokenSymbol - Token traded
 * @property {number} amount - Amount traded
 * @property {number} usdValue - USD value at time of trade
 * @property {string} type - Trade type (swap, transfer)
 * @property {string} direction - Direction (sent, received)
 * @property {Date} timestamp - When trade occurred
 * @property {string} txSignature - Transaction signature
 */

/**
 * @typedef {Object} ConversationRecord
 * @property {string} messageId - Discord/Telegram message ID
 * @property {string} content - Message content (truncated)
 * @property {string} context - Brief context of conversation
 * @property {string} sentiment - Detected sentiment (positive, neutral, negative)
 * @property {Date} timestamp - When conversation occurred
 */

/**
 * @typedef {Object} AvatarRelationship
 * @property {ObjectId} avatarId - Primary avatar ID
 * @property {ObjectId} relatedAvatarId - Related avatar ID
 * @property {string} avatarName - Primary avatar name (cached)
 * @property {string} relatedAvatarName - Related avatar name (cached)
 * @property {string} summary - LLM-generated relationship summary
 * @property {number} sentimentScore - Overall sentiment (-1 to 1)
 * @property {string} relationshipType - Type (trading_partner, friend, rival, etc)
 * @property {Array<RelationshipMemory>} keyMemories - Top 3 key memories
 * @property {Array<TradeRecord>} recentTrades - Last 10 trades
 * @property {Array<ConversationRecord>} recentConversations - Last 10 conversations
 * @property {Object} stats - Aggregate statistics
 * @property {Date} firstInteraction - When they first interacted
 * @property {Date} lastInteraction - Most recent interaction
 * @property {Date} lastSummaryUpdate - When summary was last regenerated
 * @property {number} interactionCount - Total interactions
 */

export class AvatarRelationshipService {
  constructor({ logger, databaseService, configService }) {
    this.logger = logger || console;
    this.databaseService = databaseService;
    this.configService = configService;
    
    this.db = null;
    this.RELATIONSHIPS_COLLECTION = 'avatar_relationships';

  this.initialized = false;
  this.initializingPromise = null;
  this.indexesEnsured = false;
    
    // Summary regeneration threshold (7 days)
    this.SUMMARY_UPDATE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;
    
    // Maximum items to keep in recent arrays
    this.MAX_RECENT_TRADES = 10;
    this.MAX_RECENT_CONVERSATIONS = 10;
    this.MAX_KEY_MEMORIES = 3;
  }

  async ensureInitialized() {
    if (this.initialized && this.db) {
      return;
    }

    if (this.initializingPromise) {
      await this.initializingPromise;
      return;
    }

    this.initializingPromise = (async () => {
      try {
        if (!this.db) {
          this.db = await this.databaseService.getDatabase();
        }
        await this.ensureIndexes();
        this.initialized = true;
      } catch (err) {
        this.logger.error('[AvatarRelationshipService] Failed to initialize database connection:', err);
        throw err;
      } finally {
        this.initializingPromise = null;
      }
    })();

    await this.initializingPromise;
  }

  /**
   * Initialize the service
   */
  async initialize() {
    try {
      await this.ensureInitialized();
      this.logger.info('[AvatarRelationshipService] Initialized successfully');
    } catch (error) {
      this.logger.error('[AvatarRelationshipService] Initialization failed:', error);
    }
  }

  /**
   * Create database indexes
   */
  async ensureIndexes() {
    if (this.indexesEnsured && this.db) {
      return;
    }

    try {
      await this.db.collection(this.RELATIONSHIPS_COLLECTION).createIndexes([
        { 
          key: { avatarId: 1, relatedAvatarId: 1 }, 
          unique: true, 
          name: 'avatar_relationship' 
        },
        { key: { avatarId: 1, lastInteraction: -1 }, name: 'avatar_recent' },
        { key: { relatedAvatarId: 1, lastInteraction: -1 }, name: 'related_recent' },
        { key: { lastInteraction: -1 }, name: 'recent_interactions' },
      ]);
      
      this.logger.info('[AvatarRelationshipService] Database indexes created');
      this.indexesEnsured = true;
    } catch (error) {
      this.logger.error('[AvatarRelationshipService] Failed to create indexes:', error);
    }
  }

  /**
   * Record a trade between two avatars
   * @param {Object} params - Trade parameters
   * @param {string} params.avatar1Id - First avatar ID
   * @param {string} params.avatar1Name - First avatar name
   * @param {string} params.avatar2Id - Second avatar ID
   * @param {string} params.avatar2Name - Second avatar name
   * @param {string} params.tokenSymbol - Token symbol
   * @param {number} params.amount - Amount traded
   * @param {number} params.usdValue - USD value
   * @param {string} params.tradeType - Trade type (swap, transfer)
   * @param {string} params.direction - Direction from avatar1 perspective (sent/received)
   * @param {string} params.txSignature - Transaction signature
   */
  async recordTrade(params) {
    try {
      await this.ensureInitialized();

      const {
        avatar1Id,
        avatar1Name,
        avatar2Id,
        avatar2Name,
        tokenSymbol,
        amount,
        usdValue,
        tradeType,
        direction,
        txSignature
      } = params;

      const tradeRecord = {
        tokenSymbol,
        amount,
        usdValue,
        type: tradeType,
        direction, // 'sent' or 'received' from avatar1's perspective
        timestamp: new Date(),
        txSignature
      };

      // Update relationship from avatar1's perspective
      await this.updateRelationship(avatar1Id, avatar1Name, avatar2Id, avatar2Name, {
        trade: tradeRecord
      });

      // Update relationship from avatar2's perspective (reverse direction)
      const reverseDirection = direction === 'sent' ? 'received' : 'sent';
      await this.updateRelationship(avatar2Id, avatar2Name, avatar1Id, avatar1Name, {
        trade: { ...tradeRecord, direction: reverseDirection }
      });

      this.logger.info(`[AvatarRelationshipService] Recorded trade between ${avatar1Name} and ${avatar2Name}: ${amount} ${tokenSymbol}`);
    } catch (error) {
      this.logger.error('[AvatarRelationshipService] Failed to record trade:', error);
    }
  }

  /**
   * Record a conversation between two avatars
   * @param {Object} params - Conversation parameters
   * @param {string} params.avatar1Id - First avatar ID
   * @param {string} params.avatar1Name - First avatar name
   * @param {string} params.avatar2Id - Second avatar ID
   * @param {string} params.avatar2Name - Second avatar name
   * @param {string} params.messageId - Message ID
   * @param {string} params.content - Message content
   * @param {string} params.context - Conversation context
   * @param {string} params.sentiment - Detected sentiment
   */
  async recordConversation(params) {
    try {
      await this.ensureInitialized();

      const {
        avatar1Id,
        avatar1Name,
        avatar2Id,
        avatar2Name,
        messageId,
        content,
        context,
        sentiment
      } = params;

      const conversationRecord = {
        messageId,
        content: content.substring(0, 200), // Truncate for storage
        context,
        sentiment: sentiment || 'neutral',
        timestamp: new Date()
      };

      // Update both relationships
      await this.updateRelationship(avatar1Id, avatar1Name, avatar2Id, avatar2Name, {
        conversation: conversationRecord
      });

      await this.updateRelationship(avatar2Id, avatar2Name, avatar1Id, avatar1Name, {
        conversation: conversationRecord
      });

      this.logger.debug(`[AvatarRelationshipService] Recorded conversation between ${avatar1Name} and ${avatar2Name}`);
    } catch (error) {
      this.logger.error('[AvatarRelationshipService] Failed to record conversation:', error);
    }
  }

  /**
   * Update or create a relationship
   * @param {string} avatarId - Primary avatar ID
   * @param {string} avatarName - Primary avatar name
   * @param {string} relatedAvatarId - Related avatar ID
   * @param {string} relatedAvatarName - Related avatar name
   * @param {Object} update - Update data (trade or conversation)
   */
  async updateRelationship(avatarId, avatarName, relatedAvatarId, relatedAvatarName, update) {
    try {
      await this.ensureInitialized();
      const now = new Date();
      
      const existingRelationship = await this.db.collection(this.RELATIONSHIPS_COLLECTION).findOne({
        avatarId,
        relatedAvatarId
      });

      if (!existingRelationship) {
        // Create new relationship
        const newRelationship = {
          avatarId,
          relatedAvatarId,
          avatarName,
          relatedAvatarName,
          summary: null,
          sentimentScore: 0,
          relationshipType: 'acquaintance',
          keyMemories: [],
          recentTrades: update.trade ? [update.trade] : [],
          recentConversations: update.conversation ? [update.conversation] : [],
          stats: {
            totalTrades: update.trade ? 1 : 0,
            totalConversations: update.conversation ? 1 : 0,
            totalVolumeUsd: update.trade?.usdValue || 0,
            tokensTraded: update.trade ? { [update.trade.tokenSymbol]: update.trade.amount } : {}
          },
          firstInteraction: now,
          lastInteraction: now,
          lastSummaryUpdate: null,
          interactionCount: 1
        };

        await this.db.collection(this.RELATIONSHIPS_COLLECTION).insertOne(newRelationship);
        this.logger.info(`[AvatarRelationshipService] Created new relationship: ${avatarName} -> ${relatedAvatarName}`);
      } else {
        // Update existing relationship
        const updateOps = {
          $set: {
            avatarName, // Update cached names in case they changed
            relatedAvatarName,
            lastInteraction: now
          },
          $inc: {
            interactionCount: 1
          }
        };

        if (update.trade) {
          // Add to recent trades (keep last N)
          updateOps.$push = {
            recentTrades: {
              $each: [update.trade],
              $position: 0,
              $slice: this.MAX_RECENT_TRADES
            }
          };
          updateOps.$inc['stats.totalTrades'] = 1;
          updateOps.$inc['stats.totalVolumeUsd'] = update.trade.usdValue || 0;
          updateOps.$inc[`stats.tokensTraded.${update.trade.tokenSymbol}`] = update.trade.amount;
        }

        if (update.conversation) {
          // Add to recent conversations (keep last N)
          updateOps.$push = {
            ...updateOps.$push,
            recentConversations: {
              $each: [update.conversation],
              $position: 0,
              $slice: this.MAX_RECENT_CONVERSATIONS
            }
          };
          updateOps.$inc['stats.totalConversations'] = 1;
        }

        await this.db.collection(this.RELATIONSHIPS_COLLECTION).updateOne(
          { avatarId, relatedAvatarId },
          updateOps
        );

        // Check if summary needs updating (after significant interactions or time passed)
        const needsSummaryUpdate = this.shouldUpdateSummary(existingRelationship);
        if (needsSummaryUpdate) {
          // Queue summary update (don't block current operation)
          this.queueSummaryUpdate(avatarId, relatedAvatarId).catch(err => {
            this.logger.error('[AvatarRelationshipService] Failed to queue summary update:', err);
          });
        }
      }
    } catch (error) {
      this.logger.error('[AvatarRelationshipService] Failed to update relationship:', error);
    }
  }

  /**
   * Check if relationship summary should be updated
   * @param {Object} relationship - Relationship document
   * @returns {boolean}
   */
  shouldUpdateSummary(relationship) {
    // Update if no summary exists
    if (!relationship.summary || !relationship.lastSummaryUpdate) {
      return relationship.interactionCount >= 3; // Wait for at least 3 interactions
    }

    // Update if enough time has passed
    const timeSinceUpdate = Date.now() - new Date(relationship.lastSummaryUpdate).getTime();
    if (timeSinceUpdate > this.SUMMARY_UPDATE_THRESHOLD_MS) {
      return true;
    }

    // Update after significant interaction count increase
    const interactionsSinceUpdate = relationship.interactionCount - (relationship._lastSummaryInteractionCount || 0);
    if (interactionsSinceUpdate >= 10) {
      return true;
    }

    return false;
  }

  /**
   * Queue a summary update (async, non-blocking)
   * @param {string} avatarId - Avatar ID
   * @param {string} relatedAvatarId - Related avatar ID
   */
  async queueSummaryUpdate(avatarId, relatedAvatarId) {
    // Use setImmediate to avoid blocking
    setImmediate(async () => {
      try {
        await this.generateRelationshipSummary(avatarId, relatedAvatarId);
      } catch (error) {
        this.logger.error('[AvatarRelationshipService] Failed to generate summary:', error);
      }
    });
  }

  /**
   * Generate relationship summary using LLM
   * @param {string} avatarId - Avatar ID
   * @param {string} relatedAvatarId - Related avatar ID
   */
  async generateRelationshipSummary(avatarId, relatedAvatarId) {
    try {
      await this.ensureInitialized();
      const relationship = await this.db.collection(this.RELATIONSHIPS_COLLECTION).findOne({
        avatarId,
        relatedAvatarId
      });

      if (!relationship) {
        this.logger.warn(`[AvatarRelationshipService] Relationship not found for summary generation`);
        return;
      }

      this.logger.info(`[AvatarRelationshipService] Generating summary for ${relationship.avatarName} -> ${relationship.relatedAvatarName}`);

      // Build context for LLM
      const context = this.buildRelationshipContext(relationship);

      // Get LLM service
      const llmService = this.configService?.services?.llmService;
      if (!llmService) {
        this.logger.warn('[AvatarRelationshipService] LLM service not available for summary generation');
        return;
      }

      // Generate summary with structured output
      const prompt = this.buildSummaryPrompt(context);
      
      const response = await llmService.generateResponse({
        prompt,
        systemPrompt: 'You are an AI assistant that analyzes relationships between avatars in a trading community. Provide concise, insightful summaries.',
        temperature: 0.7,
        maxTokens: 500
      });

      if (response && response.text) {
        // Parse the structured response
        const analysis = this.parseRelationshipAnalysis(response.text);

        // Update relationship with new summary
        await this.db.collection(this.RELATIONSHIPS_COLLECTION).updateOne(
          { avatarId, relatedAvatarId },
          {
            $set: {
              summary: analysis.summary,
              sentimentScore: analysis.sentimentScore,
              relationshipType: analysis.relationshipType,
              keyMemories: analysis.keyMemories,
              lastSummaryUpdate: new Date(),
              _lastSummaryInteractionCount: relationship.interactionCount
            }
          }
        );

        this.logger.info(`[AvatarRelationshipService] Generated summary for ${relationship.avatarName} -> ${relationship.relatedAvatarName}`);
      }
    } catch (error) {
      this.logger.error('[AvatarRelationshipService] Failed to generate relationship summary:', error);
    }
  }

  /**
   * Build context for relationship summary
   * @param {Object} relationship - Relationship document
   * @returns {Object}
   */
  buildRelationshipContext(relationship) {
    const { 
      avatarName, 
      relatedAvatarName, 
      recentTrades, 
      recentConversations, 
      stats,
      firstInteraction,
      lastInteraction,
      interactionCount
    } = relationship;

    // Calculate time span
    const daysTogether = Math.floor((new Date(lastInteraction) - new Date(firstInteraction)) / (1000 * 60 * 60 * 24));

    // Summarize trades
    const tradesSummary = recentTrades.map(t => 
      `${t.direction === 'sent' ? 'Sent' : 'Received'} ${this.formatAmount(t.amount)} ${t.tokenSymbol} ${t.usdValue ? `($${t.usdValue.toFixed(2)})` : ''}`
    ).join('; ');

    // Summarize conversations
    const conversationsSummary = recentConversations.map(c =>
      `[${c.sentiment}] ${c.context || c.content}`
    ).join('; ');

    return {
      avatarName,
      relatedAvatarName,
      daysTogether,
      interactionCount,
      totalTrades: stats.totalTrades,
      totalConversations: stats.totalConversations,
      totalVolumeUsd: stats.totalVolumeUsd,
      tokensTraded: stats.tokensTraded,
      recentTrades: tradesSummary,
      recentConversations: conversationsSummary
    };
  }

  /**
   * Build prompt for LLM summary generation
   * @param {Object} context - Relationship context
   * @returns {string}
   */
  buildSummaryPrompt(context) {
    return `Analyze the relationship between two avatars and provide a structured analysis.

Avatar 1: ${context.avatarName}
Avatar 2: ${context.relatedAvatarName}

Relationship Data:
- Known each other for: ${context.daysTogether} days
- Total interactions: ${context.interactionCount}
- Total trades: ${context.totalTrades}
- Total conversations: ${context.totalConversations}
- Trading volume: $${context.totalVolumeUsd.toFixed(2)}
- Tokens traded: ${JSON.stringify(context.tokensTraded)}

Recent Trades (last 10):
${context.recentTrades || 'None'}

Recent Conversations (last 10):
${context.recentConversations || 'None'}

Please provide:
1. A 2-3 sentence summary of their relationship from ${context.avatarName}'s perspective
2. A sentiment score from -1 (negative) to 1 (positive)
3. A relationship type (trading_partner, friend, rival, mentor, competitor, casual_acquaintance)
4. Three key memories (most important moments in their relationship)

Format your response as JSON:
{
  "summary": "Your 2-3 sentence summary here",
  "sentimentScore": 0.5,
  "relationshipType": "friend",
  "keyMemories": [
    {"type": "trade", "description": "First big trade together", "importance": 9},
    {"type": "conversation", "description": "Discussed market strategy", "importance": 7},
    {"type": "milestone", "description": "Celebrated reaching 100K volume", "importance": 8}
  ]
}`;
  }

  /**
   * Parse LLM response into structured format
   * @param {string} text - LLM response text
   * @returns {Object}
   */
  parseRelationshipAnalysis(text) {
    try {
      // Try to extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          summary: parsed.summary || 'No summary available',
          sentimentScore: parsed.sentimentScore || 0,
          relationshipType: parsed.relationshipType || 'acquaintance',
          keyMemories: (parsed.keyMemories || []).slice(0, this.MAX_KEY_MEMORIES).map(m => ({
            ...m,
            timestamp: new Date()
          }))
        };
      }
    } catch (error) {
      this.logger.warn('[AvatarRelationshipService] Failed to parse JSON response, using text as summary', error);
    }

    // Fallback to text-based summary
    return {
      summary: text.substring(0, 500),
      sentimentScore: 0,
      relationshipType: 'acquaintance',
      keyMemories: []
    };
  }

  /**
   * Get relationship context for avatar interaction
   * @param {string} avatarId - Primary avatar ID
   * @param {string} relatedAvatarId - Related avatar ID
   * @returns {Promise<string|null>} Formatted relationship context
   */
  async getRelationshipContext(avatarId, relatedAvatarId) {
    try {
      await this.ensureInitialized();
      const relationship = await this.db.collection(this.RELATIONSHIPS_COLLECTION).findOne({
        avatarId,
        relatedAvatarId
      });

      if (!relationship) {
        return null;
      }

      // Build formatted context string
      const parts = [];

      // Summary
      if (relationship.summary) {
        parts.push(`${relationship.relatedAvatarName} Summary: ${relationship.summary}`);
      } else {
        parts.push(`${relationship.relatedAvatarName}: You've interacted ${relationship.interactionCount} times`);
      }

      // Key memories
      if (relationship.keyMemories && relationship.keyMemories.length > 0) {
        parts.push('\nKey Memories:');
        relationship.keyMemories.forEach((memory, idx) => {
          parts.push(`${idx + 1}. ${memory.description}`);
        });
      }

      // Most recent interaction
      const mostRecentConversation = relationship.recentConversations?.[0];
      const mostRecentTrade = relationship.recentTrades?.[0];

      if (mostRecentConversation || mostRecentTrade) {
        parts.push('\nMost Recent Interaction:');
        
        if (mostRecentConversation && (!mostRecentTrade || 
            new Date(mostRecentConversation.timestamp) > new Date(mostRecentTrade.timestamp))) {
          const timeAgo = this.formatTimeAgo(mostRecentConversation.timestamp);
          parts.push(`Conversation ${timeAgo}: ${mostRecentConversation.context || mostRecentConversation.content}`);
        } else if (mostRecentTrade) {
          const timeAgo = this.formatTimeAgo(mostRecentTrade.timestamp);
          parts.push(`Trade ${timeAgo}: ${mostRecentTrade.direction === 'sent' ? 'Sent' : 'Received'} ${this.formatAmount(mostRecentTrade.amount)} ${mostRecentTrade.tokenSymbol}`);
        }
      }

      return parts.join('\n');
    } catch (error) {
      this.logger.error('[AvatarRelationshipService] Failed to get relationship context:', error);
      return null;
    }
  }

  /**
   * Get all relationships for an avatar
   * @param {string} avatarId - Avatar ID
   * @param {number} limit - Maximum number to return
   * @returns {Promise<Array>}
   */
  async getAvatarRelationships(avatarId, limit = 10) {
    try {
      await this.ensureInitialized();
      return await this.db.collection(this.RELATIONSHIPS_COLLECTION)
        .find({ avatarId })
        .sort({ lastInteraction: -1 })
        .limit(limit)
        .toArray();
    } catch (err) {
      this.logger.error('[AvatarRelationshipService] Failed to get avatar relationships:', err);
      return [];
    }
  }

  /**
   * Format amount for display
   * @param {number} amount - Amount to format
   * @returns {string}
   */
  formatAmount(amount) {
    if (amount >= 1e9) return `${(amount / 1e9).toFixed(2)}B`;
    if (amount >= 1e6) return `${(amount / 1e6).toFixed(2)}M`;
    if (amount >= 1e3) return `${(amount / 1e3).toFixed(2)}K`;
    return amount.toFixed(2);
  }

  /**
   * Format time ago
   * @param {Date} date - Date to format
   * @returns {string}
   */
  formatTimeAgo(date) {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
    return `${Math.floor(seconds / 604800)} weeks ago`;
  }
}

export default AvatarRelationshipService;
