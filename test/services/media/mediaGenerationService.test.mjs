/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/services/media/mediaGenerationService.test.mjs
 * @description Unit tests for MediaGenerationService
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MediaGenerationService } from '../../../src/services/media/mediaGenerationService.mjs';
import { 
  MediaGenerationError, 
  RateLimitError, 
  ServiceUnavailableError,
  MediaErrorCodes 
} from '../../../src/utils/errors.mjs';

// Mock dependencies
const createMockLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
});

const createMockGoogleAIService = (overrides = {}) => ({
  generateImage: vi.fn().mockResolvedValue('https://example.com/generated-image.png'),
  composeImageWithGemini: vi.fn().mockResolvedValue('https://example.com/composed-image.png'),
  ...overrides
});

const createMockVeoService = (overrides = {}) => ({
  generateVideos: vi.fn().mockResolvedValue(['https://example.com/video1.mp4']),
  generateVideosFromImages: vi.fn().mockResolvedValue(['https://example.com/video2.mp4']),
  generateVideosWithReferenceImages: vi.fn().mockResolvedValue(['https://example.com/video3.mp4']),
  extendVideo: vi.fn().mockResolvedValue('https://example.com/extended.mp4'),
  ...overrides
});

const createMockAIService = (overrides = {}) => ({
  generateImage: vi.fn().mockResolvedValue('https://example.com/ai-image.png'),
  ...overrides
});

