import { describe, expect, test } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

const repoRoot = path.resolve(process.cwd());
const srcRoot = path.join(repoRoot, 'src');

const allowPathPrefixes = [
  path.join(srcRoot, 'container') + path.sep,
];

const allowExactPaths = new Set([
  path.join(srcRoot, 'index.mjs'),
  path.join(srcRoot, 'services', 'web', 'webService.mjs'),
  path.join(srcRoot, 'test-aiservice.js'),
]);

function stripComments(source) {
  // Remove block comments then line comments.
  // This is a heuristic, but good enough to avoid flagging JSDoc examples.
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

async function walkFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(full)));
    } else {
      out.push(full);
    }
  }
  return out;
}

function isAllowed(filePath) {
  if (allowExactPaths.has(filePath)) return true;
  return allowPathPrefixes.some(prefix => filePath.startsWith(prefix));
}

describe('DI escape hatch guardrail', () => {
  test('no runtime container.resolve/services.resolve outside allowed bootstrap', async () => {
    const files = (await walkFiles(srcRoot))
      .filter(f => f.endsWith('.mjs') || f.endsWith('.js'));

    const violations = [];

    for (const filePath of files) {
      if (isAllowed(filePath)) continue;
      const raw = await fs.readFile(filePath, 'utf8');
      const content = stripComments(raw);

      if (/\bcontainer\.resolve\(/.test(content)) {
        violations.push(`${path.relative(repoRoot, filePath)}: container.resolve(`);
      }
      if (/\bservices\.resolve\(/.test(content)) {
        violations.push(`${path.relative(repoRoot, filePath)}: services.resolve(`);
      }
    }

    expect(violations).toEqual([]);
  });
});
