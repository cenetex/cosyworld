import { describe, expect, it } from 'vitest';

import {
  evaluateWorldpackDeployCompat,
  readCompiledWorldpack
} from '../../scripts/check-worldpack-deploy-compat.mjs';

const INCOMING = 'sha256:29e213d646b50e015753b90346a6ecc82ab38c75b16125d533cb6188c07f1d1f';
const MIGRATED = 'sha256:9b955ecb00000000000000000000000000000000000000000000000000000000';
const FOREIGN = 'sha256:deadbeef00000000000000000000000000000000000000000000000000000000';

const evaluate = (overrides) =>
  evaluateWorldpackDeployCompat({
    app: 'cosyworld',
    compiledBundleHash: INCOMING,
    replayCompatibleHashes: [MIGRATED],
    liveBundleHash: INCOMING,
    ...overrides
  });

describe('worldpack deploy gate', () => {
  it('allows a deploy that does not change the worldpack', () => {
    const verdict = evaluate({});
    expect(verdict.ok).toBe(true);
    expect(verdict.message).toMatch(/unchanged by this deploy/);
  });

  it('allows a deploy whose bundle declares the live one replay-compatible', () => {
    const verdict = evaluate({ liveBundleHash: MIGRATED });
    expect(verdict.ok).toBe(true);
    expect(verdict.message).toMatch(/declared replay-compatible/);
  });

  it('allows a legacy unversioned world', () => {
    expect(evaluate({ liveBundleHash: '' }).ok).toBe(true);
  });

  // The 2026-07-29 outage: a tree missing the migration the live world was
  // written under. The gate must stop it before the image is swapped.
  it('refuses an undeclared mismatch and names both hashes and the fix', () => {
    const verdict = evaluate({ liveBundleHash: FOREIGN });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain(FOREIGN);
    expect(verdict.message).toContain(INCOMING);
    expect(verdict.message).toMatch(/crash-loop/);
    expect(verdict.message).toMatch(/behind origin\/main/);
    expect(verdict.message).toMatch(/replay_compatible_bundle_hashes/);
    expect(verdict.message).toMatch(/Never erase the persisted hash/);
  });

  it('refuses a rules-profile change', () => {
    const verdict = evaluate({
      compiledRulesProfile: 'cosyworld.srd5/2',
      liveRulesProfile: 'cosyworld.srd5/1'
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/rules profile/);
  });

  it('refuses a bundle that was never compiled', () => {
    const verdict = evaluate({ compiledBundleHash: '' });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/v2:worldpack/);
  });

  // Matches scripts/check-fly-volume-space.sh: never deploy blind. The override
  // is the documented way through during an incident.
  it('fails closed when the live identity cannot be read, and names the override', () => {
    const verdict = evaluate({ liveBundleHash: undefined });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/refusing to deploy blind/);
    expect(verdict.message).toMatch(/COSYWORLD_SKIP_WORLDPACK_DEPLOY_GATE=1/);
  });

  it('reads the committed bundle, which can replay its own world', () => {
    const compiled = readCompiledWorldpack();
    expect(compiled.compiledBundleHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(Array.isArray(compiled.replayCompatibleHashes)).toBe(true);
    expect(compiled.replayCompatibleHashes).not.toContain(compiled.compiledBundleHash);
    expect(
      evaluateWorldpackDeployCompat({
        app: 'cosyworld',
        ...compiled,
        liveBundleHash: compiled.compiledBundleHash
      }).ok
    ).toBe(true);
  });
});
