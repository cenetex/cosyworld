/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Telegram Conversation Manager
 * Handles message history, persistence, and active conversation tracking
 */

import { CONVERSATION_CONFIG } from './constants.mjs';

export class ConversationManager {
  constructor({ logger, databaseService, cacheManager }) {
    this.logger = logger;
    this.databaseService = databaseService;
    this.cache = cacheManager;
    
    // Configuration
    this.HISTORY_LIMIT = CONVERSATION_CONFIG.HISTORY_LIMIT;
    this.ACTIVE_CONVERSATION_WINDOW_MS = CONVERSATION_CONFIG.ACTIVE_WINDOW_MS;
    
    // Cache references (backwards compatibility or direct access)
    this.conversationHistory = this.cache.conversationHistory;
    this.activeConversations = this.cache.activeConversations;
    this.pendingReplies = this.cache.pendingReplies;
  }

  /**
   * Save a message to the database for persistence
   * @param {string} channelId
   * @param {Object} message
   */
  async saveMessageToDatabase(channelId, message) {
    try {
      const db = await this.databaseService.getDatabase();
      const asDate = message.date instanceof Date
        ? message.date
        : (typeof message.date === 'number'
          ? new Date(message.date * 1000)
          : new Date());
          
      await db.collection('telegram_messages').insertOne({
        channelId: String(channelId),
        from: message.from,
        text: message.text,
        date: asDate,
        userId: message.userId || null,
        isBot: message.isBot || false,
        createdAt: new Date()
      });
      this.logger?.debug?.(`[ConversationManager] Saved message to database for channel ${channelId}`);
    } catch (error) {
      this.logger?.error?.(`[ConversationManager] Failed to save message to database:`, error);
    }
  }

  /**
   * Load conversation history from database for a channel
   * @param {string} channelId
   * @returns {Promise<Array>}
   */
  async loadConversationHistory(channelId) {
    const normalizedChannelId = String(channelId);
    try {
      const db = await this.databaseService.getDatabase();
      const messages = await db.collection('telegram_messages')
        .find({ channelId: normalizedChannelId })
        .sort({ date: -1 })
        .limit(this.HISTORY_LIMIT)
        .toArray();
      
      // Reverse to get chronological order (oldest first)
      const history = messages.reverse().map(msg => ({
        from: msg.isBot ? 'Bot' : msg.from,
        text: msg.text,
        date: msg.date instanceof Date ? Math.floor(msg.date.getTime() / 1000) : msg.date,
        userId: msg.userId || null
      }));
      
      // Merge with existing in-memory history (which may have new messages)
      const existingHistory = this.conversationHistory.get(normalizedChannelId) || [];
      const mergedHistory = [...history, ...existingHistory];
      
      // Remove duplicates and keep last N messages
      const uniqueHistory = mergedHistory
        .filter((msg, index, self) => 
          index === self.findIndex(m => m.date === msg.date && m.text === msg.text)
        )
        .slice(-this.HISTORY_LIMIT);
      
      this.conversationHistory.set(normalizedChannelId, uniqueHistory);
      this.logger?.info?.(`[ConversationManager] Loaded ${history.length} messages from database for channel ${normalizedChannelId}`);
      return uniqueHistory;
    } catch (error) {
      this.logger?.error?.(`[ConversationManager] Failed to load conversation history:`, error);
      return [];
    }
  }

  /**
   * Track a bot message in history
   * @param {string} channelId
   * @param {string} text
   */
  async trackBotMessage(channelId, text) {
    if (!channelId || !text) return;
    const normalizedChannelId = String(channelId);
    const entry = {
      from: 'Bot',
      text,
      date: Math.floor(Date.now() / 1000),
      isBot: true,
      userId: null
    };
    
    const history = this.conversationHistory.get(normalizedChannelId) || [];
    history.push(entry);
    
    const trimmed = history.length > this.HISTORY_LIMIT
      ? history.slice(-this.HISTORY_LIMIT)
      : history;
      
    this.conversationHistory.set(normalizedChannelId, trimmed);
    
    try {
      await this.saveMessageToDatabase(normalizedChannelId, entry);
    } catch (error) {
      this.logger?.warn?.('[ConversationManager] Failed to track bot message:', error?.message || error);
    }
  }

  /**
   * Update active conversation status for a user in a channel
   * @param {string} channelId
   * @param {string} userId
   */
  updateActiveConversation(channelId, userId) {
    if (!channelId || !userId) return;
    const normalizedChannelId = String(channelId);
    
    if (!this.activeConversations.has(normalizedChannelId)) {
      this.activeConversations.set(normalizedChannelId, new Map());
    }
    
    const channelParticipants = this.activeConversations.get(normalizedChannelId);
    channelParticipants.set(userId, Date.now() + this.ACTIVE_CONVERSATION_WINDOW_MS);
    
    // Cleanup expired participants
    const now = Date.now();
    for (const [uid, expiry] of channelParticipants.entries()) {
      if (now > expiry) channelParticipants.delete(uid);
    }
  }

  /**
   * Get active participants in a channel
   * @param {string} channelId
   * @returns {string[]} Array of user IDs
   */
  getActiveParticipants(channelId) {
    const normalizedChannelId = String(channelId);
    const channelParticipants = this.activeConversations.get(normalizedChannelId);
    if (!channelParticipants) return [];
    
    const now = Date.now();
    const active = [];
    for (const [uid, expiry] of channelParticipants.entries()) {
      if (now <= expiry) active.push(uid);
    }
    return active;
  }

  /**
   * Check if a user is an active participant in a channel
   * @param {string} channelId
   * @param {string} userId
   * @returns {boolean}
   */
  isActiveParticipant(channelId, userId) {
    if (!channelId || !userId) return false;
    const normalizedChannelId = String(channelId);
    const channelParticipants = this.activeConversations.get(normalizedChannelId);
    if (!channelParticipants) return false;
    
    const expiry = channelParticipants.get(userId);
    if (!expiry) return false;
    
    if (Date.now() > expiry) {
      channelParticipants.delete(userId);
      return false;
    }
    return true;
  }

  /**
   * Get conversation context formatted for AI
   * @param {string} channelId
   * @returns {string}
   */
  getConversationContext(channelId) {
    const history = this.conversationHistory.get(String(channelId)) || [];
    if (!history.length) return '';
    
    return history.map(msg => `${msg.from}: ${msg.text}`).join('\n');
  }

  /**
   * Add a message to history and optionally save to database
   * @param {string} channelId
   * @param {Object} message
   * @param {boolean} saveToDb
   */
  async addMessage(channelId, message, saveToDb = true) {
    const normalizedChannelId = String(channelId);
    const history = this.conversationHistory.get(normalizedChannelId) || [];
    history.push(message);
    
    if (history.length > this.HISTORY_LIMIT) {
      this.conversationHistory.set(normalizedChannelId, history.slice(-this.HISTORY_LIMIT));
    } else {
      this.conversationHistory.set(normalizedChannelId, history);
    }
    
    if (saveToDb) {
      // Don't await to avoid blocking
      this.saveMessageToDatabase(normalizedChannelId, message).catch(err => 
        this.logger?.error?.('[ConversationManager] Background save failed:', err)
      );
    }
  }

  /**
   * Get conversation history for a channel
   * @param {string} channelId
   * @returns {Array}
   */
  getHistory(channelId) {
    return this.conversationHistory.get(String(channelId)) || [];
  }

  /**
   * Get all conversation histories
   * @returns {Iterator}
   */
  getAllHistories() {
    return this.conversationHistory.entries();
  }
}
