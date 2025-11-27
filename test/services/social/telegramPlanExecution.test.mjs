/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * @file test/services/social/telegramPlanExecution.test.mjs
 * @description Tests for the refactored TelegramService plan execution flow
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';

let TelegramService;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY =
    process.env.ENCRYPTION_KEY ||
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  ({ default: TelegramService } = await import(
    '../../../src/services/social/telegramService.mjs'
  ));
});

function createService(overrides = {}) {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  };

  const noopCollection = () => ({
    insertOne: vi.fn(),
    updateOne: vi.fn(),
    countDocuments: vi.fn(),
    findOne: vi.fn(),
    find: vi.fn().mockReturnValue({
      sort: () => ({
        limit: () => ({
          toArray: async () => []
        })
      })
    })
  });

  const databaseService = {
    getDatabase: vi.fn().mockResolvedValue({
      collection: noopCollection
    })
  };

  const service = new TelegramService({
    logger,
    databaseService,
    configService: { get: vi.fn() },
    secretsService: null,
    aiService: {},
    globalBotService: {},
    googleAIService: null,
    veoService: null,
    buybotService: null,
    xService: null,
    mediaGenerationService: null,
    mediaIndexService: null,
    ...overrides
  });

  return { service, logger, databaseService };
}

function createCtx() {
  return {
    reply: vi.fn().mockResolvedValue(undefined),
    chat: { id: '-10001' }
  };
}


describe('TelegramService.executePlanActions', () => {
  it('requires at least one plan step', async () => {
    const { service } = createService();
    const ctx = createCtx();

    await service.executePlanActions(ctx, { steps: [] }, 'channel', 'user', 'alice', '');

    expect(ctx.reply).toHaveBeenCalledWith(
      'I need at least one planned step to act on. Try planning again with a specific goal.'
    );
  });

  it('reports validation errors before executing', async () => {
    const { service } = createService();
    const ctx = createCtx();

    service.planExecutionService = {
      validatePlan: vi.fn().mockReturnValue({
        valid: false,
        errors: ['Missing objective', 'Unknown action', 'Zero steps', 'Extra error']
      })
    };

    await service.executePlanActions(
      ctx,
      { steps: [{ action: 'speak', description: 'hello' }] },
      'channel',
      'user',
      'alice',
      ''
    );

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('🚫 I couldn\'t execute that plan:')
    );
    expect(ctx.reply.mock.calls[0][0]).toContain('1. Missing objective');
    expect(ctx.reply.mock.calls[0][0]).toContain('3. Zero steps');
  });

  it('warns when validation returns warnings', async () => {
    const { service, logger } = createService();
    const ctx = createCtx();

    service.planExecutionService = {
      validatePlan: vi.fn().mockReturnValue({
        valid: true,
        warnings: ['Plan lacks context']
      }),
      getActionIcon: vi.fn().mockReturnValue('[icon]'),
      getActionLabel: vi.fn().mockReturnValue('Say hello'),
      executePlan: vi.fn().mockResolvedValue({
        success: true,
        durationMs: 1000,
        successCount: 1,
        totalSteps: 1
      })
    };

    service.interactionManager = {
      updateProgressMessage: vi.fn().mockResolvedValue('progress-1'),
      deleteProgressMessage: vi.fn().mockResolvedValue(undefined)
    };

    await service.executePlanActions(
      ctx,
      { steps: [{ action: 'speak', description: 'hello' }] },
      'channel',
      'user',
      'alice',
      ''
    );

    expect(logger.warn).toHaveBeenCalledWith(
      '[TelegramService] Plan validation warnings:',
      ['Plan lacks context']
    );
  });

  it('executes plan, streams progress, and reports summary', async () => {
    const { service } = createService();
    const ctx = createCtx();

    const planExecutionService = {
      validatePlan: vi.fn().mockReturnValue({ valid: true, warnings: [] }),
      getActionIcon: vi.fn().mockReturnValue('[icon]'),
      getActionLabel: vi.fn().mockReturnValue('Speak to user'),
      executePlan: vi.fn().mockImplementation(async (plan, _context, options) => {
        await options.onProgress(1, plan.steps.length, plan.steps[0].action);
        await options.onStepComplete({ success: true, stepNum: 1, action: 'speak' });
        return {
          success: true,
          durationMs: 2400,
          successCount: 2,
          totalSteps: 2
        };
      })
    };

    const interactionManager = {
      updateProgressMessage: vi.fn().mockResolvedValue('progress-1'),
      deleteProgressMessage: vi.fn().mockResolvedValue(undefined)
    };

    service.planExecutionService = planExecutionService;
    service.interactionManager = interactionManager;

    const planEntry = {
      objective: 'Engage user',
      steps: [
        { action: 'speak', description: 'say hi' },
        { action: 'generate_image', description: 'show art' }
      ]
    };

    const result = await service.executePlanActions(
      ctx,
      planEntry,
      'channel-123',
      'user-42',
      'alice',
      'recent conversation'
    );

    expect(planExecutionService.executePlan).toHaveBeenCalledTimes(1);
    expect(interactionManager.updateProgressMessage).toHaveBeenCalledWith(
      ctx,
      null,
      expect.stringContaining('Step 1/2'),
      'channel-123'
    );
    expect(interactionManager.deleteProgressMessage).toHaveBeenCalledWith(
      ctx,
      'progress-1',
      'channel-123'
    );
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Plan completed')
    );
    expect(result).toMatchObject({ success: true, successCount: 2 });
  });

  it('handles execution errors gracefully and cleans up progress UI', async () => {
    const { service, logger } = createService();
    const ctx = createCtx();

    const planExecutionService = {
      validatePlan: vi.fn().mockReturnValue({ valid: true, warnings: [] }),
      getActionIcon: vi.fn().mockReturnValue('[icon]'),
      getActionLabel: vi.fn().mockReturnValue('Speak to user'),
      executePlan: vi.fn().mockRejectedValue(new Error('boom'))
    };

    const interactionManager = {
      updateProgressMessage: vi.fn().mockResolvedValue('progress-err'),
      deleteProgressMessage: vi.fn().mockResolvedValue(undefined)
    };

    service.planExecutionService = planExecutionService;
    service.interactionManager = interactionManager;

    await service.executePlanActions(
      ctx,
      { steps: [{ action: 'speak', description: 'hello' }] },
      'channel-999',
      'user-5',
      'alice',
      ''
    );

    expect(logger.error).toHaveBeenCalledWith(
      '[TelegramService] executePlanActions error:',
      expect.any(Error)
    );
    expect(ctx.reply).toHaveBeenCalledWith(
      'Planning fizzled out for a moment—try again and I will map it out.'
    );
    expect(interactionManager.updateProgressMessage).not.toHaveBeenCalled();
    expect(interactionManager.deleteProgressMessage).toHaveBeenCalledWith(
      ctx,
      null,
      'channel-999'
    );
  });
});
