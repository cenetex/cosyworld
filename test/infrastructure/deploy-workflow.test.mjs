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

  it('builds the same revision with app-scoped tokens before publishing a release', () => {
    const fly = job('fly', 'github-release');
    const primaryDeploy = 'flyctl deploy --remote-only --config fly.toml';
    const lonelyForestDeploy =
      'flyctl deploy --remote-only --config fly.lonelyforest.toml --ha=false';
    expect(fly).toContain(primaryDeploy);
    expect(fly).toContain(lonelyForestDeploy);
    expect(fly.indexOf(primaryDeploy)).toBeLessThan(fly.indexOf(lonelyForestDeploy));
    expect(fly).toContain('FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}');
    expect(fly).toContain(
      'FLY_API_TOKEN: ${{ secrets.FLY_LONELYFOREST_API_TOKEN }}'
    );
    expect(fly).not.toContain('flyctl image show');
    expect(fly).not.toContain('--image');
    expect(workflow).not.toContain('\n  aws:');
    expect(job('github-release')).toContain('needs: [fly]');
  });

  it('keeps the image workshop configured on both Fly tenants', () => {
    const model = 'COSYWORLD_REPLICATE_AVATAR_MODEL = "black-forest-labs/flux-dev-lora"';
    const mirquoLora = 'COSYWORLD_REPLICATE_AVATAR_LORA = "immanencer/mirquo"';
    const loraInput = 'COSYWORLD_REPLICATE_AVATAR_LORA_INPUT = "lora_weights"';
    const loraScaleInput = 'COSYWORLD_REPLICATE_AVATAR_LORA_SCALE_INPUT = "lora_scale"';
    const trigger =
      'COSYWORLD_REPLICATE_AVATAR_PROMPT_PREFIX = "MRQ, cozy storybook trading-card portrait"';

    for (const config of [primaryFlyConfig, lonelyForestFlyConfig]) {
      expect(config).toContain(model);
      expect(config).toContain(mirquoLora);
      expect(config).toContain(loraInput);
      expect(config).toContain(loraScaleInput);
      expect(config).toContain(trigger);
    }
  });
});
