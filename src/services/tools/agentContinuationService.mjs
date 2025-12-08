/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file src/services/tools/agentContinuationService.mjs
 * @description Service for managing multi-step agent tool execution.
 *              After tool execution, asks the AI if more actions are needed.
 *              Generalizes the planning pattern from Telegram for all agents.
 */

/**
 * @typedef {Object} ContinuationDecision
 * @property {boolean} needsMoreActions - Whether additional actions are needed
 * @property {Array<Object>} toolCalls - New tool calls to execute (if any)
 * @property {string} [reasoning] - AI's reasoning for the decision
 * @property {boolean} [shouldRespond] - Whether to generate a response after tools
 */

/**
 * @typedef {Object} ContinuationContext
 * @property {Object} avatar - The avatar making decisions
 * @property {Array<Object>} toolResults - Results from previous tool executions
 * @property {Array<Object>} chatHistory - Conversation history
 * @property {Object} [originalMessage] - The original triggering message
 * @property {number} iteration - Current iteration number
 * @property {number} maxIterations - Maximum allowed iterations
 */

/**
 * Service for managing agent continuation decisions
 */
export class AgentContinuationService {
  /**
   * @param {Object} options
   * @param {Object} options.unifiedAIService - AI service for making decisions
   * @param {Object} options.toolSchemaGenerator - Tool schema generator
   * @param {Object} [options.logger] - Logger instance
   */
  constructor({ unifiedAIService, aiService, toolSchemaGenerator, logger }) {
    this.aiService = unifiedAIService || aiService;
    this.toolSchemaGenerator = toolSchemaGenerator;
    this.logger = logger || console;
    
    // Configuration
    this.maxIterations = parseInt(process.env.AGENT_MAX_ITERATIONS || '5', 10);
    this.continuationModel = process.env.AGENT_CONTINUATION_MODEL || null; // Use avatar's model if not set
    this.enableContinuation = String(process.env.AGENT_ENABLE_CONTINUATION || 'true').toLowerCase() === 'true';
  }

  /**
   * Determine if the agent needs to take more actions
   * @param {ContinuationContext} context - Context for the decision
   * @returns {Promise<ContinuationDecision>}
   */
  async shouldContinue(context) {
    const { avatar, toolResults, chatHistory, iteration, maxIterations } = context;
    
    // Safety check: Don't exceed max iterations
    if (iteration >= maxIterations) {
      this.logger.debug?.(`[AgentContinuation] Max iterations (${maxIterations}) reached for ${avatar.name}`);
      return {
        needsMoreActions: false,
        toolCalls: [],
        reasoning: 'Maximum iteration limit reached',
        shouldRespond: true
      };
    }
    
    // If continuation is disabled, always stop
    if (!this.enableContinuation) {
      return {
        needsMoreActions: false,
        toolCalls: [],
        reasoning: 'Continuation disabled',
        shouldRespond: true
      };
    }
    
    // If no tool results, nothing to continue from
    if (!toolResults || toolResults.length === 0) {
      return {
        needsMoreActions: false,
        toolCalls: [],
        reasoning: 'No tool results to continue from',
        shouldRespond: true
      };
    }
    
    // Build the continuation prompt
    const prompt = this._buildContinuationPrompt(context);
    const tools = this.toolSchemaGenerator?.generateOpenAISchema?.() || [];
    
    try {
      const model = this.continuationModel || avatar.model;
      
      const response = await this.aiService.chat([
        { role: 'system', content: this._getSystemPrompt(avatar) },
        ...chatHistory.slice(-10), // Include recent history for context
        { role: 'user', content: prompt }
      ], {
        model,
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: tools.length > 0 ? 'auto' : undefined,
        temperature: 0.3 // Lower temperature for more deterministic decisions
      });
      
      // Parse the response
      return this._parseResponse(response, avatar);
    } catch (error) {
      this.logger.error?.(`[AgentContinuation] Decision failed for ${avatar.name}: ${error.message}`);
      return {
        needsMoreActions: false,
        toolCalls: [],
        reasoning: `Error: ${error.message}`,
        shouldRespond: true
      };
    }
  }

