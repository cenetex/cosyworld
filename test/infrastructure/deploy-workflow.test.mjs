import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  new URL('../../.github/workflows/deploy.yml', import.meta.url),
  'utf8'
);
const primaryFlyConfig = readFileSync(
  new URL('../../fly.toml', import.meta.url),
  'utf8'
);
const lonelyForestFlyConfig = readFileSync(
  new URL('../../fly.lonelyforest.toml', import.meta.url),
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

  it('deploys one immutable Fly image to both apps before publishing a release', () => {
    const fly = job('fly', 'github-release');
    expect(fly).toContain('flyctl deploy --remote-only --config fly.toml');
    expect(fly).toContain('flyctl image show --app "$FLY_PRIMARY_APP" --json');
    expect(fly).toContain('flyctl deploy --config fly.lonelyforest.toml --image "${{ steps.image.outputs.ref }}"');
    expect(workflow).not.toContain('\n  aws:');
    expect(job('github-release')).toContain('needs: [fly]');
  });

  it('keeps the image workshop configured on both Fly tenants', () => {
    const model = 'COSYWORLD_REPLICATE_AVATAR_MODEL = "black-forest-labs/flux-dev-lora"';
    expect(primaryFlyConfig).toContain(model);
    expect(lonelyForestFlyConfig).toContain(model);
  });
});
