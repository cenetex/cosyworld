import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  new URL('../../.github/workflows/deploy.yml', import.meta.url),
  'utf8'
);

const job = (name, nextName) => {
  const start = workflow.indexOf(`\n  ${name}:`);
  const end = nextName ? workflow.indexOf(`\n  ${nextName}:`, start + 1) : workflow.length;
  return workflow.slice(start, end);
};

describe('deploy workflow', () => {
  it('serializes deployments across branch and tag refs', () => {
    expect(workflow).toContain('group: deploy-${{ github.repository }}');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).not.toContain('group: deploy-${{ github.ref }}');
  });

  it('lets tagged AWS deployments finish independently of Fly', () => {
    expect(job('aws', 'github-release')).not.toMatch(/^\s+needs:\s*fly\s*$/m);
    expect(job('github-release')).toContain('needs: [fly, aws]');
  });
});
