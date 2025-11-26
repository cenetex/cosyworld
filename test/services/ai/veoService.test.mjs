/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file test/services/ai/veoService.test.mjs
 * @description Unit tests for VeoService
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { VeoService } from '../../../src/services/ai/veoService.mjs';

// Mock @google/genai
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateVideos: vi.fn().mockResolvedValue({
        name: 'operations/test-op-123',
        done: true,
        response: {
          generatedVideos: [{
            video: { uri: 'https://storage.googleapis.com/test-video.mp4' }
          }]
        }
      })
    },
    operations: {
      getVideosOperation: vi.fn(),
      getOperation: vi.fn()
    }
  })),
  GenerateVideosOperation: vi.fn().mockImplementation(() => ({}))
}));

// Mock eventBus
vi.mock('../../../src/utils/eventBus.mjs', () => ({
  default: {
    emit: vi.fn()
  }
}));

// Create mock dependencies
const createMockConfigService = () => ({
  config: {
    ai: {
      google: { apiKey: 'test-api-key' },
      veo: {
        rateLimit: {
          perMinute: 1,
          perDay: 10,
          globalCap: 10
        }
      }
    }
  }
});

const createMockLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
});

const createMockS3Service = () => ({
  downloadImage: vi.fn().mockResolvedValue(Buffer.from('video-data')),
  uploadImage: vi.fn().mockResolvedValue('https://s3.example.com/uploaded-video.mp4')
});

const createMockDatabaseService = () => {
  const mockCollection = {
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'test-id' }),
    updateOne: vi.fn().mockResolvedValue({}),
    countDocuments: vi.fn().mockResolvedValue(0),
    find: vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([])
    })
  };

  return {
    getDatabase: vi.fn().mockResolvedValue({
      collection: vi.fn().mockReturnValue(mockCollection)
    }),
    _mockCollection: mockCollection
  };
};

