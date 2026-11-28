import { describe, expect, it } from 'vitest';

import { hasDeploymentImpact } from '../../scripts/check-deployment-impact.mjs';

describe('deployment impact check', () => {
  it('ignores docs, tests and design notes', () => {
    expect(
      hasDeploymentImpact(['docs/systems/example.md', 'test/a.test.mjs'])
    ).toEqual({ deploy: false, reason: 'only docs, tests, or tooling changed' });
  });

  it('deploys a release version bump, so .dev builds the image a tag promotes', () => {
    expect(
      hasDeploymentImpact(['docs/release.md', 'v2/orchestrator-rust/Cargo.toml'])
    ).toEqual({
      deploy: true,
      reason: 'v2/orchestrator-rust/Cargo.toml can affect production'
    });
  });

  it('deploys for any runtime or unknown file', () => {
    expect(hasDeploymentImpact(['v2/orchestrator-rust/src/main.rs']).deploy).toBe(
      true
    );
    expect(hasDeploymentImpact(['new-production-input']).deploy).toBe(true);
  });
});
