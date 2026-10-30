import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GENERATED,
  RULES_WIRING,
  VERSION_FILES,
  isRulesBundle,
  parseArgs,
  realWiringChanges,
  setVersion,
} from '../scripts/land-branch.mjs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

describe('land-branch', () => {
  it('moves only the release version line of every version file', () => {
    for (const file of VERSION_FILES) {
      const source = read(file);
      const moved = setVersion(file, source, '9.8.7');
      expect(moved, file).not.toBe(source);
      expect(moved.split('\n').length, file).toBe(source.split('\n').length);
      expect(setVersion(file, moved, JSON.parse(read('package.json')).version), file).toBe(source);
    }
  });

  it('keeps dependency edits apart from the version line', () => {
    const lock = read('package-lock.json');
    const withDependency = lock.replace(/("node_modules\/[^"]+": \{\s*"version": )"[^"]+"/u, '$1"0.0.0-test"');
    expect(withDependency).not.toBe(lock);
    const version = JSON.parse(read('package.json')).version;
    expect(setVersion('package-lock.json', withDependency, version)).toBe(withDependency);
  });

  it('separates rules version wiring from real edits', () => {
    expect(
      realWiringChanges(
        ['-pub const VERSION: u32 = 41;', '+pub const VERSION: u32 = 42;', '+    42: "' + 'a'.repeat(64) + '",'].join('\n'),
      ),
    ).toEqual([]);
    expect(realWiringChanges('+fn replay_the_new_lane() {}')).toEqual(['fn replay_the_new_lane() {}']);
  });

  it('regenerates bundles, assets and wiring instead of merging them', () => {
    expect(isRulesBundle('v2/orchestrator-rust/src/card_shared/engine-v42.js')).toBe(true);
    expect(isRulesBundle('v2/orchestrator-rust/src/card_shared/engine.rs')).toBe(false);
    expect(GENERATED).toContain('v2/orchestrator-rust/src/card_assets.rs');
    const nextShared = read('v2/scripts/next-shared-rules.mjs');
    for (const file of RULES_WIRING) expect(nextShared).toContain(file.replace('v2/orchestrator-rust/src/card_shared/', '${dir}/'));
  });

  it('names the landing branch after the prepared one', () => {
    expect(parseArgs(['origin/claude/prep-dark-attic'])).toEqual({
      base: 'origin/main',
      branch: 'claude/prep-dark-attic',
      name: 'claude/land-dark-attic',
    });
    expect(parseArgs(['claude/prep-x', '--base', 'claude/land-y']).base).toBe('claude/land-y');
  });
});
