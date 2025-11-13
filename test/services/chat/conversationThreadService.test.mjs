/**
 * @fileoverview Tests for ConversationThreadService
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import ConversationThreadService from '@/services/chat/conversationThreadService.mjs';

describe('ConversationThreadService', () => {
  let service;
  let logger;

  beforeEach(() => {
    logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    };
    service = new ConversationThreadService({ logger });
  });

  it('creates threads and tracks participants', async () => {
    const thread = await service.startThread('chan1', [{ _id: 'a' }, { _id: 'b' }], { maxTurns: 4 });
    expect(thread).toBeTruthy();
    expect(thread.participants.has('a')).toBe(true);
    expect(thread.participants.has('b')).toBe(true);

    const active = service.getActiveThreads('chan1');
    expect(active).toHaveLength(1);
    const participantThread = service.isInActiveThread('chan1', 'a');
    expect(participantThread?.id).toBe(thread.id);
  });

  it('reuses active threads with identical participants and mode', async () => {
    const first = await service.startThread('chan2', [{ _id: 'x' }, { _id: 'y' }], { maxTurns: 5, mode: 'mention' });
    const second = await service.startThread('chan2', [{ _id: 'x' }, { _id: 'y' }], { maxTurns: 5, mode: 'mention' });
    expect(second.id).toBe(first.id);
  });

  it('records turns and expires when max turns reached', async () => {
    const thread = await service.startThread('chan3', [{ _id: 'p' }, { _id: 'q' }], { maxTurns: 2, duration: 500 });
    await service.recordTurn('chan3', 'p', thread.id);
    expect(service.getThread('chan3', thread.id)?.turnCount).toBe(1);
    await service.recordTurn('chan3', 'q', thread.id);
    expect(service.getThread('chan3', thread.id)).toBeNull();
  });
});
