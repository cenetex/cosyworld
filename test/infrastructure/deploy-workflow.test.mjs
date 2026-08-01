import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  new URL('../../.github/workflows/deploy.yml', import.meta.url),
  'utf8'
);
const ciWorkflow = readFileSync(
  new URL('../../.github/workflows/ci.yml', import.meta.url),
  'utf8'
);
const deployScripts = readFileSync(
  new URL('../../.github/workflows/deploy.yml', import.meta.url),
  'utf8'
);
const packageScripts = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
).scripts;
const volumeHeadroomWorkflow = readFileSync(
  new URL('../../.github/workflows/volume-headroom.yml', import.meta.url),
  'utf8'
);
const oomAlertWorkflow = readFileSync(
  new URL('../../.github/workflows/oom-alert.yml', import.meta.url),
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
const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');
const dockerignore = readFileSync(
  new URL('../../.dockerignore', import.meta.url),
  'utf8'
);
const volumeGuardPath = fileURLToPath(
  new URL('../../scripts/check-fly-volume-space.sh', import.meta.url)
);
const backupScriptPath = fileURLToPath(
  new URL('../../scripts/backup-fly-v2.sh', import.meta.url)
);

const runVolumeGuard = (fakeFlyctl) => {
  const directory = mkdtempSync(join(tmpdir(), 'cosyworld-volume-guard-'));
  const flyctlPath = join(directory, 'flyctl');
  writeFileSync(flyctlPath, `#!/usr/bin/env bash\n${fakeFlyctl}\n`);
  chmodSync(flyctlPath, 0o755);
  try {
    return spawnSync(
      volumeGuardPath,
      ['example-world', '/data', '85'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${directory}${delimiter}${process.env.PATH}`
        }
      }
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const runBackup = (fakeFlyctl, profile = 'primary') => {
  const directory = mkdtempSync(join(tmpdir(), 'cosyworld-fly-backup-'));
  const flyctlPath = join(directory, 'flyctl');
  writeFileSync(flyctlPath, `#!/usr/bin/env bash\n${fakeFlyctl}\n`);
  chmodSync(flyctlPath, 0o755);
  try {
    return spawnSync(
      backupScriptPath,
      ['example-world', profile],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${directory}${delimiter}${process.env.PATH}`,
          COSYWORLD_FLY_SNAPSHOT_TIMEOUT_SECS: '1',
          COSYWORLD_FLY_SNAPSHOT_POLL_SECS: '1'
        }
      }
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const job = (name, nextName) => {
  const start = workflow.indexOf(`\n  ${name}:`);
  const end = nextName ? workflow.indexOf(`\n  ${nextName}:`, start + 1) : workflow.length;
  return workflow.slice(start, end);
};

describe('deploy workflow', () => {
  it('only invokes package scripts that exist', () => {
    const invokedScripts = [ciWorkflow, deployScripts].flatMap((source) =>
      [...source.matchAll(/\bnpm run ([\w:-]+)/g)].map(([, script]) => script)
    );
    expect(invokedScripts.filter((script) => !packageScripts[script])).toEqual([]);
  });

  it('keeps the primary Fly app on HTTPS and exposes the lightweight liveness path', () => {
    expect(primaryFlyConfig).toContain('force_https = true');
    expect(primaryFlyConfig).not.toContain('force_https = false');
    expect(dockerfile).toContain('ENTRYPOINT ["/app/entrypoint.sh"]');
  });

  it('blocks deployment on the real v2 gates before either Fly job runs', () => {
    const gate = job('production-gate', 'primary-fly');
    expect(gate).toContain('npm run v2:worldpack');
    expect(gate).toContain('npm run v2:kernel');
    expect(gate).toContain('npm run v2:syntax');
    expect(gate).toContain('npm run v2:architecture');
    expect(gate).toContain('npm run v2:lonelyforest:contract');
    expect(gate).toContain('npx vitest run test/infrastructure/deploy-workflow.test.mjs');
    expect(gate).toContain('npm run v2:rust:test');
    expect(gate).not.toContain('npm test');
    expect(gate).not.toContain('v2:deployment:check');
    expect(workflow).toContain('needs: production-gate');
    expect(
      workflow.indexOf('Guard primary worldpack bundle compatibility')
    ).toBeLessThan(workflow.indexOf('Create rollback backup'));
  });

  it('serializes deployments across branch and tag refs', () => {
    expect(workflow).toContain('group: deploy-${{ github.repository }}');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).not.toContain('group: deploy-${{ github.ref }}');
  });

  it('uses separate app-scoped release jobs before publishing a release', () => {
    const primaryFly = job('primary-fly', 'lonelyforest-fly');
    const lonelyForestFly = job('lonelyforest-fly', 'github-release');
    const primaryDeploy = 'flyctl deploy --remote-only --config fly.toml';
    const lonelyForestDeploy =
      'flyctl deploy --remote-only --config fly.lonelyforest.toml --ha=false';
    expect(primaryFly).toContain(primaryDeploy);
    expect(primaryFly).toContain('FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}');
    expect(primaryFly).not.toContain('FLY_LONELYFOREST_API_TOKEN');
    expect(lonelyForestFly).toContain(lonelyForestDeploy);
    expect(lonelyForestFly).toContain(
      'FLY_API_TOKEN: ${{ secrets.FLY_LONELYFOREST_API_TOKEN }}'
    );
    expect(lonelyForestFly).toContain("startsWith(github.ref, 'refs/tags/v')");
    expect(lonelyForestFly).toContain("github.event_name == 'workflow_dispatch'");
    expect(lonelyForestFly).not.toContain("github.ref == 'refs/heads/main'");
    expect(workflow).not.toContain('flyctl image show');
    expect(workflow).not.toContain('--image');
    expect(workflow).not.toContain('\n  aws:');
    expect(job('github-release')).toContain(
      'needs: [production-gate, primary-fly, lonelyforest-fly]'
    );
  });

  it('auto-extends both data volumes before the deploy guard, with bounded spend', () => {
    for (const config of [primaryFlyConfig, lonelyForestFlyConfig]) {
      expect(config).toContain('auto_extend_size_threshold = 80');
      expect(config).toContain('auto_extend_size_increment = "1GB"');
      expect(config).toContain('auto_extend_size_limit = "5GB"');
    }

    const primaryFly = job('primary-fly', 'lonelyforest-fly');
    const lonelyForestFly = job('lonelyforest-fly', 'github-release');
    expect(primaryFly).toContain('check-fly-volume-space.sh cosyworld /data 85');
    expect(lonelyForestFly).toContain(
      'check-fly-volume-space.sh cosyworld-lonelyforest /data 85'
    );
    expect(80).toBeLessThan(85);
  });

  it('refuses a blind deploy while preserving the Fly SSH diagnostic', () => {
    const result = runVolumeGuard(
      'echo "Error: machine is stopped and cannot accept SSH" >&2\nexit 1'
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('refusing to deploy blind');
    expect(result.stderr).toContain('machine is stopped and cannot accept SSH');
  });

  it('creates and verifies an exact Fly volume snapshot before deployment', () => {
    const result = runBackup(
      `case "$*" in
        *"volumes list"*) echo '[{"id":"vol_123","name":"cosyworld_data","state":"created","attached_machine_id":"machine_123"}]' ;;
        *"snapshots create"*) echo '{"id":"vs_new","status":"running"}' ;;
        *"snapshots list"*)
          state_file="$(dirname "$0")/snapshot-list-count"
          if [ -f "$state_file" ]; then
            echo '[{"id":"vs_new","status":"created"}]'
          else
            touch "$state_file"
            echo '[]'
          fi ;;
        *) exit 1 ;;
      esac`
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Verified Fly volume snapshot vs_new');
  });

  it('recovers a verifiable new snapshot when flyctl create returns an empty successful response', () => {
    const result = runBackup(
      `case "$*" in
        *"volumes list"*) echo '[{"id":"vol_123","name":"cosyworld_data","state":"created","attached_machine_id":"machine_123"}]' ;;
        *"snapshots create"*) : ;;
        *"snapshots list"*)
          state_file="$(dirname "$0")/snapshot-list-count"
          if [ -f "$state_file" ]; then
            echo '[{"id":"vs_existing","status":"created"},{"id":"vs_new","status":"created"}]'
          else
            touch "$state_file"
            echo '[{"id":"vs_existing","status":"created"}]'
          fi ;;
        *) exit 1 ;;
      esac`
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Verified Fly volume snapshot vs_new');
  });

  it('fails closed when an empty successful create response exposes multiple new snapshots', () => {
    const result = runBackup(
      `case "$*" in
        *"volumes list"*) echo '[{"id":"vol_123","name":"cosyworld_data","state":"created","attached_machine_id":"machine_123"}]' ;;
        *"snapshots create"*) : ;;
        *"snapshots list"*)
          state_file="$(dirname "$0")/snapshot-list-count"
          if [ -f "$state_file" ]; then
            echo '[{"id":"vs_existing","status":"created"},{"id":"vs_one","status":"created"},{"id":"vs_two","status":"created"}]'
          else
            touch "$state_file"
            echo '[{"id":"vs_existing","status":"created"}]'
          fi ;;
        *) exit 1 ;;
      esac`
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('could not identify exactly one new snapshot');
  });

  it('recovers the exact new snapshot when Fly emits non-JSON create diagnostics', () => {
    const result = runBackup(
      `case "$*" in
        *"volumes list"*) echo '[{"id":"vol_123","name":"cosyworld_data","state":"created","attached_machine_id":"machine_123"}]' ;;
        *"snapshots list"*)
          state_file="$(dirname "$0")/snapshot-list-count"
          if [ -f "$state_file" ]; then
            echo '[{"id":"vs_new","status":"created"}]'
          else
            touch "$state_file"
            echo '[]'
          fi ;;
        *"snapshots create"*) echo 'snapshot created' ;;
        *) exit 1 ;;
      esac`
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('returned no JSON snapshot id');
    expect(result.stdout).not.toContain('snapshot created');
    expect(result.stdout).toContain('Verified Fly volume snapshot vs_new');
  });

  it('fails closed when the configured volume is ambiguous', () => {
    const result = runBackup(
      `echo '[{"id":"vol_123","name":"cosyworld_data","state":"created","attached_machine_id":"machine_123"},{"id":"vol_456","name":"cosyworld_data","state":"created","attached_machine_id":"machine_456"}]'`
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('expected exactly one active volume');
  });

  it('accepts a healthy volume report below the configured threshold', () => {
    const result = runVolumeGuard(
      'echo "Connecting to fdaa:73:809:a7b:8c:51:4894:2..." >&2\n'
      + 'echo "Filesystem 1024-blocks Used Available Capacity Mounted on"\n'
      + 'echo "/dev/vdb 100000 42000 58000 42% /data"'
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('example-world /data is 42% used');
  });

  it('checks production volume headroom every fifteen minutes', () => {
    expect(volumeHeadroomWorkflow).toContain('cron: "*/15 * * * *"');
    expect(volumeHeadroomWorkflow).toContain(
      'check-fly-volume-space.sh cosyworld /data 70'
    );
    expect(volumeHeadroomWorkflow).toContain(
      'check-fly-volume-space.sh cosyworld-lonelyforest /data 70'
    );
    expect(volumeHeadroomWorkflow).toContain(
      'FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}'
    );
    expect(volumeHeadroomWorkflow).toContain(
      'FLY_API_TOKEN: ${{ secrets.FLY_LONELYFOREST_API_TOKEN }}'
    );
  });

  it('alerts on OOM exits for both Fly apps every fifteen minutes', () => {
    expect(oomAlertWorkflow).toContain('cron: "*/15 * * * *"');
    expect(oomAlertWorkflow).toContain('- cosyworld');
    expect(oomAlertWorkflow).toContain('- cosyworld-lonelyforest');
    expect(oomAlertWorkflow).toContain(
      'node v2/scripts/check-fly-oom.mjs personal "${{ matrix.app }}" 30m'
    );
    expect(oomAlertWorkflow).toContain(
      'FLY_METRICS_READ_TOKEN: ${{ secrets.FLY_METRICS_READ_TOKEN }}'
    );
  });

  it('keeps the image workshop configured on both Fly tenants', () => {
    const model = 'COSYWORLD_REPLICATE_AVATAR_MODEL = "black-forest-labs/flux-dev-lora"';
    const mirquoLora = 'COSYWORLD_REPLICATE_AVATAR_LORA = "immanencer/mirquo"';
    const loraInput = 'COSYWORLD_REPLICATE_AVATAR_LORA_INPUT = "lora_weights"';
    const loraScaleInput = 'COSYWORLD_REPLICATE_AVATAR_LORA_SCALE_INPUT = "lora_scale"';
    const trigger =
      'COSYWORLD_REPLICATE_AVATAR_PROMPT_PREFIX = "MRQ, cozy storybook trading-card portrait"';
    const visionModel =
      'COSYWORLD_AI_VISION_MODEL = "openai/gpt-5-image-mini"';
    const visionReasoning =
      'COSYWORLD_AI_VISION_REASONING_EFFORT = "low"';

    for (const config of [primaryFlyConfig, lonelyForestFlyConfig]) {
      expect(config).toContain(model);
      expect(config).toContain(mirquoLora);
      expect(config).toContain(loraInput);
      expect(config).toContain(loraScaleInput);
      expect(config).toContain(trigger);
      expect(config).toContain(visionModel);
      expect(config).toContain(visionReasoning);
    }
  });

  it('copies compile-time media registries into the release image build', () => {
    const dependencyBuild = 'RUN cargo chef cook --release --recipe-path /app/recipe.json';
    const mediaCopy = 'COPY v2/media /app/v2/media';
    const releaseBuild = 'RUN cargo build --release';

    expect(dockerignore).toContain('!v2/media/');
    expect(dockerignore).toContain('!v2/media/**');
    expect(dockerfile).toContain(mediaCopy);
    expect(dockerfile.indexOf(dependencyBuild)).toBeLessThan(
      dockerfile.indexOf(mediaCopy)
    );
    expect(dockerfile.indexOf(mediaCopy)).toBeLessThan(
      dockerfile.indexOf(releaseBuild)
    );
  });
});
