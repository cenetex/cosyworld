import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TTLMap } from '../../src/utils/TTLMap.mjs';

describe('TTLMap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('expires entries after ttlMs', () => {
    const m = new TTLMap({ ttlMs: 1000, maxSize: 10, cleanupIntervalMs: 0 });
    m.set('a', 1);

    expect(m.get('a')).toBe(1);

    vi.advanceTimersByTime(1001);
    expect(m.get('a')).toBeUndefined();
  });

  it('evicts oldest entries when maxSize exceeded', () => {
    const m = new TTLMap({ ttlMs: 0, maxSize: 2, cleanupIntervalMs: 0 });
    m.set('a', 1);
    m.set('b', 2);
    m.set('c', 3);

    expect(m.get('a')).toBeUndefined();
    expect(m.get('b')).toBe(2);
    expect(m.get('c')).toBe(3);
  });

  it('refreshes insertion order on set (LRU-ish)', () => {
    const m = new TTLMap({ ttlMs: 0, maxSize: 2, cleanupIntervalMs: 0 });
    m.set('a', 1);
    m.set('b', 2);

    // refresh 'a' so 'b' becomes the oldest
    m.set('a', 1);
    m.set('c', 3);

    expect(m.get('b')).toBeUndefined();
    expect(m.get('a')).toBe(1);
    expect(m.get('c')).toBe(3);
  });
});
