import { describe, it, expect } from 'vitest';
import { AvatarAgentService } from '../../../src/services/chat/avatarAgentService.mjs';

describe('AvatarAgentService', () => {
  it('forces respond on direct reply to avatar', async () => {
    const svc = new AvatarAgentService({
      logger: { warn: () => {}, info: () => {} },
      configService: { get: () => ({}), getAIConfig: () => ({}) },
      unifiedAIService: null,
    });

    const res = await svc.decideAction({
      channel: { id: 'c1' },
      message: { repliedToAvatarId: 'a1', content: 'hi', author: { bot: false } },
      avatar: { _id: 'a1', name: 'Rohan' },
      trigger: { type: 'human_message' },
    });

    expect(res.action).toBe('respond');
  });

  it('forces respond on name mention', async () => {
    const svc = new AvatarAgentService({
      logger: { warn: () => {}, info: () => {} },
      configService: { get: () => ({}), getAIConfig: () => ({}) },
      unifiedAIService: null,
    });

    const res = await svc.decideAction({
      channel: { id: 'c1' },
      message: { content: 'hey rohan what do you think', author: { bot: false } },
      avatar: { _id: 'a1', name: 'Rohan' },
      trigger: { type: 'human_message' },
    });

    expect(res.action).toBe('respond');
  });

  it('uses structured agent decision and records disengage window', async () => {
    const unifiedAIService = {
      structured: async () => ({ data: { action: 'disengage', confidence: 0.9, reason: 'not relevant' } }),
    };

    const svc = new AvatarAgentService({
      logger: { warn: () => {}, info: () => {} },
      configService: {
        get: () => ({ disengageTtlMs: 60_000, temperature: 0.1 }),
        getAIConfig: () => ({ agentModel: 'agent-model' }),
      },
      unifiedAIService,
    });

    const first = await svc.decideAction({
      channel: { id: 'c1' },
      message: { content: 'random chatter', author: { bot: false } },
      avatar: { _id: 'a1', name: 'Rohan' },
      trigger: { type: 'human_message' },
    });

    expect(first.action).toBe('disengage');

    // Second call should stay disengaged without calling AI again
    let called = 0;
    unifiedAIService.structured = async () => {
      called++;
      return ({ data: { action: 'respond' } });
    };

    const second = await svc.decideAction({
      channel: { id: 'c1' },
      message: { content: 'more chatter', author: { bot: false } },
      avatar: { _id: 'a1', name: 'Rohan' },
      trigger: { type: 'human_message' },
    });

    expect(second.action).toBe('disengage');
    expect(called).toBe(0);
  });
});
