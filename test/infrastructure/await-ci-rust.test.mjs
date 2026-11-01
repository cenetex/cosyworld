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
