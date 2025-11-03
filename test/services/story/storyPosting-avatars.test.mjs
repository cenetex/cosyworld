/**
 * @file Unit tests for StoryPostingService avatar handling
 * Tests the avatar lookup logic when generating media
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StoryPostingService } from '../../../src/services/story/storyPostingService.mjs';

describe('StoryPostingService - Avatar Handling', () => {
  let storyPostingService;
  let mockWorldContext;
  let mockSchemaService;
  let mockNarrativeGenerator;

  beforeEach(() => {
    mockWorldContext = {
      getAvatarsByIds: vi.fn(),
      getLocation: vi.fn()
    };

    mockSchemaService = {
      generateImage: vi.fn()
    };

    mockNarrativeGenerator = {
      generateCaption: vi.fn().mockResolvedValue('Test caption')
    };

    storyPostingService = new StoryPostingService({
      worldContextService: mockWorldContext,
      schemaService: mockSchemaService,
      narrativeGeneratorService: mockNarrativeGenerator,
      xService: {},
      telegramService: {},
      storyStateService: {},
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      }
    });
  });

  describe('Avatar lookup when beat.characters is empty', () => {
    it('should use all arc characters when beat.characters is empty', async () => {
      const mockAvatars = [
        {
          _id: '68f98007be45067d3110efec',
          name: 'Luma Velentis',
          imageUrl: 'https://example.com/luma.jpg'
        }
      ];

      mockWorldContext.getAvatarsByIds.mockResolvedValue(mockAvatars);
      mockSchemaService.generateImage.mockResolvedValue('https://example.com/generated.jpg');

      const arc = {
        characters: [
          { avatarName: 'Luma Velentis', avatarId: '68f98007be45067d3110efec' }
        ],
        locations: [],
        title: 'Test Arc',
        theme: 'Adventure',
        emotionalTone: 'Hopeful'
      };

      const beat = {
        id: 'test-beat-id',
        sequenceNumber: 1,
        description: 'A test beat',
        characters: [], // Empty characters array
        visualPrompt: 'A test scene'
      };

      // Call the private method by accessing it (beat, arc order)
      const result = await storyPostingService._generateMedia(beat, arc);

      // Check if there were any errors logged
      const errorMock = storyPostingService.logger.error;
      if (errorMock.mock.calls.length > 0) {
        console.log('Errors logged:', errorMock.mock.calls);
      }

      // Verify avatar lookup was called with the arc character's ID
      expect(mockWorldContext.getAvatarsByIds).toHaveBeenCalledWith(
        expect.arrayContaining(['68f98007be45067d3110efec'])
      );

      // Verify image generation included avatar image
      expect(mockSchemaService.generateImage).toHaveBeenCalledWith(
        'A test scene',
        '1:1',
        expect.objectContaining({
          images: expect.arrayContaining(['https://example.com/luma.jpg'])
        })
      );
    });

    it('should filter to only characters in beat.characters when specified', async () => {
      const mockAvatars = [
        {
          _id: '68f98007be45067d3110efec',
          name: 'Luma Velentis',
          imageUrl: 'https://example.com/luma.jpg'
        }
      ];

      mockWorldContext.getAvatarsByIds.mockResolvedValue(mockAvatars);
      mockSchemaService.generateImage.mockResolvedValue('https://example.com/generated.jpg');

      const arc = {
        characters: [
          { avatarName: 'Luma Velentis', avatarId: '68f98007be45067d3110efec' },
          { avatarName: 'Aiko Starshine', avatarId: '68f97308be45067d3110efd9' }
        ],
        locations: [],
        title: 'Test Arc',
        theme: 'Adventure',
        emotionalTone: 'Hopeful'
      };

      const beat = {
        id: 'test-beat-id',
        sequenceNumber: 1,
        description: 'A test beat',
        characters: ['Luma Velentis'], // Only Luma specified
        visualPrompt: 'A test scene'
      };

      await storyPostingService._generateMedia(beat, arc);

      // Should only fetch Luma, not Aiko
      expect(mockWorldContext.getAvatarsByIds).toHaveBeenCalledWith(
        ['68f98007be45067d3110efec']
      );
      expect(mockWorldContext.getAvatarsByIds).not.toHaveBeenCalledWith(
        expect.arrayContaining(['68f97308be45067d3110efd9'])
      );
    });

    it('should handle when no avatars have imageUrls', async () => {
      const mockAvatars = [
        {
          _id: '68f98007be45067d3110efec',
          name: 'Luma Velentis'
          // No imageUrl
        }
      ];

      mockWorldContext.getAvatarsByIds.mockResolvedValue(mockAvatars);
      mockSchemaService.generateImage.mockResolvedValue('https://example.com/generated.jpg');

      const arc = {
        characters: [
          { avatarName: 'Luma Velentis', avatarId: '68f98007be45067d3110efec' }
        ],
        locations: [],
        title: 'Test Arc'
      };

      const beat = {
        id: 'test-beat-id',
        sequenceNumber: 1,
        description: 'A test beat',
        characters: [],
        visualPrompt: 'A test scene'
      };

      await storyPostingService._generateMedia(beat, arc);

      // Should call generateImage with empty images array
      expect(mockSchemaService.generateImage).toHaveBeenCalledWith(
        'A test scene',
        '1:1',
        expect.objectContaining({
          images: []
        })
      );
    });
  });
});
