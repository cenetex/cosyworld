/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * ToolDecisionService
 * 
 * Uses a primary LLM to decide which tools should be called for avatars,
 * even when the avatar's model doesn't support native function calling.
 * 
 * This enables universal tool calling across all models.
 */
export class ToolDecisionService {
  constructor({ logger, aiService, toolSchemaGenerator, configService }) {
    this.logger = logger || console;
    this.aiService = aiService;
    this.toolSchemaGenerator = toolSchemaGenerator;
    this.configService = configService;
    
    // The "smart" model used for tool decisions
    this.decisionModel = process.env.TOOL_DECISION_MODEL || 'anthropic/claude-3.5-sonnet';
  }

  /**
   * Analyze conversation context and decide which tools to call
   * @param {Object} context - Conversation context
   * @returns {Array} Array of tool decisions { toolName, arguments, reasoning }
   */
  async decideTools(context) {
    const { avatar, messages, situation, availableTools } = context;
    
    try {
      // Build tool decision prompt
      const prompt = this._buildToolDecisionPrompt(avatar, messages, situation, availableTools);
      
      // Ask the decision model what tools to use
      const response = await this.aiService.chat([
        { role: 'system', content: 'You are a tool selection assistant. Analyze the conversation and recommend which tools the avatar should use.' },
        { role: 'user', content: prompt }
      ], {
        model: this.decisionModel,
        max_tokens: 500,
        temperature: 0.3 // Lower temp for more consistent decisions
      });
      
      // Parse the response
      const decisions = this._parseToolDecisions(response);
      
      if (decisions.length > 0) {
        this.logger.info?.(`[ToolDecision] Recommended ${decisions.length} tool(s) for ${avatar.name}: ${decisions.map(d => d.toolName).join(', ')}`);
      }
      
      return decisions;
      
    } catch (error) {
      this.logger.error?.(`[ToolDecision] Failed to decide tools: ${error.message}`);
      return [];
    }
  }

  /**
   * Build the tool decision prompt
   * @private
   */
  _buildToolDecisionPrompt(avatar, messages, situation, availableTools) {
    // Format available tools
    const toolsList = availableTools.map(tool => {
      return `- **${tool.name}** (${tool.emoji || ''}): ${tool.description}`;
    }).join('\n');
    
    // Format recent conversation
    const recentMessages = messages.slice(-5).map(msg => {
      const role = msg.role === 'user' ? 'User' : msg.authorTag || 'Avatar';
      return `${role}: ${msg.content}`;
    }).join('\n');
    
    // Build prompt
    return `
AVATAR: ${avatar.name}
PERSONALITY: ${avatar.personality || 'No specific personality'}

CURRENT SITUATION:
${situation.location ? `Location: ${situation.location}` : ''}
${situation.hp ? `HP: ${situation.hp}/${situation.maxHp}` : ''}
${situation.nearbyAvatars?.length ? `Nearby: ${situation.nearbyAvatars.join(', ')}` : ''}
${situation.inCombat ? 'STATUS: In combat!' : ''}

RECENT CONVERSATION:
${recentMessages}

AVAILABLE TOOLS:
${toolsList}
- **none**: Don't use any tools, just respond with words

TASK:
Analyze the situation and decide which tool(s) ${avatar.name} should use right now, if any. Consider:
1. What is the user asking for?
2. What would be natural for this avatar to do?
3. Does the situation call for action?
4. Would using a tool enhance the response?

Respond in this exact format:
TOOL: <tool_name>
ARGS: <arguments as JSON object or "none">
REASON: <brief explanation>

If no tools should be used, respond with:
TOOL: none
REASON: <why conversational response is better>

You may suggest multiple tools (one per line), but usually 0-1 is best.
`.trim();
  }

  /**
   * Parse tool decisions from LLM response
   * @private
   */
  _parseToolDecisions(response) {
    const decisions = [];
    
    try {
      const text = typeof response === 'string' ? response : response?.text || response?.content || String(response);
      const lines = text.split('\n');
      
      let currentTool = null;
      let currentArgs = null;
      let currentReason = null;
      
      for (const line of lines) {
        const trimmed = line.trim();
        
        if (trimmed.startsWith('TOOL:')) {
          // Save previous tool if exists
          if (currentTool && currentTool !== 'none') {
            decisions.push({
              toolName: currentTool,
              arguments: currentArgs || {},
              reasoning: currentReason || 'No reason provided'
            });
          }
          
          // Start new tool
          currentTool = trimmed.substring(5).trim();
          currentArgs = null;
          currentReason = null;
          
        } else if (trimmed.startsWith('ARGS:')) {
          const argsStr = trimmed.substring(5).trim();
          if (argsStr && argsStr !== 'none') {
            try {
              // Try to parse as JSON
              currentArgs = JSON.parse(argsStr);
            } catch {
              // If not JSON, treat as simple string argument
              currentArgs = { target: argsStr };
            }
          }
          
        } else if (trimmed.startsWith('REASON:')) {
          currentReason = trimmed.substring(7).trim();
        }
      }
      
      // Save last tool if exists
      if (currentTool && currentTool !== 'none') {
        decisions.push({
          toolName: currentTool,
          arguments: currentArgs || {},
          reasoning: currentReason || 'No reason provided'
        });
      }
      
    } catch (error) {
      this.logger.warn?.(`[ToolDecision] Failed to parse tool decisions: ${error.message}`);
    }
    
    return decisions;
  }

  /**
   * Format available tools for the decision prompt
   * @param {Array} toolSchemas - Tool schemas from ToolSchemaGenerator
   * @returns {Array} Simplified tool info
   */
  formatToolsForDecision(toolSchemas) {
    return toolSchemas.map(schema => {
      const func = schema.function;
      return {
        name: func.name,
        description: func.description,
        emoji: '', // TODO: get from tool instance
        parameters: func.parameters
      };
    });
  }
}