describe('VeoService', () => {
  let service;
  let mockConfigService;
  let mockLogger;
  let mockS3Service;
  let mockDatabaseService;

  beforeEach(() => {
    vi.useFakeTimers();
    mockConfigService = createMockConfigService();
    mockLogger = createMockLogger();
    mockS3Service = createMockS3Service();
    mockDatabaseService = createMockDatabaseService();

    service = new VeoService({
      configService: mockConfigService,
      logger: mockLogger,
      s3Service: mockS3Service,
      databaseService: mockDatabaseService
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with provided dependencies', () => {
      expect(service.configService).toBe(mockConfigService);
      expect(service.logger).toBe(mockLogger);
      expect(service.s3Service).toBe(mockS3Service);
      expect(service.databaseService).toBe(mockDatabaseService);
    });

    it('should set global daily cap from config', () => {
      expect(service.GLOBAL_DAILY_CAP).toBe(10);
    });

    it('should use default global cap when not configured', () => {
      const svc = new VeoService({
        configService: { config: { ai: { google: { apiKey: 'test' } } } },
        logger: mockLogger,
        databaseService: mockDatabaseService
      });
      expect(svc.GLOBAL_DAILY_CAP).toBe(3);
    });

    it('should initialize AI client', () => {
      expect(service.ai).toBeDefined();
    });
  });

  describe('enhanceVideoPrompt', () => {
    it('should enhance prompt with all options', () => {
      const result = service.enhanceVideoPrompt('A dog running', {
        style: 'cinematic',
        camera: 'dolly shot',
        ambiance: 'golden hour lighting',
        audioHints: 'barking sounds',
        characterDescription: 'a golden retriever'
      });

      expect(result).toContain('cinematic style video');
      expect(result).toContain('Camera: dolly shot');
      expect(result).toContain('The subject is a golden retriever');
      expect(result).toContain('A dog running');
      expect(result).toContain('The atmosphere is golden hour lighting');
      expect(result).toContain('Audio: barking sounds');
    });

    it('should handle minimal options', () => {
      const result = service.enhanceVideoPrompt('Simple prompt', {});
      expect(result).toBe('Simple prompt');
    });

    it('should handle partial options', () => {
      const result = service.enhanceVideoPrompt('A cat sleeping', {
        style: 'documentary'
      });

      expect(result).toContain('documentary style video');
      expect(result).toContain('A cat sleeping');
      expect(result).not.toContain('Camera:');
    });
  });

  describe('buildNegativePrompt', () => {
    it('should include default elements', () => {
      const result = service.buildNegativePrompt([]);
      
      expect(result).toContain('low quality');
      expect(result).toContain('blurry');
      expect(result).toContain('distorted faces');
      expect(result).toContain('artifacts');
    });

    it('should combine defaults with custom elements', () => {
      const result = service.buildNegativePrompt(['watermark', 'text overlay']);
      
      expect(result).toContain('watermark');
      expect(result).toContain('text overlay');
      expect(result).toContain('low quality');
    });

    it('should deduplicate elements', () => {
      const result = service.buildNegativePrompt(['blurry', 'custom']);
      
      const parts = result.split(', ');
      const blurryCount = parts.filter(p => p === 'blurry').length;
      expect(blurryCount).toBe(1);
    });
  });

  describe('checkRateLimit', () => {
    it('should allow generation when under limits', async () => {
      mockDatabaseService._mockCollection.countDocuments.mockResolvedValue(0);
      
      const result = await service.checkRateLimit();
      
      expect(result).toBe(true);
    });

    it('should deny when per-minute limit exceeded', async () => {
      mockDatabaseService._mockCollection.countDocuments
        .mockResolvedValueOnce(1) // Per-minute count
        .mockResolvedValueOnce(0); // Daily count
      
      const result = await service.checkRateLimit();
      
      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Per-minute rate limit exceeded')
      );
    });

    it('should deny when daily limit exceeded', async () => {
      mockDatabaseService._mockCollection.countDocuments
        .mockResolvedValueOnce(0) // Per-minute count
        .mockResolvedValueOnce(10); // Daily count (at limit)
      
      const result = await service.checkRateLimit();
      
      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Per-day rate limit exceeded')
      );
    });

    it('should deny when global cap exceeded', async () => {
      mockDatabaseService._mockCollection.countDocuments
        .mockResolvedValueOnce(0) // Per-minute count
        .mockResolvedValueOnce(10); // Daily count (at global cap)
      
      const result = await service.checkRateLimit();
      
      expect(result).toBe(false);
    });

    it('should fail closed on database error', async () => {
      mockDatabaseService._mockCollection.countDocuments.mockRejectedValue(
        new Error('Database error')
      );
      
      const result = await service.checkRateLimit();
      
      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('generateVideosFromImages', () => {
    it('should throw when AI client not initialized', async () => {
      service.ai = null;
      
      await expect(service.generateVideosFromImages({
        prompt: 'test',
        images: [{ data: 'base64', mimeType: 'image/png' }]
      })).rejects.toThrow('Veo AI client not initialized');
    });

    it('should throw when no images provided', async () => {
      await expect(service.generateVideosFromImages({
        prompt: 'test',
        images: []
      })).rejects.toThrow('At least one image is required');
    });

    it('should return empty array when rate limited', async () => {
      mockDatabaseService._mockCollection.countDocuments.mockResolvedValue(100);
      
      const result = await service.generateVideosFromImages({
        prompt: 'test',
        images: [{ data: 'base64', mimeType: 'image/png' }]
      });
      
      expect(result).toEqual([]);
    });

    it('should record generation in database', async () => {
      // Ensure rate limit passes
      mockDatabaseService._mockCollection.countDocuments.mockResolvedValue(0);
      
      await service.generateVideosFromImages({
        prompt: 'test prompt',
        images: [{ data: 'base64', mimeType: 'image/png' }]
      });

      expect(mockDatabaseService._mockCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'generate_from_images',
          status: 'started'
        })
      );
    });
  });

  describe('generateVideos', () => {
    it('should throw when no prompt provided without images', async () => {
      await expect(service.generateVideos({
        images: []
      })).rejects.toThrow('Prompt is required when no image is provided');
    });

    it('should set personGeneration based on input type', async () => {
      mockDatabaseService._mockCollection.countDocuments.mockResolvedValue(0);
      
      // Text-only should use "allow_all"
      await service.generateVideos({
        prompt: 'A sunset scene'
      });

      expect(service.ai.models.generateVideos).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            personGeneration: 'allow_all'
          })
        })
      );
    });

    it('should use "allow_adult" when images provided', async () => {
      mockDatabaseService._mockCollection.countDocuments.mockResolvedValue(0);
      
      await service.generateVideos({
        prompt: 'test',
        images: [{ data: 'base64', mimeType: 'image/png' }]
      });

      expect(service.ai.models.generateVideos).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            personGeneration: 'allow_adult'
          })
        })
      );
    });

    it('should convert durationSeconds to number', async () => {
      mockDatabaseService._mockCollection.countDocuments.mockResolvedValue(0);
      
      await service.generateVideos({
        prompt: 'test',
        config: { durationSeconds: '8' } // String
      });

      expect(service.ai.models.generateVideos).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            durationSeconds: 8 // Number
          })
        })
      );
    });
  });

  describe('generateVideosWithReferenceImages', () => {
    it('should throw when no prompt provided', async () => {
      await expect(service.generateVideosWithReferenceImages({
        referenceImages: [{ data: 'base64', mimeType: 'image/png' }]
      })).rejects.toThrow('Prompt is required');
    });

    it('should throw when no reference images', async () => {
      await expect(service.generateVideosWithReferenceImages({
        prompt: 'test',
        referenceImages: []
      })).rejects.toThrow('Must provide 1-3 reference images');
    });

    it('should throw when more than 3 reference images', async () => {
      await expect(service.generateVideosWithReferenceImages({
        prompt: 'test',
        referenceImages: [
          { data: 'img1', mimeType: 'image/png' },
          { data: 'img2', mimeType: 'image/png' },
          { data: 'img3', mimeType: 'image/png' },
          { data: 'img4', mimeType: 'image/png' }
        ]
      })).rejects.toThrow('Must provide 1-3 reference images');
    });

    it('should format reference images correctly', async () => {
      mockDatabaseService._mockCollection.countDocuments.mockResolvedValue(0);
      
      await service.generateVideosWithReferenceImages({
        prompt: 'test',
        referenceImages: [
          { data: 'base64data', mimeType: 'image/jpeg', referenceType: 'style' }
        ]
      });

      expect(service.ai.models.generateVideos).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            referenceImages: expect.arrayContaining([
              expect.objectContaining({
                referenceType: 'style'
              })
            ])
          })
        })
      );
    });

    it('should default referenceType to asset', async () => {
      mockDatabaseService._mockCollection.countDocuments.mockResolvedValue(0);
      
      await service.generateVideosWithReferenceImages({
        prompt: 'test',
        referenceImages: [
          { data: 'base64data', mimeType: 'image/png' } // No referenceType
        ]
      });

      expect(service.ai.models.generateVideos).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            referenceImages: expect.arrayContaining([
              expect.objectContaining({
                referenceType: 'asset'
              })
            ])
          })
        })
      );
    });
  });

  describe('extendVideo', () => {
    it('should throw when no video URL provided', async () => {
      await expect(service.extendVideo({
        prompt: 'continue the scene'
      })).rejects.toThrow('Video URL is required');
    });

    it('should throw when no prompt provided', async () => {
      await expect(service.extendVideo({
        videoUrl: 'https://example.com/video.mp4'
      })).rejects.toThrow('Prompt is required');
    });

    it('should download video from S3', async () => {
      mockDatabaseService._mockCollection.countDocuments.mockResolvedValue(0);
      
      await service.extendVideo({
        videoUrl: 'https://example.com/video.mp4',
        prompt: 'continue'
      });

      expect(mockS3Service.downloadImage).toHaveBeenCalledWith(
        'https://example.com/video.mp4'
      );
    });

    it('should handle download failure', async () => {
      mockDatabaseService._mockCollection.countDocuments.mockResolvedValue(0);
      mockS3Service.downloadImage.mockRejectedValue(new Error('Download failed'));
      
      await expect(service.extendVideo({
        videoUrl: 'https://example.com/video.mp4',
        prompt: 'continue'
      })).rejects.toThrow('Failed to download video');
    });
  });

  describe('generateVideosWithInterpolation', () => {
    it('should throw when no prompt provided', async () => {
      await expect(service.generateVideosWithInterpolation({
        firstFrame: { data: 'frame1', mimeType: 'image/png' },
        lastFrame: { data: 'frame2', mimeType: 'image/png' }
      })).rejects.toThrow('Prompt is required');
    });

    it('should throw when missing frames', async () => {
      await expect(service.generateVideosWithInterpolation({
        prompt: 'morph between',
        firstFrame: { data: 'frame1', mimeType: 'image/png' }
        // Missing lastFrame
      })).rejects.toThrow('Both firstFrame and lastFrame are required');
    });

    it('should include lastFrame in config', async () => {
      mockDatabaseService._mockCollection.countDocuments.mockResolvedValue(0);
      
      await service.generateVideosWithInterpolation({
        prompt: 'morph transition',
        firstFrame: { data: 'first', mimeType: 'image/png' },
        lastFrame: { data: 'last', mimeType: 'image/jpeg' }
      });

      expect(service.ai.models.generateVideos).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            lastFrame: expect.objectContaining({
              imageBytes: 'last',
              mimeType: 'image/jpeg'
            })
          })
        })
      );
    });
  });

  describe('getUsageStats', () => {
    it('should return usage statistics', async () => {
      mockDatabaseService._mockCollection.countDocuments
        .mockResolvedValueOnce(5)  // Daily count
        .mockResolvedValueOnce(2); // Hourly count
      mockDatabaseService._mockCollection.find().toArray.mockResolvedValue([
        { operation: 'generate', status: 'completed', timestamp: new Date() }
      ]);

      const stats = await service.getUsageStats();

      expect(stats).toHaveProperty('daily');
      expect(stats.daily.count).toBe(5);
      expect(stats.daily.limit).toBe(10);
      expect(stats.daily.remaining).toBe(5);
      expect(stats).toHaveProperty('hourly');
      expect(stats).toHaveProperty('recentGenerations');
    });

    it('should handle database error gracefully', async () => {
      mockDatabaseService._mockCollection.countDocuments.mockRejectedValue(
        new Error('DB error')
      );

      const stats = await service.getUsageStats();
      
      expect(stats).toBeNull();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Progress Events', () => {
    it('should emit progress events', async () => {
      const eventBus = await import('../../../src/utils/eventBus.mjs');
      mockDatabaseService._mockCollection.countDocuments.mockResolvedValue(0);
      
      await service.generateVideos({ prompt: 'test' });

      expect(eventBus.default.emit).toHaveBeenCalledWith(
        'video:progress',
        expect.objectContaining({
          type: 'video:progress',
          status: expect.any(String)
        })
      );
    });
  });

  describe('_recordGeneration', () => {
    it('should insert generation record', async () => {
      await service._recordGeneration('generate', 'started', { prompt: 'test' });

      expect(mockDatabaseService._mockCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'generate',
          status: 'started',
          timestamp: expect.any(Date),
          metadata: expect.objectContaining({
            prompt: 'test'
          })
        })
      );
    });

    it('should update daily count after insert', async () => {
      await service._recordGeneration('generate', 'completed', {});

      expect(mockDatabaseService._mockCollection.updateOne).toHaveBeenCalledWith(
        { _id: 'test-id' },
        expect.objectContaining({
          $set: { 'metadata.dailyCount': expect.any(Number) }
        })
      );
    });
  });
});