  /**
   * Build the system prompt for continuation decisions
   * @param {Object} avatar - The avatar
   * @returns {string}
   * @private
   */
  _getSystemPrompt(avatar) {
    return `You are ${avatar.name}, an autonomous agent in CosyWorld.
${avatar.prompt ? `Your personality: ${avatar.prompt}` : ''}

You have just completed some actions. Decide if you need to take additional actions to achieve your goal, or if you're done and should respond to the user.

Guidelines:
- If your previous action succeeded and achieved the goal, you're done
- If your action failed, consider retrying or trying a different approach
- If you're gathering information, continue until you have what you need
- If you've started a multi-step task, continue until complete
- Don't loop infinitely - if something isn't working after 2-3 tries, respond with the issue
- Only use tools if they're truly needed - don't use tools just to use them`;
  }

  /**
   * Build the continuation prompt from context
   * @param {ContinuationContext} context
   * @returns {string}
   * @private
   */
  _buildContinuationPrompt(context) {
    const { toolResults, iteration, maxIterations, originalMessage } = context;
    
    const resultsText = toolResults.map((r, i) => {
      const status = r.success ? '✓' : '✗';
      const content = r.success ? (r.result || 'Success') : (r.error || 'Failed');
      return `${i + 1}. ${status} ${r.toolName}: ${content}`;
    }).join('\n');
    
    const parts = [
      `[Iteration ${iteration + 1}/${maxIterations}]`,
      '',
      'You just performed these actions:',
      resultsText,
      '',
      'Based on these results, do you need to take any additional actions?',
      '',
      'Options:',
      '1. Use another tool if more actions are needed',
      '2. Respond directly if you\'re done and want to communicate the results'
    ];
    
    if (originalMessage?.content) {
      parts.push('', `Original request: "${originalMessage.content}"`);
    }
    
    return parts.join('\n');
  }

  /**
   * Parse the AI response to determine continuation
   * @param {Object|string} response - AI response
   * @param {Object} avatar - Avatar for logging
   * @returns {ContinuationDecision}
   * @private
   */
  _parseResponse(response, avatar) {
    // Handle structured response with tool calls
    if (response && typeof response === 'object') {
      // Check for native tool calls
      if (response.tool_calls && Array.isArray(response.tool_calls) && response.tool_calls.length > 0) {
        this.logger.debug?.(`[AgentContinuation] ${avatar.name} decided to continue with ${response.tool_calls.length} tool(s)`);
        return {
          needsMoreActions: true,
          toolCalls: response.tool_calls,
          reasoning: response.text || response.content || 'Continuing with tools',
          shouldRespond: false
        };
      }
      
      // Check for text response (done)
      if (response.text || response.content) {
        return {
          needsMoreActions: false,
          toolCalls: [],
          reasoning: response.text || response.content,
          shouldRespond: true
        };
      }
    }
    
    // String response means done
    if (typeof response === 'string' && response.trim()) {
      return {
        needsMoreActions: false,
        toolCalls: [],
        reasoning: response,
        shouldRespond: true
      };
    }
    
    // Default: stop and respond
    return {
      needsMoreActions: false,
      toolCalls: [],
      reasoning: 'No clear continuation decision',
      shouldRespond: true
    };
  }

  /**
   * Check if a tool result suggests the agent should continue
   * (Heuristic check without AI call)
   * @param {Object} toolResult - Single tool result
   * @returns {boolean}
   */
  suggestsContinuation(toolResult) {
    if (!toolResult) return false;
    
    // Failed tools might warrant retry
    if (!toolResult.success) {
      return true;
    }
    
    // Check result content for continuation hints
    const result = String(toolResult.result || '').toLowerCase();
    
    // Search/wiki results often need follow-up
    if (result.includes('found') && (result.includes('wiki') || result.includes('search'))) {
      return true;
    }
    
    // "Now in context" suggests follow-up action possible
    if (result.includes('now in context')) {
      return true;
    }
    
    return false;
  }
}
