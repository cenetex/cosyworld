import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { CI_RUST_CHECKS, decide, versionOnly } from '../../scripts/await-ci-rust.mjs';

const run = (name, status, conclusion, started_at = '2026-10-19T00:00:00Z') => ({
  name,
  status,
  conclusion,
  started_at,
  app: { slug: 'github-actions' }
});
const both = (status, conclusion) =>
  CI_RUST_CHECKS.map((name) => run(name, status, conclusion));

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

  it('names the same jobs CI runs', () => {
    const ci = readFileSync(
      new URL('../../.github/workflows/ci.yml', import.meta.url),
      'utf8'
    );
    for (const name of CI_RUST_CHECKS) expect(ci).toContain(`name: ${name}\n`);
  });
});

describe('reusing a .dev train or version-only parent', () => {
  const gate = (name, status, conclusion, runId = 5) => ({
    ...run(name, status, conclusion),
    details_url: `https://github.com/o/r/actions/runs/${runId}/job/1`
  });
  const gates = (status, conclusion, runId) =>
    ['Production Rust gate', 'Production Rust architecture and lint'].map((name) =>
      gate(name, status, conclusion, runId)
    );

  it("reuses a train's own gate jobs, and never this run's", () => {
    expect(decide(gates('completed', 'success')).decision).toBe('reuse');
    expect(decide(gates('in_progress', null)).decision).toBe('wait');
    expect(
      decide(gates('in_progress', null, 9), { selfRunId: '9', missingIsFinal: true }).decision
    ).toBe('run');
  });

  const train = (status, conclusion, runId, started_at, head_sha = 'qualified') =>
    gates(status, conclusion, runId).map((r) => ({ ...r, started_at, head_sha }));
  const passedTrain = () => train('completed', 'success', 42416346337, '2026-11-07T21:41:34Z');
  const skippedTrain = () => train('completed', 'skipped', 42416828746, '2026-11-07T21:53:48Z');

  it('keeps the passed train when a later train skips the same commit gates', () => {
    const checks = [...skippedTrain(), ...passedTrain()];
    expect(decide(checks).decision).toBe('reuse');
    expect(decide(checks.reverse()).decision).toBe('reuse');
  });

  it.each(['failure', 'cancelled', 'timed_out'])(
    'keeps a newer %s attempt authoritative through a later skipped train',
    (conclusion) => {
      const checks = [
        ...passedTrain(),
        ...train('completed', conclusion, 7, '2026-11-07T21:50:00Z'),
        ...skippedTrain()
      ];
      expect(decide(checks).decision).toBe('run');
      expect(decide(checks.reverse()).decision).toBe('run');
    }
  );

  it.each(['queued', 'in_progress'])('waits for a newer %s attempt', (status) => {
    const checks = [
      ...passedTrain(),
      ...train(status, null, 7, '2026-11-07T21:50:00Z'),
      ...skippedTrain()
    ];
    expect(decide(checks).decision).toBe('wait');
    expect(decide(checks.reverse()).decision).toBe('wait');
  });

  it('runs when every matching check was skipped, even before the missing deadline', () => {
    expect(decide(skippedTrain()).decision).toBe('run');
    expect(decide(skippedTrain(), { missingIsFinal: true }).decision).toBe('run');
  });

  it('keeps skipped fallback separate by commit and check name', () => {
    const otherCommit = passedTrain().map((r) => ({ ...r, head_sha: 'other' }));
    expect(decide([...otherCommit, ...skippedTrain()]).decision).toBe('run');
    expect(decide([passedTrain()[0], ...skippedTrain()]).decision).toBe('run');
  });

  it('keeps skipped fallback when the passing record belongs to this run or another app', () => {
    expect(decide([...passedTrain(), ...skippedTrain()], {
      selfRunId: '42416346337'
    }).decision).toBe('run');
    const otherApp = passedTrain().map((r) => ({ ...r, app: { slug: 'other' } }));
    expect(decide([...otherApp, ...skippedTrain()]).decision).toBe('run');
  });

  it('treats only version lines in the bump files as a version-only change', () => {
    const file = (filename, patch) => ({ filename, status: 'modified', patch });
    const bump = [
      file('package.json', '@@ -1 +1 @@\n-  "version": "1.2.113",\n+  "version": "1.2.114",'),
      file('v2/orchestrator-rust/Cargo.toml', '@@\n-version = "1.2.113"\n+version = "1.2.114"')
    ];
    expect(versionOnly(bump)).toBe(true);
    expect(versionOnly([])).toBe(false);
    expect(versionOnly([...bump, file('v2/orchestrator-rust/src/main.rs', '+fn x() {}')])).toBe(false);
    expect(versionOnly([file('v2/orchestrator-rust/Cargo.lock', '+name = "serde"\n+version = "1"')])).toBe(false);
  });
});