describe('MediaGenerationService', () => {
  let service;
  let mockLogger;
  let mockGoogleAIService;
  let mockVeoService;
  let mockAIService;

  beforeEach(() => {
    vi.useFakeTimers();
    mockLogger = createMockLogger();
    mockGoogleAIService = createMockGoogleAIService();
    mockVeoService = createMockVeoService();
    mockAIService = createMockAIService();

    service = new MediaGenerationService({
      googleAIService: mockGoogleAIService,
      veoService: mockVeoService,
      aiService: mockAIService,
      logger: mockLogger
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with default configuration', () => {
      const svc = new MediaGenerationService({
        googleAIService: mockGoogleAIService,
        logger: mockLogger
      });
      
      expect(svc.config.aspectRatio).toBe('16:9');
      expect(svc.config.retry.maxAttempts).toBe(3);
      expect(svc.config.circuitBreaker.failureThreshold).toBe(5);
    });

    it('should merge custom configuration', () => {
      const svc = new MediaGenerationService({
        googleAIService: mockGoogleAIService,
        logger: mockLogger,
        config: {
          aspectRatio: '16:9',
          retry: { maxAttempts: 5 }
        }
      });
      
      expect(svc.config.aspectRatio).toBe('16:9');
      expect(svc.config.retry.maxAttempts).toBe(5);
      expect(svc.config.retry.baseDelayMs).toBe(1000); // Still uses default
    });

    it('should initialize empty circuit breakers map', () => {
      expect(service._circuitBreakers).toBeInstanceOf(Map);
      expect(service._circuitBreakers.size).toBe(0);
    });

    it('should work without any services', () => {
      const svc = new MediaGenerationService({ logger: mockLogger });
      expect(svc.isAvailable('image')).toBe(false);
      expect(svc.isAvailable('video')).toBe(false);
    });
  });

  describe('generateImage', () => {
    it('should generate image successfully with default options', async () => {
      const result = await service.generateImage('A beautiful sunset');
      
      expect(result).toHaveProperty('imageUrl');
      expect(result).toHaveProperty('enhancedPrompt');
      expect(result).toHaveProperty('traceId');
      expect(result.imageUrl).toBe('https://example.com/generated-image.png');
    });

    it('should use provided trace ID', async () => {
      const result = await service.generateImage('Test prompt', {
        traceId: 'trc_custom_123'
      });
      
      expect(result.traceId).toBe('trc_custom_123');
    });

    it('should apply character design to prompt', async () => {
      await service.generateImage('sitting in a cafe', {
        characterDesign: {
          enabled: true,
          characterName: 'Luna',
          characterDescription: 'a purple-haired anime girl',
          imagePromptPrefix: 'Show {{characterName}} ({{characterDescription}}) '
        }
      });

      expect(mockGoogleAIService.generateImage).toHaveBeenCalledWith(
        expect.stringContaining('Luna'),
        '16:9',
        expect.any(Object)
      );
    });

    it('should add reference image from character design', async () => {
      // Mock the image data fetch for reference image
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
        headers: { get: () => 'image/png' }
      });

      await service.generateImage('test prompt', {
        characterDesign: {
          enabled: true,
          referenceImageUrl: 'https://example.com/ref.png'
        }
      });

      // Should use composition when reference images present
      expect(mockGoogleAIService.composeImageWithGemini).toHaveBeenCalled();
    });

    it('should fetch binary when requested', async () => {
      // Mock fetch for binary download
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
        headers: { get: () => 'image/png' }
      });

      const result = await service.generateImage('test', { fetchBinary: true });
      
      expect(result.binary).toBeDefined();
      expect(result.binary.data).toBeDefined();
      expect(result.binary.mimeType).toBe('image/png');
    });

    it('should fallback to aiService when googleAIService fails', async () => {
      // Create a service with no retries for this test
      const fastService = new MediaGenerationService({
        googleAIService: mockGoogleAIService,
        veoService: mockVeoService,
        aiService: mockAIService,
        logger: mockLogger,
        config: {
          retry: { maxAttempts: 1, baseDelayMs: 1 }
        }
      });
      
      mockGoogleAIService.generateImage.mockRejectedValue(new Error('Gemini unavailable'));
      
      const result = await fastService.generateImage('test prompt');
      
      expect(mockAIService.generateImage).toHaveBeenCalled();
      expect(result.imageUrl).toBe('https://example.com/ai-image.png');
    });

    it('should throw when service is exhausted', async () => {
      // Exhaust the service
      service._markServiceExhausted('image', 60000);
      
      await expect(service.generateImage('test')).rejects.toThrow(MediaGenerationError);
    });

    it('should throw when all providers fail', async () => {
      // Create a service with no retries for this test
      const fastService = new MediaGenerationService({
        googleAIService: mockGoogleAIService,
        veoService: mockVeoService,
        aiService: mockAIService,
        logger: mockLogger,
        config: {
          retry: { maxAttempts: 1, baseDelayMs: 1 }
        }
      });
      
      mockGoogleAIService.generateImage.mockRejectedValue(new Error('Gemini failed'));
      mockGoogleAIService.composeImageWithGemini.mockRejectedValue(new Error('Composition failed'));
      mockAIService.generateImage.mockRejectedValue(new Error('AI Service failed'));

      await expect(fastService.generateImage('test')).rejects.toThrow();
    });

    it('should handle quota errors and mark service exhausted', async () => {
      const quotaError = new RateLimitError('Quota exceeded');
      mockGoogleAIService.generateImage.mockRejectedValue(quotaError);
      mockAIService.generateImage.mockRejectedValue(quotaError);

      await expect(service.generateImage('test')).rejects.toThrow(RateLimitError);
      expect(service._isServiceExhausted('image')).toBe(true);
    });
  });

  describe('generateVideo', () => {
    it('should generate video successfully with text-only prompt', async () => {
      const result = await service.generateVideo('A cat walking');
      
      expect(result).toHaveProperty('videoUrl');
      expect(result).toHaveProperty('enhancedPrompt');
      expect(result).toHaveProperty('traceId');
      expect(result).toHaveProperty('strategiesAttempted');
    });

    it('should throw when veoService is not available', async () => {
      const svc = new MediaGenerationService({
        googleAIService: mockGoogleAIService,
        logger: mockLogger
        // No veoService
      });

      await expect(svc.generateVideo('test')).rejects.toThrow(ServiceUnavailableError);
    });

    it('should use keyframe strategy when keyframeImage provided', async () => {
      const result = await service.generateVideo('test', {
        keyframeImage: {
          data: 'base64data',
          mimeType: 'image/png'
        }
      });

      expect(mockVeoService.generateVideosFromImages).toHaveBeenCalled();
      expect(result.keyframeUsed).toBe(true);
      expect(result.strategiesAttempted).toContain('image_to_video');
    });

    it('should NOT auto-generate keyframe when none provided (cost optimization)', async () => {
      // Without a keyframeImage, the service should skip directly to text-to-video
      const result = await service.generateVideo('test prompt');

      // Should NOT call generateImage to create a keyframe
      expect(mockGoogleAIService.generateImage).not.toHaveBeenCalled();
      // Should use text-to-video strategy directly
      expect(mockVeoService.generateVideos).toHaveBeenCalled();
      expect(result.strategiesAttempted).toContain('text_to_video');
    });

    it('should use reference images when available', async () => {
      // Mock image download
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
        headers: { get: () => 'image/png' }
      });

      const result = await service.generateVideo('test', {
        referenceImages: ['https://example.com/ref.png']
      });

      expect(mockVeoService.generateVideosWithReferenceImages).toHaveBeenCalled();
      expect(result.strategiesAttempted).toContain('reference_image');
    });

    it('should use text-to-video as primary default strategy', async () => {
      // Without keyframe or reference images, text-to-video is the default
      const result = await service.generateVideo('a cat playing');

      expect(mockVeoService.generateVideos).toHaveBeenCalled();
      expect(result.strategiesAttempted).toContain('text_to_video');
    });

    it('should fallback to text-to-video when reference images fail', async () => {
      // Mock image download
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
        headers: { get: () => 'image/png' }
      });
      
      // Reference images fail
      mockVeoService.generateVideosWithReferenceImages.mockResolvedValue([]);
      
      const result = await service.generateVideo('test', {
        referenceImages: ['https://example.com/ref.png']
      });

      expect(mockVeoService.generateVideos).toHaveBeenCalled();
      expect(result.strategiesAttempted).toContain('text_to_video');
    });

    it('should throw when service is exhausted', async () => {
      service._markServiceExhausted('video', 60000);
      
      await expect(service.generateVideo('test')).rejects.toThrow(MediaGenerationError);
    });

    it('should apply character design to video prompt', async () => {
      await service.generateVideo('walking in park', {
        characterDesign: {
          enabled: true,
          characterName: 'Max',
          characterDescription: 'a golden retriever',
          imagePromptPrefix: 'Show {{characterName}} ({{characterDescription}}) '
        }
      });

      const calls = mockVeoService.generateVideosFromImages.mock.calls;
      if (calls.length > 0) {
        expect(calls[0][0].prompt).toContain('Max');
      } else {
        expect(mockVeoService.generateVideos).toHaveBeenCalledWith(
          expect.objectContaining({
            prompt: expect.stringContaining('Max')
          })
        );
      }
    });
  });

  describe('extendVideo', () => {
    it('should extend video successfully', async () => {
      const result = await service.extendVideo(
        'https://example.com/source.mp4',
        'Continue the scene'
      );

      expect(mockVeoService.extendVideo).toHaveBeenCalled();
      expect(result).toHaveProperty('videoUrl');
    });

    it('should throw when extendVideo is not available', async () => {
      const svc = new MediaGenerationService({
        googleAIService: mockGoogleAIService,
        veoService: { ...mockVeoService, extendVideo: undefined },
        logger: mockLogger
      });

      await expect(
        svc.extendVideo('https://example.com/source.mp4', 'continue')
      ).rejects.toThrow(ServiceUnavailableError);
    });
  });

  describe('editImage', () => {
    it('should edit image successfully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
        headers: { get: () => 'image/png' }
      });

      const result = await service.editImage(
        { url: 'https://example.com/source.png' },
        'Make the sky blue'
      );

      expect(mockGoogleAIService.composeImageWithGemini).toHaveBeenCalled();
      expect(result).toHaveProperty('imageUrl');
    });

    it('should handle inline image data', async () => {
      const result = await service.editImage(
        { data: 'base64data', mimeType: 'image/png' },
        'Add clouds'
      );

      expect(mockGoogleAIService.composeImageWithGemini).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ data: 'base64data', mimeType: 'image/png' })
        ]),
        'Add clouds',
        expect.any(Object)
      );
    });

    it('should throw when source image is not found', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, statusText: 'Not Found' });

      await expect(
        service.editImage({ url: 'https://example.com/missing.png' }, 'edit')
      ).rejects.toThrow(MediaGenerationError);
    });
  });

  describe('isAvailable', () => {
    it('should return true for image when googleAIService available', () => {
      expect(service.isAvailable('image')).toBe(true);
    });

    it('should return true for image when only aiService available', () => {
      const svc = new MediaGenerationService({
        aiService: mockAIService,
        logger: mockLogger
      });
      expect(svc.isAvailable('image')).toBe(true);
    });

    it('should return true for video when veoService available', () => {
      expect(service.isAvailable('video')).toBe(true);
    });

    it('should return false when service exhausted', () => {
      service._markServiceExhausted('image', 60000);
      expect(service.isAvailable('image')).toBe(false);
    });

    it('should return false for video without veoService', () => {
      const svc = new MediaGenerationService({
        googleAIService: mockGoogleAIService,
        logger: mockLogger
      });
      expect(svc.isAvailable('video')).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('should return complete status object', () => {
      const status = service.getStatus();

      expect(status).toHaveProperty('image');
      expect(status).toHaveProperty('video');
      expect(status.image).toHaveProperty('available');
      expect(status.image).toHaveProperty('exhausted');
      expect(status.image).toHaveProperty('providers');
      expect(status.video).toHaveProperty('circuitState');
    });

    it('should reflect exhausted services', () => {
      service._markServiceExhausted('video', 60000);
      
      const status = service.getStatus();
      
      expect(status.video.exhausted).toBe(true);
      expect(status.video.exhaustedUntil).toBeDefined();
    });
  });

  describe('Circuit Breaker', () => {
    it('should open circuit after threshold failures', () => {
      const providerName = 'gemini';
      
      // Simulate failures
      for (let i = 0; i < 5; i++) {
        service._recordFailure(providerName, new Error('Test failure'));
      }

      expect(service._getCircuitState(providerName)).toBe('OPEN');
      expect(service._checkCircuitBreaker(providerName)).toBe(false);
    });

    it('should transition to half-open after reset timeout', () => {
      const providerName = 'gemini';
      
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        service._recordFailure(providerName, new Error('Test failure'));
      }

      // Advance time past reset timeout
      vi.advanceTimersByTime(61000);

      expect(service._checkCircuitBreaker(providerName)).toBe(true);
      expect(service._getCircuitState(providerName)).toBe('HALF_OPEN');
    });

    it('should close circuit after successful recovery', () => {
      const providerName = 'gemini';
      
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        service._recordFailure(providerName, new Error('Test failure'));
      }

      // Advance time and allow half-open
      vi.advanceTimersByTime(61000);
      service._checkCircuitBreaker(providerName);

      // Record success during half-open
      service._recordSuccess(providerName);

      expect(service._getCircuitState(providerName)).toBe('CLOSED');
    });

    it('should re-open circuit if failure during half-open', () => {
      const providerName = 'gemini';
      
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        service._recordFailure(providerName, new Error('Test failure'));
      }

      // Advance time and allow half-open
      vi.advanceTimersByTime(61000);
      service._checkCircuitBreaker(providerName);

      // Record failure during half-open
      service._recordFailure(providerName, new Error('Still failing'));

      expect(service._getCircuitState(providerName)).toBe('OPEN');
    });

    it('should limit half-open requests', () => {
      const providerName = 'gemini';
      
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        service._recordFailure(providerName, new Error('Test failure'));
      }

      // Advance time to half-open
      vi.advanceTimersByTime(61000);

      // First call transitions OPEN -> HALF_OPEN and returns true (doesn't count)
      expect(service._checkCircuitBreaker(providerName)).toBe(true);
      // Next 3 calls increment halfOpenRequests (0->1, 1->2, 2->3) and return true
      expect(service._checkCircuitBreaker(providerName)).toBe(true);
      expect(service._checkCircuitBreaker(providerName)).toBe(true);
      expect(service._checkCircuitBreaker(providerName)).toBe(true);
      // 5th call: halfOpenRequests >= 3, returns false
      expect(service._checkCircuitBreaker(providerName)).toBe(false);
    });
  });

  describe('Service Exhaustion', () => {
    it('should mark service as exhausted', () => {
      service._markServiceExhausted('image', 60000);
      
      expect(service._isServiceExhausted('image')).toBe(true);
      expect(service._isServiceExhausted('video')).toBe(false);
    });

    it('should clear exhaustion after duration', () => {
      service._markServiceExhausted('image', 60000);
      
      expect(service._isServiceExhausted('image')).toBe(true);
      
      vi.advanceTimersByTime(61000);
      
      expect(service._isServiceExhausted('image')).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle quota errors correctly', () => {
      expect(service._isQuotaError({ status: 429 })).toBe(true);
      expect(service._isQuotaError({ status: 'RESOURCE_EXHAUSTED' })).toBe(true);
      expect(service._isQuotaError({ message: 'quota exceeded' })).toBe(true);
      expect(service._isQuotaError({ message: 'rate limit reached' })).toBe(true);
      expect(service._isQuotaError({ message: 'normal error' })).toBe(false);
    });
  });

  describe('Character Design Application', () => {
    it('should replace template variables in prefix', () => {
      const result = service._applyCharacterPrompt('walking in park', {
        enabled: true,
        characterName: 'Luna',
        characterDescription: 'a purple-haired girl',
        imagePromptPrefix: 'Show {{characterName}} ({{characterDescription}}) doing: '
      });

      expect(result).toBe('Show Luna (a purple-haired girl) doing: walking in park');
    });

    it('should handle missing character design', () => {
      const result = service._applyCharacterPrompt('test prompt', null);
      expect(result).toBe('test prompt');
    });

    it('should handle disabled character design', () => {
      const result = service._applyCharacterPrompt('test prompt', { enabled: false });
      expect(result).toBe('test prompt');
    });

    it('should handle missing template variables gracefully', () => {
      const result = service._applyCharacterPrompt('walking', {
        enabled: true,
        imagePromptPrefix: 'Show {{characterName}} doing: '
        // Missing characterName
      });

      expect(result).toBe('Show  doing: walking'); // Empty but no crash
    });
  });

  describe('Provider Selection', () => {
    it('should prioritize gemini for image generation', () => {
      const providers = service._getImageProviders();
      
      expect(providers[0].name).toBe('gemini');
      expect(providers[0].supportsComposition).toBe(true);
    });

    it('should include aiService as fallback', () => {
      const providers = service._getImageProviders();
      
      const aiProvider = providers.find(p => p.name === 'aiService');
      expect(aiProvider).toBeDefined();
      expect(aiProvider.supportsComposition).toBe(false);
    });

    it('should handle missing services', () => {
      const svc = new MediaGenerationService({ logger: mockLogger });
      const providers = svc._getImageProviders();
      
      expect(providers).toHaveLength(0);
    });
  });
});
