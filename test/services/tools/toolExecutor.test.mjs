/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/services/tools/toolExecutor.test.mjs
 * @description Comprehensive tests for ToolExecutor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToolExecutor } from '../../../src/services/tools/toolExecutor.mjs';

const createMockDeps = () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  toolService: {
    executeTool: vi.fn().mockResolvedValue({ message: 'Tool executed', notify: true }),
    tools: new Map([
      ['attack', { name: 'attack', execute: vi.fn() }],
      ['move', { name: 'move', execute: vi.fn() }],
    ]),
  },
  toolSchemaGenerator: {
    generateSchema: vi.fn().mockReturnValue({ type: 'object', properties: {} }),
  },
  agentContinuationService: {
    shouldContinue: vi.fn().mockResolvedValue({
      needsMoreActions: false,
      reasoning: 'Task complete',
      shouldRespond: true,
    }),
  },
});

describe('ToolExecutor', () => {
  let executor;
  let deps;

  beforeEach(() => {
    deps = createMockDeps();
    executor = new ToolExecutor(deps);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default configuration', () => {
      expect(executor.maxIterations).toBe(5);
      expect(executor.enableToolChaining).toBe(true);
    });

    it('should respect environment variables', () => {
      process.env.TOOL_MAX_ITERATIONS = '10';
      process.env.TOOL_ENABLE_CHAINING = 'false';

      const customExecutor = new ToolExecutor(deps);

      expect(customExecutor.maxIterations).toBe(10);
      expect(customExecutor.enableToolChaining).toBe(false);

      delete process.env.TOOL_MAX_ITERATIONS;
      delete process.env.TOOL_ENABLE_CHAINING;
    });

    it('should store service references', () => {
      expect(executor.toolService).toBe(deps.toolService);
      expect(executor.toolSchemaGenerator).toBe(deps.toolSchemaGenerator);
      expect(executor.continuationService).toBe(deps.agentContinuationService);
    });
  });

  describe('executeSingleTool', () => {
    const mockMessage = {
      channel: { id: 'channel-123' },
      author: { id: 'user-123' },
    };

    const mockAvatar = {
      _id: 'avatar-123',
      name: 'TestAvatar',
    };

    it('should execute a tool with valid arguments', async () => {
      const toolCall = {
        id: 'call-1',
        function: {
          name: 'attack',
          arguments: JSON.stringify({ target: 'enemy' }),
        },
      };

      const result = await executor.executeSingleTool(toolCall, mockMessage, mockAvatar);

      expect(result).toMatchObject({
        toolCallId: 'call-1',
        toolName: 'attack',
        success: true,
        error: null,
      });
    });

    it('should handle string arguments', async () => {
      const toolCall = {
        id: 'call-1',
        function: {
          name: 'attack',
          arguments: '{"target": "enemy"}',
        },
      };

      await executor.executeSingleTool(toolCall, mockMessage, mockAvatar);

      expect(deps.toolService.executeTool).toHaveBeenCalled();
    });

    it('should handle object arguments', async () => {
      const toolCall = {
        id: 'call-1',
        function: {
          name: 'attack',
          arguments: { target: 'enemy' },
        },
      };

      await executor.executeSingleTool(toolCall, mockMessage, mockAvatar);

      expect(deps.toolService.executeTool).toHaveBeenCalled();
    });

    it('should handle invalid JSON arguments', async () => {
      const toolCall = {
        id: 'call-1',
        function: {
          name: 'attack',
          arguments: 'invalid json {{{',
        },
      };

      const result = await executor.executeSingleTool(toolCall, mockMessage, mockAvatar);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments format');
    });

    it('should handle tool execution errors', async () => {
      deps.toolService.executeTool.mockRejectedValue(new Error('Tool failed'));

      const toolCall = {
        id: 'call-1',
        function: {
          name: 'attack',
          arguments: '{}',
        },
      };

      const result = await executor.executeSingleTool(toolCall, mockMessage, mockAvatar);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Tool failed');
    });

    it('should format string results with bracket notation', async () => {
      deps.toolService.executeTool.mockResolvedValue({ message: 'Attack hit for 10 damage', notify: true });

      const toolCall = {
        id: 'call-1',
        function: {
          name: 'attack',
          arguments: '{}',
        },
      };

      const result = await executor.executeSingleTool(toolCall, mockMessage, mockAvatar);

      expect(result.result).toContain('Attack hit for 10 damage');
    });

    it('should handle null results (silent execution)', async () => {
      deps.toolService.executeTool.mockResolvedValue({ message: null, notify: false });

      const toolCall = {
        id: 'call-1',
        function: {
          name: 'attack',
          arguments: '{}',
        },
      };

      const result = await executor.executeSingleTool(toolCall, mockMessage, mockAvatar);

      expect(result.success).toBe(true);
      expect(result.result).toBeNull();
    });

    it('should handle results with notify: false', async () => {
      deps.toolService.executeTool.mockResolvedValue({ message: 'Secret action', notify: false });

      const toolCall = {
        id: 'call-1',
        function: {
          name: 'attack',
          arguments: '{}',
        },
      };

      const result = await executor.executeSingleTool(toolCall, mockMessage, mockAvatar);

      expect(result.result).toBeNull(); // notify: false means no display
    });

    it('should preserve already-formatted results', async () => {
      deps.toolService.executeTool.mockResolvedValue({ message: '-# [ Already formatted ]', notify: true });

      const toolCall = {
        id: 'call-1',
        function: {
          name: 'attack',
          arguments: '{}',
        },
      };

      const result = await executor.executeSingleTool(toolCall, mockMessage, mockAvatar);

      expect(result.result).toBe('-# [ Already formatted ]');
    });
  });

  describe('executeToolCalls', () => {
    const mockMessage = { channel: { id: 'channel-123' } };
    const mockAvatar = { _id: 'avatar-123', name: 'TestAvatar' };

    it('should execute multiple tool calls', async () => {
      const toolCalls = [
        { id: 'call-1', function: { name: 'attack', arguments: '{}' } },
        { id: 'call-2', function: { name: 'move', arguments: '{}' } },
      ];

      const result = await executor.executeToolCalls(toolCalls, mockMessage, mockAvatar);

      expect(result.results).toHaveLength(2);
      expect(result.iterations).toBe(1);
    });

    it('should respect maxIterations option', async () => {
      deps.agentContinuationService.shouldContinue.mockResolvedValue({
        needsMoreActions: true,
        toolCalls: [{ id: 'next', function: { name: 'attack', arguments: '{}' } }],
      });

      const toolCalls = [
        { id: 'call-1', function: { name: 'attack', arguments: '{}' } },
      ];

      const result = await executor.executeToolCalls(toolCalls, mockMessage, mockAvatar, {}, {
        maxIterations: 2,
      });

      expect(result.iterations).toBeLessThanOrEqual(2);
    });

    it('should stop when chaining is disabled', async () => {
      const toolCalls = [
        { id: 'call-1', function: { name: 'attack', arguments: '{}' } },
      ];

      const result = await executor.executeToolCalls(toolCalls, mockMessage, mockAvatar, {}, {
        enableChaining: false,
      });

      expect(result.iterations).toBe(1);
      expect(result.finalDecision.reasoning).toContain('disabled');
    });

    it('should use continuation service for chaining', async () => {
      deps.agentContinuationService.shouldContinue.mockResolvedValue({
        needsMoreActions: false,
        reasoning: 'Task complete',
        shouldRespond: true,
      });

      const toolCalls = [
        { id: 'call-1', function: { name: 'attack', arguments: '{}' } },
      ];

      await executor.executeToolCalls(toolCalls, mockMessage, mockAvatar);

      expect(deps.agentContinuationService.shouldContinue).toHaveBeenCalled();
    });

    it('should handle continuation service errors', async () => {
      deps.agentContinuationService.shouldContinue.mockRejectedValue(new Error('Continuation failed'));

      const toolCalls = [
        { id: 'call-1', function: { name: 'attack', arguments: '{}' } },
      ];

      const result = await executor.executeToolCalls(toolCalls, mockMessage, mockAvatar);

      expect(result.finalDecision.reasoning).toContain('Continuation error');
    });

    it('should continue execution when continuation service returns more tools', async () => {
      deps.agentContinuationService.shouldContinue
        .mockResolvedValueOnce({
          needsMoreActions: true,
          toolCalls: [{ id: 'call-2', function: { name: 'move', arguments: '{}' } }],
        })
        .mockResolvedValueOnce({
          needsMoreActions: false,
          shouldRespond: true,
        });

      const toolCalls = [
        { id: 'call-1', function: { name: 'attack', arguments: '{}' } },
      ];

      const result = await executor.executeToolCalls(toolCalls, mockMessage, mockAvatar);

      expect(result.results.length).toBeGreaterThanOrEqual(2);
      expect(result.iterations).toBe(2);
    });

    it('should return final decision with shouldRespond flag', async () => {
      deps.agentContinuationService.shouldContinue.mockResolvedValue({
        needsMoreActions: false,
        reasoning: 'Done',
        shouldRespond: false,
      });

      const toolCalls = [
        { id: 'call-1', function: { name: 'attack', arguments: '{}' } },
      ];

      const result = await executor.executeToolCalls(toolCalls, mockMessage, mockAvatar);

      expect(result.finalDecision.shouldRespond).toBe(false);
    });

    it('should pass chat history to continuation service', async () => {
      const chatHistory = [
        { role: 'user', content: 'Attack the enemy' },
        { role: 'assistant', content: 'I will attack' },
      ];

      const toolCalls = [
        { id: 'call-1', function: { name: 'attack', arguments: '{}' } },
      ];

      await executor.executeToolCalls(toolCalls, mockMessage, mockAvatar, {}, {
        chatHistory,
      });

      expect(deps.agentContinuationService.shouldContinue).toHaveBeenCalledWith(
        expect.objectContaining({
          chatHistory,
        })
      );
    });
  });

  describe('_argsToParams', () => {
    it('should convert object arguments to params array', () => {
      const result = executor._argsToParams({ target: 'enemy', damage: 10 }, 'attack');

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('_suggestsContinuation', () => {
    it('should be defined on executor', () => {
      expect(typeof executor._suggestsContinuation).toBe('function');
    });
  });
});

describe('ToolExecutor - Edge Cases', () => {
  let executor;
  let deps;

  beforeEach(() => {
    deps = createMockDeps();
    executor = new ToolExecutor(deps);
  });

  it('should handle empty tool calls array', async () => {
    const result = await executor.executeToolCalls([], {}, {});

    expect(result.results).toHaveLength(0);
    expect(result.iterations).toBe(0);
  });

  it('should handle null continuation service', async () => {
    executor.continuationService = null;

    const toolCalls = [
      { id: 'call-1', function: { name: 'attack', arguments: '{}' } },
    ];

    // Should not throw
    const result = await executor.executeToolCalls(toolCalls, {}, {});

    expect(result.results).toHaveLength(1);
  });

  it('should handle tools returning various result types', async () => {
    const mockMessage = { channel: { id: '123' } };
    const mockAvatar = { _id: 'av1', name: 'Test' };

    // Test with object result
    deps.toolService.executeTool.mockResolvedValueOnce({ message: { key: 'value' }, notify: true });

    const result = await executor.executeSingleTool(
      { id: '1', function: { name: 'attack', arguments: '{}' } },
      mockMessage,
      mockAvatar
    );

    // Should JSON stringify object results
    expect(result.result).toContain('key');
  });
});

describe('ToolExecutor - Without Continuation Service', () => {
  let executor;
  let deps;

  beforeEach(() => {
    deps = createMockDeps();
    deps.agentContinuationService = null;
    executor = new ToolExecutor(deps);
  });

  it('should still execute tools without continuation service', async () => {
    const toolCalls = [
      { id: 'call-1', function: { name: 'attack', arguments: '{}' } },
    ];

    const result = await executor.executeToolCalls(toolCalls, {}, {});

    expect(result.results).toHaveLength(1);
  });

  it('should use heuristic continuation check', async () => {
    const toolCalls = [
      { id: 'call-1', function: { name: 'attack', arguments: '{}' } },
    ];

    const result = await executor.executeToolCalls(toolCalls, {}, {});

    // Without continuation service, should complete in 1 iteration
    expect(result.iterations).toBe(1);
  });
});
