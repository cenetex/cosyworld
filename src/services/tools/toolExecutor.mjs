/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * ToolExecutor
 * 
 * Manages tool execution loops with multi-step capability.
 * Handles tool call chains and result aggregation for LLM-driven agentic behavior.
 */
export class ToolExecutor {
  constructor({ logger, toolService, toolSchemaGenerator }) {
    this.logger = logger || console;
    this.toolService = toolService;
    this.toolSchemaGenerator = toolSchemaGenerator;
    
    // Configuration
    this.maxIterations = parseInt(process.env.TOOL_MAX_ITERATIONS || '3', 10);
    this.enableToolChaining = String(process.env.TOOL_ENABLE_CHAINING || 'true').toLowerCase() === 'true';
  }

  /**
   * Execute a single tool call
   * @param {Object} toolCall - The tool call from LLM { id, type, function: { name, arguments } }
   * @param {Object} message - Discord message context
   * @param {Object} avatar - Avatar executing the tool
   * @param {Object} services - Additional services for tool execution
   * @returns {Object} Result { toolCallId, toolName, success, result, error }
   */
  async executeSingleTool(toolCall, message, avatar, services = {}) {
    const { id: toolCallId, function: func } = toolCall;
    const toolName = func.name;
    
    try {
      this.logger.debug?.(`[ToolExecutor] Executing tool: ${toolName} for avatar ${avatar.name}`);
      
      // Parse arguments
      let args = {};
      try {
        args = typeof func.arguments === 'string' ? JSON.parse(func.arguments) : func.arguments;
      } catch (parseError) {
        this.logger.warn?.(`[ToolExecutor] Failed to parse arguments for ${toolName}: ${parseError.message}`);
        return {
          toolCallId,
          toolName,
          success: false,
          error: `Invalid arguments format: ${parseError.message}`,
          result: null
        };
      }

      // Convert arguments to params array for tool execution
      // Most tools expect params as an array of strings
      const params = this._argsToParams(args, toolName);
      
      // Execute the tool
      const result = await this.toolService.executeTool(
        toolName,
        message,
        params,
        avatar,
        services
      );

      this.logger.info?.(`[ToolExecutor] Tool ${toolName} executed successfully`);
      
      return {
        toolCallId,
        toolName,
        success: true,
        result: result || 'Tool executed successfully',
        error: null
      };
    } catch (error) {
      this.logger.error?.(`[ToolExecutor] Tool ${toolName} execution failed: ${error.message}`);
      
      return {
        toolCallId,
        toolName,
        success: false,
        error: error.message,
        result: null
      };
    }
  }

  /**
   * Execute multiple tool calls with optional chaining
   * @param {Array} toolCalls - Array of tool calls from LLM
   * @param {Object} message - Discord message context
   * @param {Object} avatar - Avatar executing the tools
   * @param {Object} services - Additional services for tool execution
   * @param {Object} options - Execution options { maxIterations, enableChaining }
   * @returns {Array} Array of tool execution results
   */
  async executeToolCalls(toolCalls, message, avatar, services = {}, options = {}) {
    const maxIterations = options.maxIterations || this.maxIterations;
    const enableChaining = options.enableChaining !== undefined ? options.enableChaining : this.enableToolChaining;
    
    const allResults = [];
    let iteration = 0;
    let currentCalls = toolCalls;
    
    this.logger.debug?.(`[ToolExecutor] Starting tool execution loop (max ${maxIterations} iterations, chaining: ${enableChaining})`);
    
    while (currentCalls && currentCalls.length > 0 && iteration < maxIterations) {
      this.logger.debug?.(`[ToolExecutor] Iteration ${iteration + 1}: Executing ${currentCalls.length} tool(s)`);
      
      // Execute all tools in this iteration
      const iterationResults = [];
      for (const toolCall of currentCalls) {
        const result = await this.executeSingleTool(toolCall, message, avatar, services);
        iterationResults.push(result);
        allResults.push(result);
      }
      
      // If chaining disabled or last iteration, stop here
      if (!enableChaining || iteration >= maxIterations - 1) {
        this.logger.debug?.(`[ToolExecutor] Tool execution complete (chaining disabled or max iterations reached)`);
        break;
      }
      
      // For now, don't automatically request follow-up tools
      // In the future, we could analyze results and suggest next actions
      currentCalls = [];
      
      iteration++;
    }
    
    this.logger.info?.(`[ToolExecutor] Completed tool execution: ${allResults.length} total calls over ${iteration + 1} iteration(s)`);
    
    return allResults;
  }

  /**
   * Convert structured arguments to params array for legacy tool interface
   * @param {Object} args - Structured arguments from LLM
   * @param {string} toolName - Name of the tool
   * @returns {Array} Params array
   * @private
   */
  _argsToParams(args, toolName) {
    // Handle different parameter structures per tool
    switch (toolName) {
      case 'move':
        return args.destination ? [args.destination] : [];
      
      case 'attack':
      case 'challenge':
        return args.target ? [args.target] : [];
      
      case 'item':
        // item tool expects: ['action', 'target']
        return [args.action, args.target].filter(Boolean);
      
      case 'create':
        // create expects description/prompt
        return args.description ? [args.description] : args.prompt ? [args.prompt] : [];
      
      case 'x':
        // x (Twitter) expects tweet content
        return args.content ? [args.content] : args.text ? [args.text] : [];
      
      default:
        // Generic handling: if 'target' field, use it; otherwise flatten all values
        if (args.target) {
          return [args.target];
        }
        // Flatten all argument values into array
        return Object.values(args).filter(v => v !== null && v !== undefined);
    }
  }

  /**
   * Format tool results for inclusion in LLM conversation
   * @param {Array} results - Array of tool execution results
   * @returns {Array} Formatted messages for LLM context
   */
  formatResultsForLLM(results) {
    return results.map(result => ({
      role: 'tool',
      tool_call_id: result.toolCallId,
      name: result.toolName,
      content: result.success 
        ? (typeof result.result === 'string' ? result.result : JSON.stringify(result.result))
        : `Error: ${result.error}`
    }));
  }

  /**
   * Get a summary of tool execution for logging
   * @param {Array} results - Array of tool execution results
   * @returns {string} Summary string
   */
  getSummary(results) {
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const toolNames = results.map(r => r.toolName).join(', ');
    
    return `Executed ${results.length} tool(s): ${toolNames} (${successful} succeeded, ${failed} failed)`;
  }
}
