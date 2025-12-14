import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { TurnScheduler } from '../../../src/services/chat/turnScheduler.mjs';

const makeScheduler = (overrides = {}) => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const channel = {
    id: 'c1',
    messages: { fetch: vi.fn(async () => new Map()) },
  };

  const discordService = {
    client: {
      channels: {
        cache: new Map([['c1', channel]]),
        fetch: vi.fn(async () => channel),
      },
    },
    getGuildByChannelId: vi.fn(async () => ({ id: 'g1' })),
  };

  const avatarService = {
    getAvatarsInChannel: vi.fn(async () => []),
  };

  const presenceService = {
    ensurePresence: vi.fn(async () => true),
  };

  const responseCoordinator = {
    coordinateResponse: vi.fn(async () => ['ok']),
  };

  const databaseService = {
    getDatabase: vi.fn(async () => ({
      collection: () => ({
        find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }),
      }),
    })),
  };

  return new TurnScheduler({
    logger,
    databaseService,
    schedulingService: null,
    presenceService,
    discordService,
    conversationManager: null,
    avatarService,
    responseCoordinator,
    ...overrides,
  });
};

describe('TurnScheduler dead channel revive', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips dead channels when revive interval not reached', async () => {
    const scheduler = makeScheduler();

    scheduler.checkDeadChannel = vi.fn(async () => true);
    vi.spyOn(Math, 'random').mockReturnValue(0); // allow (roll < p)

    // First call: interval due and roll allows
    const first = await scheduler.onChannelTick('c1', 10);
    expect(first).toBe(1);

    // Immediate second call should be blocked by interval
    const second = await scheduler.onChannelTick('c1', 10);
    expect(second).toBe(0);
  });

  it('allows dead channel revive again after interval (when roll allows)', async () => {
    const scheduler = makeScheduler();
    scheduler.checkDeadChannel = vi.fn(async () => true);
    vi.spyOn(Math, 'random').mockReturnValue(0); // allow

    await scheduler.onChannelTick('c1', 10);

    // Advance time past interval (default 1h)
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);

    const again = await scheduler.onChannelTick('c1', 10);
    expect(again).toBe(1);
  });

  it('declines revive when roll fails (but still rate-limits until next interval)', async () => {
    const scheduler = makeScheduler();
    scheduler.checkDeadChannel = vi.fn(async () => true);
    vi.spyOn(Math, 'random').mockReturnValue(0.999); // decline

    const first = await scheduler.onChannelTick('c1', 10);
    expect(first).toBe(0);

    // Still within interval; should not try again
    const second = await scheduler.onChannelTick('c1', 10);
    expect(second).toBe(0);

    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    // Switch to allow after interval
    Math.random.mockReturnValue(0);
    const third = await scheduler.onChannelTick('c1', 10);
    expect(third).toBe(1);
  });

  it('does not gate non-dead channels', async () => {
    const scheduler = makeScheduler();
    scheduler.checkDeadChannel = vi.fn(async () => false);

    const res = await scheduler.onChannelTick('c1', 10);
    expect(res).toBe(1);
  });
});
