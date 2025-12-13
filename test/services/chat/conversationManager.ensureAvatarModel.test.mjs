import { describe, it, expect, vi } from 'vitest';

import { ConversationManager } from '../../../src/services/chat/conversationManager.mjs';

describe('ConversationManager.ensureAvatarModel', () => {
  it('repairs an invalid model to a random existing model and persists', async () => {
    const updateAvatar = vi.fn().mockResolvedValue(true);

    const aiService = {
      selectRandomModel: vi.fn().mockResolvedValue('openai/gpt-4o-mini'),
    };

    const openrouterModelCatalogService = {
      modelExists: vi.fn(async (modelId) => modelId === 'openai/gpt-4o-mini'),
      pickRandomExistingModel: vi.fn().mockResolvedValue('openai/gpt-4o-mini'),
    };

    const mgr = new ConversationManager({
      logger: { warn: vi.fn(), debug: vi.fn() },
      databaseService: {},
      aiService,
      unifiedAIService: null,
      openrouterModelCatalogService,
      discordService: {},
      avatarService: { updateAvatar },
      memoryService: {},
      promptService: {},
      configService: {},
      knowledgeService: {},
      mapService: {},
    });

    const avatar = { _id: 'a1', name: 'Test', model: 'nonexistent/provider-model' };

    await mgr.ensureAvatarModel(avatar);

    expect(avatar.model).toBe('openai/gpt-4o-mini');
    expect(updateAvatar).toHaveBeenCalledTimes(1);
  });

  it('does not update when model is valid', async () => {
    const updateAvatar = vi.fn().mockResolvedValue(true);

    const mgr = new ConversationManager({
      logger: { warn: vi.fn(), debug: vi.fn() },
      databaseService: {},
      aiService: { selectRandomModel: vi.fn().mockResolvedValue('openai/gpt-4o-mini') },
      unifiedAIService: null,
      openrouterModelCatalogService: { modelExists: vi.fn().mockResolvedValue(true) },
      discordService: {},
      avatarService: { updateAvatar },
      memoryService: {},
      promptService: {},
      configService: {},
      knowledgeService: {},
      mapService: {},
    });

    const avatar = { _id: 'a1', name: 'Test', model: 'openai/gpt-4o-mini' };

    await mgr.ensureAvatarModel(avatar);

    expect(updateAvatar).not.toHaveBeenCalled();
  });
});
