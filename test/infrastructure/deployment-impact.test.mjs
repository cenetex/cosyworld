import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  hasDeploymentImpact,
  normalizeVersionFile
} from '../../scripts/check-deployment-impact.mjs';

const versionFiles = [
  'package.json',
  'package-lock.json',
  'v2/orchestrator-rust/Cargo.toml',
  'v2/orchestrator-rust/Cargo.lock'
];

const current = Object.fromEntries(
  versionFiles.map((file) => [
    file,
    readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
  ])
);

const withVersion = (file, source, version) => {
  if (file === 'package.json' || file === 'package-lock.json') {
    const value = JSON.parse(source);
    value.version = version;
    if (value.packages?.['']) value.packages[''].version = version;
    return `${JSON.stringify(value, null, 2)}\n`;
  }
  if (file.endsWith('Cargo.toml')) {
    return source.replace(
      /^(\[package\][^[]*?^version = )"[^"]+"/ms,
      `$1"${version}"`
    );
  }
  return source.replace(
    /(name = "cosyworld-orchestrator"\nversion = )"[^"]+"/,
    `$1"${version}"`
  );
};

describe('deployment impact check', () => {
  it('ignores docs plus the required release-only version bump', () => {
    const before = Object.fromEntries(
      versionFiles.map((file) => [
        file,
        withVersion(file, current[file], '1.0.1')
      ])
    );
    const result = hasDeploymentImpact(
      ['docs/systems/example.md', ...versionFiles],
      (side, file) => (side === 'base' ? before[file] : current[file]) ?? null
    );

    expect(result.deploy).toBe(false);
  });

  it('deploys when a Cargo dependency changes with the version', () => {
    const file = 'v2/orchestrator-rust/Cargo.toml';
    const before = withVersion(file, current[file], '1.0.1');
    const after = current[file].replace('axum = "0.8"', 'axum = "0.9"');
    const result = hasDeploymentImpact([file], (side) =>
      side === 'base' ? before : after
    );

    expect(result).toEqual({
      deploy: true,
      reason: `${file} changed beyond its release version`
    });
  });

  it('deploys for any runtime or unknown file', () => {
    expect(
      hasDeploymentImpact(['v2/orchestrator-rust/src/main.rs'], () => null)
        .deploy
    ).toBe(true);
    expect(
      hasDeploymentImpact(['new-production-input'], () => null).deploy
    ).toBe(true);
  });

  it('normalizes only the declared release version fields', () => {
    const file = 'package.json';
    const changedDependency = current[file].replace('"axios"', '"other"');
    expect(normalizeVersionFile(file, current[file])).not.toBe(
      normalizeVersionFile(file, changedDependency)
    );
  });
});
