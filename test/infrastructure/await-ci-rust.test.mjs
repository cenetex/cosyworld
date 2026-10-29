import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { CI_RUST_CHECKS, decide, waitForChecks } from '../../scripts/await-ci-rust.mjs';

const run = (name, status, conclusion, started_at = '2026-10-19T00:00:00Z') => ({
  name,
  status,
  conclusion,
  started_at,
  app: { slug: 'github-actions' }
});
const both = (status, conclusion) =>
  CI_RUST_CHECKS.map((name) => run(name, status, conclusion));
const clock = () => {
  let ms = 0;
  return {
    now: () => ms,
    sleep: async (delay) => { ms += delay; },
    elapsed: () => ms / 1000,
    log: () => {}
  };
};
const fakeCheck = (name) => run(name, 'in_progress', null);

describe('reusing CI Rust checks in the production gate', () => {
  it('reuses CI only when every Rust check passed for the commit', () => {
    expect(decide(both('completed', 'success')).decision).toBe('reuse');
    expect(
      decide([run(CI_RUST_CHECKS[0], 'completed', 'success')]).decision
    ).toBe('wait');
  });

  it('waits while CI runs, and runs the checks itself once CI is missing', () => {
    expect(decide(both('in_progress', null)).decision).toBe('wait');
    expect(decide([]).decision).toBe('wait');
    expect(decide([], { missingIsFinal: true }).decision).toBe('run');
  });

  it('runs the checks itself when CI failed, was cancelled, or was skipped', () => {
    for (const conclusion of ['failure', 'cancelled', 'skipped', 'timed_out']) {
      expect(decide(both('completed', conclusion)).decision).toBe('run');
    }
  });

  it('waits for an active sibling before falling back for missing or failed checks', () => {
    for (const active of CI_RUST_CHECKS) {
      expect(decide([fakeCheck(active)], { missingIsFinal: true }).decision).toBe('wait');
      const sibling = CI_RUST_CHECKS.find((name) => name !== active);
      expect(decide([
        run(sibling, 'completed', 'failure'), fakeCheck(active)
      ]).decision).toBe('wait');
    }
    expect(decide([run(CI_RUST_CHECKS[0], 'completed', 'failure')]).decision).toBe('wait');
  });

  it('observes a longer replay suite past the earlier twenty-minute wait', async () => {
    const time = clock();
    const result = await waitForChecks({
      ...time,
      pollSecs: 600,
      readChecks: async () => time.elapsed() < 3600
        ? both('in_progress', null)
        : both('completed', 'success')
    });
    expect(result.decision).toBe('reuse');
    expect(time.elapsed()).toBe(3600);
  });

  it('ends the wait with an error while CI is still active', async () => {
    const time = clock();
    await expect(waitForChecks({
      ...time,
      waitSecs: 60,
      readChecks: async () => both('in_progress', null)
    })).rejects.toThrow('CI wait reached 60s');
    expect(time.elapsed()).toBe(60);
  });

  it('retries an unreadable CI status through the bounded wait', async () => {
    const time = clock();
    await expect(waitForChecks({
      ...time,
      waitSecs: 60,
      readChecks: async () => {
        if (time.elapsed() === 0) return both('in_progress', null);
        throw new Error('HTTP 503');
      }
    })).rejects.toThrow('CI status needs another read: HTTP 503');
    expect(time.elapsed()).toBe(60);
  });

  it('recovers a status read and reuses the completed exact-commit checks', async () => {
    const time = clock();
    const result = await waitForChecks({
      ...time,
      readChecks: async () => {
        if (time.elapsed() === 0) throw new Error('HTTP 503');
        return both('completed', 'success');
      }
    });
    expect(result.decision).toBe('reuse');
    expect(time.elapsed()).toBe(20);
  });

  it('starts a fallback after the missing-check grace period', async () => {
    const time = clock();
    const result = await waitForChecks({ ...time, readChecks: async () => [] });
    expect(result.decision).toBe('run');
    expect(time.elapsed()).toBe(180);
  });

  it('starts a fallback once all active checks have finished', async () => {
    const time = clock();
    const result = await waitForChecks({
      ...time,
      readChecks: async () => [
        run(CI_RUST_CHECKS[0], 'completed', 'failure'),
        run(CI_RUST_CHECKS[1], time.elapsed() < 60 ? 'in_progress' : 'completed', 'success')
      ]
    });
    expect(result.decision).toBe('run');
    expect(time.elapsed()).toBe(60);
  });

  it('requires finite positive wait settings', async () => {
    for (const setting of [{ waitSecs: NaN }, { pollSecs: 0 }, { missingSecs: -1 }]) {
      await expect(waitForChecks({
        ...clock(), ...setting, readChecks: async () => []
      })).rejects.toThrow('must be a positive number of seconds');
    }
  });

  it('reads the latest attempt and ignores checks from other apps', () => {
    const [name] = CI_RUST_CHECKS;
    const rerun = [
      ...both('completed', 'success'),
      run(name, 'completed', 'failure', '2026-10-18T00:00:00Z')
    ];
    expect(decide(rerun).decision).toBe('reuse');
    const failedRerun = [
      ...both('completed', 'success'),
      run(name, 'completed', 'failure', '2026-10-20T00:00:00Z')
    ];
    expect(decide(failedRerun).decision).toBe('run');
    const other = both('completed', 'success').map((r) => ({
      ...r,
      app: { slug: 'someone-else' }
    }));
    expect(decide(other, { missingIsFinal: true }).decision).toBe('run');
  });

  it('waits for a newer queued attempt that has no start time yet', () => {
    const previous = both('completed', 'success').map((check, index) => ({
      ...check, id: index + 1
    }));
    const queued = { ...run(CI_RUST_CHECKS[0], 'queued', null, null), id: 3 };
    expect(decide([...previous, queued]).decision).toBe('wait');
    expect(decide([queued, ...previous]).decision).toBe('wait');
  });

  it('names the same jobs CI runs', () => {
    const ci = readFileSync(
      new URL('../../.github/workflows/ci.yml', import.meta.url),
      'utf8'
    );
    for (const name of CI_RUST_CHECKS) expect(ci).toContain(`name: ${name}\n`);
  });
});
