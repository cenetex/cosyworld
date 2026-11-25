import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { VERSION_FILES, parseArgs, setVersion } from '../scripts/land-branch.mjs';
import { RULES_DIR, RULES_WIRING, isRulesBundle, realWiringChanges } from '../scripts/lib/generated-files.mjs';
import { steps } from '../scripts/regen.mjs';

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
    expect(RULES_WIRING).toContain('v2/orchestrator-rust/src/card_shared/engine.rs');
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

describe('npm run land', () => {
  it('lands a branch whose generated file conflicts with main, and exits', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'cosyworld-land-test-'));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    Object.assign(env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });
    for (const who of ['AUTHOR', 'COMMITTER']) Object.assign(env, { [`GIT_${who}_NAME`]: 'Test', [`GIT_${who}_EMAIL`]: 'test@example.com' });
    const work = path.join(root, 'work');
    const git = (...args) => execFileSync('git', args, { cwd: work, env, encoding: 'utf8' });
    const put = (file, text) => {
      mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
      writeFileSync(path.join(work, file), text);
    };
    const packs = (a, b) => `${JSON.stringify([a, b])}\n`;
    const commit = (message, files) => {
      for (const [file, text] of Object.entries(files)) put(file, text);
      git('add', '-A');
      git('commit', '-q', '-m', message);
    };
    try {
      execFileSync('git', ['init', '-q', '--bare', '-b', 'main', path.join(root, 'origin.git')], { env });
      execFileSync('git', ['clone', '-q', path.join(root, 'origin.git'), work], { env, stdio: 'ignore' });
      for (const file of ['scripts/land-branch.mjs', 'scripts/regen.mjs', 'scripts/lib/generated-files.mjs'])
        cpSync(new URL(`../${file}`, import.meta.url), path.join(work, file));
      for (const { build } of steps()) put(build.script, '');
      put(
        'v2/scripts/build-card-worldpacks.mjs',
        `import { readFileSync, writeFileSync } from 'node:fs';
const text = (name) => readFileSync(\`v2/content/\${name}.txt\`, 'utf8');
writeFileSync('v2/card-game/packs.json', \`\${JSON.stringify([text('a'), text('b')])}\\n\`);`,
      );
      const pkg = (version, extra = {}) => `${JSON.stringify({ name: 'fixture', version, ...extra }, null, 2)}\n`;
      commit('Start', {
        'package.json': pkg('1.0.0'),
        'v2/content/a.txt': 'a1',
        'v2/content/b.txt': 'b1',
        'v2/card-game/packs.json': packs('a1', 'b1'),
        [`${RULES_DIR}/engine-v1.js`]: '',
      });
      git('checkout', '-q', '-b', 'claude/prep-thing');
      commit('A changes [READY]', {
        'package.json': pkg('1.0.1', { dependencies: { left: '1.0.0' } }),
        'v2/content/a.txt': 'a2',
        'v2/card-game/packs.json': packs('a2', 'b1'),
      });
      git('push', '-q', 'origin', 'main', 'claude/prep-thing');
      git('checkout', '-q', 'main');
      commit('B changes', { 'v2/content/b.txt': 'b2', 'v2/card-game/packs.json': packs('a1', 'b2') });
      git('push', '-q', 'origin', 'main');

      const landed = spawnSync(process.execPath, ['scripts/land-branch.mjs', 'claude/prep-thing'], {
        cwd: work,
        env,
        encoding: 'utf8',
        timeout: 60_000,
      });
      expect(landed.status, `${landed.stdout}\n${landed.stderr}`).toBe(0);
      expect(git('rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('claude/land-thing');
      expect(git('log', '-1', '--format=%s').trim()).toBe('A changes');
      expect(git('show', 'HEAD:v2/card-game/packs.json')).toBe(packs('a2', 'b2'));
      expect(JSON.parse(git('show', 'HEAD:package.json'))).toEqual({ name: 'fixture', version: '1.0.0', dependencies: { left: '1.0.0' } });
      expect(git('status', '--porcelain')).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
