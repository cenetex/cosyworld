/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Conversation Service
 * 
 * Manages conversation history, context building, and AI response generation.
 * Extracted from TelegramService to provide a reusable conversation layer.
 * 
 * Features:
 * - Conversation history management with TTL
 * - Context building for AI prompts
 * - Tool call processing
 * - Memory integration
 * - User tracking
 * 
 * @module services/conversation/conversationService
 */

import { ConversationError } from '../../utils/errors.mjs';

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  maxHistoryLength: 50,          // Max messages per channel
  contextWindowMessages: 20,     // Messages to include in context
  historyTTLMs: 24 * 60 * 60 * 1000, // 24 hours
  defaultModel: 'anthropic/claude-sonnet-4.5',
  defaultTemperature: 0.8
};

/**
 * ConversationService - Centralized conversation management
 */
export class ConversationService {
  /**
   * @param {Object} deps - Service dependencies
   * @param {Object} deps.databaseService - Database service for persistence
   * @param {Object} deps.aiService - AI service for response generation
   * @param {Object} deps.memoryService - Memory service for long-term context
   * @param {Object} deps.logger - Logger instance
   * @param {Object} [deps.config] - Configuration overrides
   */
  constructor({ databaseService, aiService, memoryService, logger, config = {} }) {
    this.databaseService = databaseService;
    this.aiService = aiService;
    this.memoryService = memoryService;
    this.logger = logger;
    
    // Merge config with defaults
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // In-memory conversation history cache
    this.conversationHistory = new Map();
    
    // User context cache (recent interactions)
    this.userContextCache = new Map();
    
    // Cleanup interval
    this._cleanupInterval = null;
    
    this.logger?.info?.('[ConversationService] Initialized');
  }

  /**
   * Start periodic cleanup of stale history
   */
  startCleanup() {
    if (this._cleanupInterval) return;
    
    this._cleanupInterval = setInterval(() => {
      this._pruneStaleHistory();
    }, 5 * 60 * 1000); // Every 5 minutes
    
    this.logger?.info?.('[ConversationService] Started cleanup interval');
  }

