/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * ToolSchemaGenerator
 * 
 * Generates OpenAI-compatible function calling schemas from registered tools.
 * Enables LLM-driven autonomous tool selection and execution.
 */
export class ToolSchemaGenerator {
  constructor({ logger, toolService }) {
    this.logger = logger || console;
    this.toolService = toolService;
  }

  /**
   * Generate OpenAI function calling schemas for all registered tools
   * @returns {Array} Array of tool schemas in OpenAI format
   */
  async generateSchemas() {
    const schemas = [];
    
    for (const [name, tool] of this.toolService.tools) {
      try {
        // Skip tools without schema support
        if (!tool.getParameterSchema) {
          this.logger.debug?.(`Tool ${name} does not support schema generation, skipping`);
          continue;
        }

        const schema = {
          type: 'function',
          function: {
            name: name,
            description: tool.getDescription ? tool.getDescription() : tool.description || `Execute ${name} tool`,
            parameters: tool.getParameterSchema()
          }
        };

        schemas.push(schema);
      } catch (error) {
        this.logger.warn?.(`Failed to generate schema for tool ${name}: ${error.message}`);
      }
    }

    this.logger.debug?.(`Generated ${schemas.length} tool schemas`);
    return schemas;
  }

  /**
   * Generate schemas filtered by context (location, avatar state, etc.)
   * @param {Object} _context - Context to filter tools by (reserved for future use)
   * @returns {Array} Filtered tool schemas
   */
  async generateContextualSchemas(_context = {}) {
    const allSchemas = await this.generateSchemas();
    
    // For now, return all schemas. Future: filter based on:
    // - Avatar's available tools (some may be locked)
    // - Location-specific tools
    // - Combat state (only combat tools during battle)
    // - Cooldowns (skip tools on cooldown)
    
    return allSchemas;
  }

  /**
   * Format tool results for inclusion in LLM conversation
   * @param {string} toolCallId - The tool call ID from the LLM
   * @param {string} toolName - Name of the tool that was executed
   * @param {*} result - Result from tool execution
   * @returns {Object} Formatted message for LLM context
   */
  formatToolResult(toolCallId, toolName, result) {
    return {
      role: 'tool',
      tool_call_id: toolCallId,
      name: toolName,
      content: typeof result === 'string' ? result : JSON.stringify(result)
    };
  }
}
