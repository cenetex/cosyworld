/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/services/ai/unifiedAIService.test.mjs
 * @description Comprehensive tests for UnifiedAIService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UnifiedAIService } from '../../../src/services/ai/unifiedAIService.mjs';

const createMockBaseService = () => ({
  chat: vi.fn().mockResolvedValue({ text: 'AI response', usage: {} }),
  model: 'test-model',
  constructor: { name: 'MockAIService' },
  generateStructuredOutput: vi.fn().mockResolvedValue({ data: 'structured' }),
});

const createMockDeps = (baseOverrides = {}) => ({
  aiService: { ...createMockBaseService(), ...baseOverrides },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  configService: {
    get: vi.fn().mockReturnValue(null),
  },
});

describe('UnifiedAIService', () => {
  let service;
  let deps;

  beforeEach(() => {
    deps = createMockDeps();
    service = new UnifiedAIService(deps);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default configuration', () => {
      expect(service.maxRetries).toBe(2);
      expect(service.baseBackoffMs).toBe(400);
      expect(service.maxConcurrency).toBe(6);
    });

    it('should respect environment variable overrides', () => {
      process.env.AI_MAX_RETRIES = '5';
      process.env.AI_RETRY_BASE_MS = '1000';
      process.env.AI_MAX_CONCURRENCY = '10';

      const customService = new UnifiedAIService(deps);

      expect(customService.maxRetries).toBe(5);
      expect(customService.baseBackoffMs).toBe(1000);
      expect(customService.maxConcurrency).toBe(10);

      // Clean up
      delete process.env.AI_MAX_RETRIES;
      delete process.env.AI_RETRY_BASE_MS;
      delete process.env.AI_MAX_CONCURRENCY;
    });

    it('should store base AI service reference', () => {
      expect(service.base).toBe(deps.aiService);
    });
  });

  describe('unwrap', () => {
    it('should return null for null input', () => {
      expect(UnifiedAIService.unwrap(null)).toBeNull();
    });

    it('should return string as-is', () => {
      expect(UnifiedAIService.unwrap('hello')).toBe('hello');
    });

    it('should extract text from object envelope', () => {
      expect(UnifiedAIService.unwrap({ text: 'response' })).toBe('response');
    });

    it('should return null for object without text', () => {
      expect(UnifiedAIService.unwrap({ other: 'value' })).toBeNull();
    });

    it('should convert non-string primitives to string', () => {
      expect(UnifiedAIService.unwrap(123)).toBe('123');
    });
  });

  describe('_toEnvelope', () => {
    it('should create envelope from string', () => {
      const result = service._toEnvelope('Simple response', { model: 'gpt-4', provider: 'OpenRouter' });

      expect(result).toMatchObject({
        text: 'Simple response',
        reasoning: null,
        toolCalls: null,
        model: 'gpt-4',
        provider: 'OpenRouter',
        error: null,
      });
    });

    it('should extract reasoning from <think> tags', () => {
      const rawResponse = '<think>Let me think about this...</think>The answer is 42.';
      
      const result = service._toEnvelope(rawResponse, { model: 'claude', provider: 'Anthropic' });

      expect(result.text).toBe('The answer is 42.');
      expect(result.reasoning).toBe('Let me think about this...');
    });

    it('should handle multiple <think> blocks', () => {
      const rawResponse = '<think>First thought</think>Middle <think>Second thought</think>End';
      
      const result = service._toEnvelope(rawResponse, { model: 'claude', provider: 'Anthropic' });

      expect(result.text).toBe('Middle End');
      expect(result.reasoning).toContain('First thought');
      expect(result.reasoning).toContain('Second thought');
    });

    it('should pass through existing envelope', () => {
      const envelope = {
        text: 'Already formatted',
        provider: 'ExistingProvider',
        model: 'existing-model',
        usage: { tokens: 100 },
      };

      const result = service._toEnvelope(envelope, { model: 'new-model', provider: 'NewProvider' });

      expect(result.text).toBe('Already formatted');
      // Should preserve existing values but allow override
    });

    it('should handle null response', () => {
      const result = service._toEnvelope(null, { model: 'gpt-4', provider: 'OpenRouter' });

      expect(result.text).toBeNull();
      expect(result.error).toMatchObject({
        code: 'NO_CONTENT',
        message: 'Empty response',
      });
    });

    it('should estimate tokens', () => {
      const result = service._toEnvelope('This is a test response with some words.', { model: 'gpt-4', provider: 'OpenRouter' });

      expect(result.usage).toBeDefined();
      expect(result.usage.completionTokens).toBeGreaterThan(0);
    });
  });

  describe('chat', () => {
    it('should call base service chat method', async () => {
      const messages = [{ role: 'user', content: 'Hello' }];
      
      await service.chat(messages, { model: 'gpt-4' });

      expect(deps.aiService.chat).toHaveBeenCalledWith(
        messages,
        expect.objectContaining({ model: 'gpt-4', returnEnvelope: true })
      );
    });

    it('should return normalized envelope', async () => {
      deps.aiService.chat.mockResolvedValue({ text: 'Response' });

      const result = await service.chat([{ role: 'user', content: 'Hello' }]);

      expect(result).toMatchObject({
        text: 'Response',
        error: null,
      });
      expect(result.usage).toBeDefined();
      expect(result.usage.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should retry on retryable errors', async () => {
      const error = new Error('Rate limit exceeded');
      error.status = 429;

      deps.aiService.chat
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ text: 'Success after retry' });

      const result = await service.chat([{ role: 'user', content: 'Hello' }]);

      expect(result.text).toBe('Success after retry');
      expect(deps.aiService.chat).toHaveBeenCalledTimes(2);
    });

    it('should not retry on non-retryable errors', async () => {
      const error = new Error('Unauthorized');
      error.status = 401;

      deps.aiService.chat.mockRejectedValue(error);

      const result = await service.chat([{ role: 'user', content: 'Hello' }]);

      expect(result.error).toMatchObject({
        code: 'AUTH',
      });
      expect(deps.aiService.chat).toHaveBeenCalledTimes(1);
    });

    it('should include correlation ID in response', async () => {
      const result = await service.chat(
        [{ role: 'user', content: 'Hello' }],
        { corrId: 'test-correlation-123' }
      );

      expect(result.corrId).toBe('test-correlation-123');
    });

    it('should track retry attempts in response', async () => {
      const error = new Error('Server error');
      error.status = 500;

      deps.aiService.chat
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ text: 'Success' });

      const result = await service.chat([{ role: 'user', content: 'Hello' }]);

      expect(result.usage.attempts).toBe(2);
      expect(result.meta?.recovered).toBe(true);
    });

    it('should respect max retries', async () => {
      const error = new Error('Server error');
      error.status = 500;

      deps.aiService.chat.mockRejectedValue(error);
      service.maxRetries = 2;

      const result = await service.chat([{ role: 'user', content: 'Hello' }]);

      // Should attempt 1 + 2 retries = 3 total
      expect(deps.aiService.chat).toHaveBeenCalledTimes(3);
      expect(result.error).toBeDefined();
    });
  });

  describe('_classifyError', () => {
    it('should classify 401 as AUTH', () => {
      const result = service._classifyError({ status: 401 });
      expect(result.code).toBe('AUTH');
      expect(result.retryable).toBe(false);
    });

    it('should classify 403 as FORBIDDEN', () => {
      const result = service._classifyError({ status: 403 });
      expect(result.code).toBe('FORBIDDEN');
      expect(result.retryable).toBe(false);
    });

    it('should classify 400 as INVALID_REQUEST', () => {
      const result = service._classifyError({ status: 400 });
      expect(result.code).toBe('INVALID_REQUEST');
      expect(result.retryable).toBe(false);
    });

    it('should classify 404 as NOT_FOUND', () => {
      const result = service._classifyError({ status: 404 });
      expect(result.code).toBe('NOT_FOUND');
      expect(result.retryable).toBe(false);
    });

    it('should classify 429 as RATE_LIMIT (retryable)', () => {
      const result = service._classifyError({ status: 429 });
      expect(result.code).toBe('RATE_LIMIT');
      expect(result.retryable).toBe(true);
    });

    it('should classify 5xx as SERVER_ERROR (retryable)', () => {
      const result500 = service._classifyError({ status: 500 });
      const result503 = service._classifyError({ status: 503 });

      expect(result500.code).toBe('SERVER_ERROR');
      expect(result500.retryable).toBe(true);
      expect(result503.code).toBe('SERVER_ERROR');
      expect(result503.retryable).toBe(true);
    });

    it('should classify timeout message as NETWORK (retryable)', () => {
      const result = service._classifyError({ message: 'Request timeout' });
      expect(result.code).toBe('NETWORK');
      expect(result.retryable).toBe(true);
    });

    it('should classify network error message as NETWORK (retryable)', () => {
      const result = service._classifyError({ message: 'Network error' });
      expect(result.code).toBe('NETWORK');
      expect(result.retryable).toBe(true);
    });

    it('should parse retry-after header', () => {
      const result = service._classifyError({
        status: 429,
        response: { headers: { 'retry-after': '5' } },
      });

      expect(result.retryAfterMs).toBe(5000);
    });
  });

  describe('_computeBackoff', () => {
    it('should use retry-after if provided', () => {
      const result = service._computeBackoff(0, 5000);
      expect(result).toBe(5000);
    });

    it('should compute exponential backoff', () => {
      const attempt0 = service._computeBackoff(0, null);
      const attempt1 = service._computeBackoff(1, null);
      const attempt2 = service._computeBackoff(2, null);

      // Each attempt should roughly double (with jitter)
      expect(attempt1).toBeGreaterThan(attempt0);
      expect(attempt2).toBeGreaterThan(attempt1);
    });

    it('should include jitter', () => {
      // Run multiple times and check for variation
      const results = Array.from({ length: 10 }, () => service._computeBackoff(1, null));
      const unique = new Set(results);

      // Should have some variation due to jitter
      expect(unique.size).toBeGreaterThan(1);
    });
  });

  describe('_estimateTokens', () => {
    it('should estimate completion tokens from text length', () => {
      const env = { text: 'This is a test response' };
      service._estimateTokens(env);

      expect(env.usage.completionTokens).toBeGreaterThan(0);
    });

    it('should include reasoning tokens', () => {
      const env = { text: 'Response', reasoning: 'This is my reasoning' };
      service._estimateTokens(env);

      // Should include both text and reasoning
      expect(env.usage.completionTokens).toBeGreaterThan(3);
    });

    it('should handle empty text', () => {
      const env = { text: '' };
      service._estimateTokens(env);

      expect(env.usage).toBeDefined();
    });

    it('should handle null text', () => {
      const env = { text: null };
      service._estimateTokens(env);

      // Should not throw
      expect(env).toBeDefined();
    });
  });

  describe('concurrency control', () => {
    it('should limit concurrent requests', async () => {
      service.maxConcurrency = 2;
      let inFlight = 0;
      let maxInFlight = 0;

      deps.aiService.chat.mockImplementation(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise(r => setTimeout(r, 50));
        inFlight--;
        return { text: 'Response' };
      });

      // Fire 5 concurrent requests
      const promises = Array.from({ length: 5 }, () =>
        service.chat([{ role: 'user', content: 'Hello' }])
      );

      await Promise.all(promises);

      expect(maxInFlight).toBeLessThanOrEqual(2);
    });

    it('should release slots on error', async () => {
      service.maxConcurrency = 1;
      service.maxRetries = 0;

      deps.aiService.chat
        .mockRejectedValueOnce(new Error('First error'))
        .mockResolvedValueOnce({ text: 'Second success' });

      // First request will error
      await service.chat([{ role: 'user', content: 'Hello' }]);
      
      // Second request should still work (slot was released)
      const result = await service.chat([{ role: 'user', content: 'Hello' }]);

      expect(result.text).toBe('Second success');
    });
  });

  describe('structured', () => {
    it('should call base service generateStructuredOutput', async () => {
      const result = await service.structured({
        prompt: 'Generate JSON',
        schema: { type: 'object' },
      });

      expect(deps.aiService.generateStructuredOutput).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Generate JSON',
          schema: { type: 'object' },
        })
      );
    });

    it('should handle base service without generateStructuredOutput', async () => {
      delete deps.aiService.generateStructuredOutput;
      const newService = new UnifiedAIService(deps);

      // Should not throw, may return undefined or fallback
      await expect(newService.structured({
        prompt: 'Generate JSON',
        schema: { type: 'object' },
      })).resolves.not.toThrow;
    });
  });
});

describe('UnifiedAIService - Error Scenarios', () => {
  let service;
  let deps;

  beforeEach(() => {
    deps = createMockDeps();
    service = new UnifiedAIService(deps);
    service.maxRetries = 0; // Disable retries for faster tests
  });

  it('should handle malformed response', async () => {
    deps.aiService.chat.mockResolvedValue(undefined);

    const result = await service.chat([{ role: 'user', content: 'Hello' }]);

    expect(result.error).toBeDefined();
    expect(result.error.code).toBe('NO_CONTENT');
  });

  it('should handle exception during envelope creation', async () => {
    deps.aiService.chat.mockResolvedValue({
      get text() {
        throw new Error('Property access error');
      },
    });

    // Should not throw, should return error envelope
    const result = await service.chat([{ role: 'user', content: 'Hello' }]);

    expect(result).toBeDefined();
  });

  it('should log errors appropriately', async () => {
    const error = new Error('Test error');
    error.status = 400;
    deps.aiService.chat.mockRejectedValue(error);

    await service.chat([{ role: 'user', content: 'Hello' }]);

    expect(deps.logger.warn).toHaveBeenCalled();
  });
});