  /**
   * Stop cleanup interval
   */
  stopCleanup() {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HISTORY MANAGEMENT
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Add a message to conversation history
   * @param {string} channelId - Channel identifier
   * @param {Object} message - Message object
   * @param {string} message.role - 'user' or 'assistant'
   * @param {string} message.content - Message content
   * @param {string} [message.userId] - User ID (for user messages)
   * @param {string} [message.username] - Username
   * @param {number} [message.timestamp] - Unix timestamp
   */
  addMessage(channelId, message) {
    const history = this.conversationHistory.get(channelId) || [];
    
    const msg = {
      ...message,
      timestamp: message.timestamp || Date.now(),
      date: message.date || Math.floor(Date.now() / 1000)
    };
    
    history.push(msg);
    
    // Trim to max length
    if (history.length > this.config.maxHistoryLength) {
      history.splice(0, history.length - this.config.maxHistoryLength);
    }
    
    this.conversationHistory.set(channelId, history);
    
    // Update user context cache
    if (message.userId) {
      this._updateUserContext(channelId, message.userId, message);
    }
  }

  /**
   * Get conversation history for a channel
   * @param {string} channelId - Channel identifier
   * @param {number} [limit] - Max messages to return
   * @returns {Array} - Message history
   */
  getHistory(channelId, limit = null) {
    const history = this.conversationHistory.get(channelId) || [];
    if (limit && limit < history.length) {
      return history.slice(-limit);
    }
    return [...history];
  }

  /**
   * Clear conversation history for a channel
   * @param {string} channelId - Channel identifier
   */
  clearHistory(channelId) {
    this.conversationHistory.delete(channelId);
    this.logger?.info?.(`[ConversationService] Cleared history for ${channelId}`);
  }

  /**
   * Load history from database
   * @param {string} channelId - Channel identifier
   * @param {number} [limit=50] - Messages to load
   */
  async loadHistoryFromDB(channelId, limit = 50) {
    if (!this.databaseService) return;
    
    try {
      const collection = this.databaseService.getCollection('telegram_messages');
      const messages = await collection
        .find({ channelId })
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray();
      
      // Reverse to chronological order and set in cache
      const history = messages.reverse().map(m => ({
        role: m.from === 'Bot' ? 'assistant' : 'user',
        content: m.text || '',
        from: m.from,
        userId: m.userId,
        timestamp: m.timestamp,
        date: m.date || Math.floor(m.timestamp / 1000)
      }));
      
      this.conversationHistory.set(channelId, history);
      this.logger?.debug?.(`[ConversationService] Loaded ${history.length} messages for ${channelId}`);
    } catch (err) {
      this.logger?.error?.(`[ConversationService] Failed to load history:`, err.message);
    }
  }

  /**
   * Persist a message to database
   * @param {string} channelId - Channel identifier
   * @param {Object} message - Message to save
   */
  async persistMessage(channelId, message) {
    if (!this.databaseService) return;
    
    try {
      const collection = this.databaseService.getCollection('telegram_messages');
      await collection.insertOne({
        channelId,
        ...message,
        createdAt: new Date()
      });
    } catch (err) {
      this.logger?.error?.(`[ConversationService] Failed to persist message:`, err.message);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CONTEXT BUILDING
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Build context for AI response generation
   * @param {string} channelId - Channel identifier
   * @param {Object} [options] - Context options
   * @param {string} [options.userId] - Current user ID
   * @param {string} [options.botPersona] - Bot persona/system prompt
   * @param {number} [options.maxMessages] - Max history messages
   * @param {boolean} [options.includeMemories] - Include long-term memories
   * @returns {Promise<Object>} - Context object
   */
  async buildContext(channelId, options = {}) {
    const {
      userId = null,
      botPersona = null,
      maxMessages = this.config.contextWindowMessages,
      includeMemories = true
    } = options;

    const history = this.getHistory(channelId, maxMessages);
    
    // Build conversation context string
    const conversationContext = history
      .map(m => `${m.from || m.role}: ${m.content}`)
      .join('\n');

    // Get memories if requested
    let memories = [];
    if (includeMemories && this.memoryService && userId) {
      try {
        memories = await this.memoryService.getRelevantMemories({
          channelId,
          userId,
          limit: 5
        });
      } catch (err) {
        this.logger?.warn?.(`[ConversationService] Failed to get memories:`, err.message);
      }
    }

    // Get user context
    const userContext = userId ? this._getUserContext(channelId, userId) : null;

    return {
      channelId,
      userId,
      history,
      conversationContext,
      memories,
      userContext,
      botPersona,
      timestamp: Date.now()
    };
  }

  /**
   * Format context for AI messages array
   * @param {Object} context - Context from buildContext
   * @param {string} userMessage - Current user message
   * @returns {Array} - Messages array for AI
   */
  formatMessagesForAI(context, userMessage) {
    const messages = [];
    
    // System message with persona and memories
    let systemContent = context.botPersona || 'You are a helpful assistant.';
    
    if (context.memories?.length > 0) {
      systemContent += '\n\nRelevant memories:\n';
      systemContent += context.memories.map(m => `- ${m.content}`).join('\n');
    }
    
    messages.push({ role: 'system', content: systemContent });
    
    // Add conversation history
    for (const msg of context.history) {
      messages.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      });
    }
    
    // Add current message
    messages.push({ role: 'user', content: userMessage });
    
    return messages;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RESPONSE GENERATION
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Generate AI response
   * @param {Object} context - Context from buildContext
   * @param {string} userMessage - User's message
   * @param {Object} [options] - Generation options
   * @param {Array} [options.tools] - Available tools
   * @param {string} [options.model] - Model to use
   * @param {number} [options.temperature] - Temperature
   * @returns {Promise<Object>} - { response, toolCalls }
   */
  async generateResponse(context, userMessage, options = {}) {
    const {
      tools = [],
      model = this.config.defaultModel,
      temperature = this.config.defaultTemperature
    } = options;

    if (!this.aiService) {
      throw new ConversationError('AI service not available', {
        channelId: context.channelId
      });
    }

    const messages = this.formatMessagesForAI(context, userMessage);

    this.logger?.debug?.(`[ConversationService] Generating response`, {
      channelId: context.channelId,
      messageCount: messages.length,
      hasTools: tools.length > 0
    });

    try {
      const response = await this.aiService.chat(messages, {
        model,
        temperature,
        tools: tools.length > 0 ? tools : undefined
      });

      // Parse response for tool calls
      const { text, toolCalls } = this._parseResponse(response);

      return {
        response: text,
        toolCalls,
        model,
        usage: response?.usage || null
      };
    } catch (err) {
      this.logger?.error?.(`[ConversationService] Response generation failed:`, err.message);
      throw new ConversationError(`Failed to generate response: ${err.message}`, {
        channelId: context.channelId,
        userId: context.userId,
        retryable: true
      });
    }
  }

  /**
   * Process tool calls from AI response
   * @param {Array} toolCalls - Tool calls from AI
   * @param {Object} toolHandlers - Map of tool name to handler function
   * @param {Object} context - Conversation context
   * @returns {Promise<Array>} - Tool results
   */
  async processToolCalls(toolCalls, toolHandlers, context) {
    const results = [];
    
    for (const call of toolCalls) {
      // Normalize tool name - some models return prefixed names like "default_api:speak"
      let toolName = call.name;
      if (toolName && toolName.includes(':')) {
        toolName = toolName.split(':').pop();
        this.logger?.debug?.(`[ConversationService] Normalized tool name to: ${toolName}`);
      }
      
      const handler = toolHandlers[toolName];
      
      if (!handler) {
        this.logger?.warn?.(`[ConversationService] Unknown tool: ${call.name} (normalized: ${toolName})`);
        results.push({
          toolName: call.name,
          success: false,
          error: `Unknown tool: ${toolName}`
        });
        continue;
      }

      try {
        this.logger?.info?.(`[ConversationService] Executing tool: ${toolName}`);
        const result = await handler(call.arguments, context);
        results.push({
          toolName: toolName,
          success: true,
          result
        });
      } catch (err) {
        this.logger?.error?.(`[ConversationService] Tool ${toolName} failed:`, err.message);
        results.push({
          toolName: toolName,
          success: false,
          error: err.message
        });
      }
    }
    
    return results;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // USER CONTEXT
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Update user context cache
   * @private
   */
  _updateUserContext(channelId, userId, message) {
    const key = `${channelId}:${userId}`;
    const context = this.userContextCache.get(key) || {
      firstSeen: Date.now(),
      messageCount: 0,
      lastMessage: null
    };
    
    context.messageCount++;
    context.lastMessage = message.content;
    context.lastSeen = Date.now();
    
    this.userContextCache.set(key, context);
  }

  /**
   * Get user context
   * @private
   */
  _getUserContext(channelId, userId) {
    const key = `${channelId}:${userId}`;
    return this.userContextCache.get(key) || null;
  }

  /**
   * Parse AI response for text and tool calls
   * @private
   */
  _parseResponse(response) {
    // Handle string response
    if (typeof response === 'string') {
      return { text: response, toolCalls: [] };
    }
    
    // Handle object response with content and tool_calls
    if (response?.content) {
      const text = typeof response.content === 'string' 
        ? response.content 
        : response.content.map(c => c.text || '').join('');
      
      const toolCalls = (response.tool_calls || []).map(tc => ({
        name: tc.function?.name || tc.name,
        arguments: typeof tc.function?.arguments === 'string' 
          ? JSON.parse(tc.function.arguments) 
          : tc.function?.arguments || tc.arguments || {}
      }));
      
      return { text, toolCalls };
    }
    
    return { text: String(response || ''), toolCalls: [] };
  }

  /**
   * Prune stale conversation history
   * @private
   */
  _pruneStaleHistory() {
    const now = Date.now();
    const maxAge = this.config.historyTTLMs;
    let pruned = 0;
    
    for (const [channelId, history] of this.conversationHistory.entries()) {
      if (history.length === 0) {
        this.conversationHistory.delete(channelId);
        pruned++;
        continue;
      }
      
      const lastMessage = history[history.length - 1];
      const age = now - (lastMessage.timestamp || 0);
      
      if (age > maxAge) {
        this.conversationHistory.delete(channelId);
        pruned++;
      }
    }
    
    // Also prune user context cache
    for (const [key, context] of this.userContextCache.entries()) {
      if (now - context.lastSeen > maxAge) {
        this.userContextCache.delete(key);
      }
    }
    
    if (pruned > 0) {
      this.logger?.debug?.(`[ConversationService] Pruned ${pruned} stale conversations`);
    }
  }

  /**
   * Get statistics
   * @returns {Object} - Service statistics
   */
  getStats() {
    let totalMessages = 0;
    for (const history of this.conversationHistory.values()) {
      totalMessages += history.length;
    }
    
    return {
      activeChannels: this.conversationHistory.size,
      totalMessages,
      cachedUsers: this.userContextCache.size
    };
  }
}

export default ConversationService;
