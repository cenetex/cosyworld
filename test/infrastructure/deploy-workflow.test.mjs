import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../../.github/workflows/deploy.yml", import.meta.url),
  "utf8",
);
const ciWorkflow = readFileSync(
  new URL("../../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);
const deployScripts = readFileSync(
  new URL("../../.github/workflows/deploy.yml", import.meta.url),
  "utf8",
);
const packageScripts = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
).scripts;
const flyHealthWorkflow = readFileSync(
  new URL("../../.github/workflows/fly-health.yml", import.meta.url),
  "utf8",
);
const primaryFlyConfig = readFileSync(
  new URL("../../fly.toml", import.meta.url),
  "utf8",
);
const lonelyForestFlyConfig = readFileSync(
  new URL("../../fly.lonelyforest.toml", import.meta.url),
  "utf8",
);
const dockerfile = readFileSync(
  new URL("../../Dockerfile", import.meta.url),
  "utf8",
);
const cardPolicyModel = readFileSync(
  new URL("../../models/card-policy/incumbent.cwrank", import.meta.url),
);
const dockerignore = readFileSync(
  new URL("../../.dockerignore", import.meta.url),
  "utf8",
);
const volumeGuardPath = fileURLToPath(
  new URL("../../scripts/check-fly-volume-space.sh", import.meta.url),
);
const backupScriptPath = fileURLToPath(
  new URL("../../scripts/backup-fly-v2.sh", import.meta.url),
);
const backupScript = readFileSync(backupScriptPath, "utf8");

const runVolumeGuard = (fakeFlyctl) => {
  const directory = mkdtempSync(join(tmpdir(), "cosyworld-volume-guard-"));
  const flyctlPath = join(directory, "flyctl");
  writeFileSync(flyctlPath, `#!/usr/bin/env bash\n${fakeFlyctl}\n`);
  chmodSync(flyctlPath, 0o755);
  try {
    return spawnSync(volumeGuardPath, ["example-world", "/data", "85"], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}${delimiter}${process.env.PATH}`,
      },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const runBackup = (fakeFlyctl, profile = "primary", timeoutSecs = "1") => {
  const directory = mkdtempSync(join(tmpdir(), "cosyworld-fly-backup-"));
  const flyctlPath = join(directory, "flyctl");
  writeFileSync(flyctlPath, `#!/usr/bin/env bash\n${fakeFlyctl}\n`);
  chmodSync(flyctlPath, 0o755);
  try {
    return spawnSync(backupScriptPath, ["example-world", profile], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}${delimiter}${process.env.PATH}`,
        COSYWORLD_FLY_SNAPSHOT_TIMEOUT_SECS: timeoutSecs,
        COSYWORLD_FLY_SNAPSHOT_POLL_SECS: "1",
      },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const workflowJob = (source, name, nextName) => {
  const start = source.indexOf(`\n  ${name}:`);
  const end = nextName
    ? source.indexOf(`\n  ${nextName}:`, start + 1)
    : source.length;
  return source.slice(start, end);
};
const job = (name, nextName) => workflowJob(workflow, name, nextName);
const ciJob = (name, nextName) => workflowJob(ciWorkflow, name, nextName);

describe("deploy workflow", () => {
  it("only invokes package scripts that exist", () => {
    const invokedScripts = [ciWorkflow, deployScripts].flatMap((source) =>
      [...source.matchAll(/\bnpm run ([\w:-]+)/g)].map(([, script]) => script),
    );
    expect(invokedScripts.filter((script) => !packageScripts[script])).toEqual(
      [],
    );
  });

  it("keeps the primary Fly app on HTTPS and exposes the lightweight liveness path", () => {
    expect(primaryFlyConfig).toContain("force_https = true");
    expect(primaryFlyConfig).not.toContain("force_https = false");
    expect(dockerfile).toContain('ENTRYPOINT ["/app/entrypoint.sh"]');
  });

  it("ships the checksummed card ranker in conservative production shadow mode", () => {
    expect(cardPolicyModel.subarray(0, 8).toString("utf8")).toBe("CWRANK2\n");
    expect(cardPolicyModel).toHaveLength(516);
    expect(createHash("sha256").update(cardPolicyModel).digest("hex")).toBe(
      "778558accea1d57cc7fbb1a169cbc2c29d37672971141e2800421c9131775cf4",
    );
    expect(dockerignore).toContain("!models/card-policy/**");
    expect(dockerfile).toContain(
      "COPY models/card-policy /app/models/card-policy",
    );
    for (const config of [primaryFlyConfig, lonelyForestFlyConfig]) {
      expect(config).toContain('COSYWORLD_CARD_POLICY_MODE = "shadow"');
      expect(config).toContain(
        'COSYWORLD_CARD_POLICY_MODEL_PATH = "/app/models/card-policy/incumbent.cwrank"',
      );
      expect(config).toContain('COSYWORLD_CARD_POLICY_TOP_K = "3"');
    }
  });

  it("keeps the Docker entrypoint COPY, chmod, and ENTRYPOINT destinations aligned", () => {
    const copies = [
      ...dockerfile.matchAll(/^COPY\s+deploy\/entrypoint\.sh\s+(\S+)$/gm),
    ];
    expect(copies).toHaveLength(1);
    const [, entrypointPath] = copies[0];
    const normalizedDockerfile = dockerfile.replace(/\\\s*\n\s*/g, " ");
    const escapedEntrypointPath = entrypointPath.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    expect(normalizedDockerfile).toMatch(
      new RegExp(`RUN\\s+chmod\\s+0755\\s+${escapedEntrypointPath}(?:\\s|$)`),
    );
    expect(dockerfile).toContain(`ENTRYPOINT ["${entrypointPath}"]`);
    expect(dockerfile).not.toContain("/app/deploy/entrypoint.sh");
  });

  it("blocks deployment on the real v2 gates before either Fly job runs", () => {
    const nodeGate = job("production-node-gate", "production-rust-gate");
    const rustGate = job("production-rust-gate", "production-gate");
    const gate = job("production-gate", "primary-fly");
    expect(nodeGate).toContain("npm run v2:worldpack");
    expect(nodeGate).toContain("npm run v2:kernel");
    expect(nodeGate).toContain("npm run v2:syntax");
    expect(nodeGate).toContain(
      "npx vitest run test/infrastructure/deploy-workflow.test.mjs",
    );
    expect(nodeGate).not.toContain("npm test");
    expect(rustGate).toContain("node scripts/await-ci-rust.mjs");
    expect(rustGate).toContain("checks: read");
    expect(rustGate).toContain("if: steps.ci.outputs.reuse != 'true'");
    expect(rustGate).toContain("bash v2/scripts/check-rust.sh test");
    expect(rustGate).toContain("bash v2/scripts/check-main-size.sh");
    expect(rustGate).toContain("bash v2/scripts/check-rust-lint.sh");
    expect(gate).toContain(
      "needs: [deployment-impact, release-owner, production-node-gate, production-rust-gate]",
    );
    expect(gate).toContain('test "$NODE_RESULT" = success');
    expect(gate).toContain('test "$RUST_RESULT" = success');
    expect(job("primary-backup", "primary-fly")).toContain(
      "needs: [deployment-impact, release-owner]",
    );
    expect(job("primary-fly", "lonelyforest-image")).toContain(
      "needs: [deployment-impact, release-owner, production-gate, primary-image, primary-backup]",
    );
    expect(job("lonelyforest-backup", "lonelyforest-fly")).toContain(
      "needs: [deployment-impact, release-owner]",
    );
    expect(job("lonelyforest-fly", "deploy-outcome")).toContain(
      "needs: [deployment-impact, release-owner, production-gate, lonelyforest-image, lonelyforest-backup]",
    );
    expect(
      workflow.indexOf("Guard primary worldpack bundle compatibility"),
    ).toBeLessThan(workflow.indexOf("Create rollback backup"));
  });

  it("shares a commit image while each app keeps its own registry and rollout gates", () => {
    const primary = job("primary-image", "primary-backup");
    const forest = job("lonelyforest-image", "lonelyforest-backup");
    expect(primary).toContain("needs: [deployment-impact, release-owner]");
    expect(forest).toContain(
      "needs: [deployment-impact, release-owner, primary-image]",
    );
    expect(forest).toContain("!cancelled()");
    expect(forest).toContain("needs.primary-image.result == 'skipped'");
    expect(forest).toContain(
      "SOURCE_IMAGE: ${{ needs.primary-image.outputs.image }}",
    );
    for (const [image, app, config, token] of [
      [primary, "cosyworld", "fly.toml", "FLY_API_TOKEN"],
      [
        forest,
        "cosyworld-lonelyforest",
        "fly.lonelyforest.toml",
        "FLY_LONELYFOREST_API_TOKEN",
      ],
    ]) {
      expect(image).toContain(
        `bash scripts/prepare-fly-image.sh ${app} ${config}`,
      );
      expect(image).toContain(`FLY_API_TOKEN: \${{ secrets.${token} }}`);
      expect(image).toContain("image: ${{ steps.image.outputs.image }}");
      expect(image).toContain("COSYWORLD_IMAGE_BUILDER: runner");
      expect(image).not.toContain("production-gate");
      expect(image).not.toContain("backup-fly-v2.sh");
    }
  });

  it("uses matching compact Rust profiles and cache namespaces in CI and deployment", () => {
    for (const source of [ciWorkflow, workflow]) {
      expect(source).toContain('CARGO_PROFILE_DEV_DEBUG: "0"');
      expect(source).toContain('CARGO_PROFILE_TEST_DEBUG: "0"');
      expect(source).toContain("-cargo-compact-v1-");
      expect(source).not.toContain("-cargo-orchestrator-");
    }
  });

  it("runs the long CI smoke suites in parallel from one shared binary", () => {
    const fast = ciJob("rust-fast", "rust-rules");
    const binary = ciJob("smoke-binary", "rust-quality");
    const composition = ciJob("composition", "browser");
    const browser = ciJob("browser", "publication");
    const build = ciJob("build");

    // The binary builds beside the Rust tests, so the smoke suites need not
    // wait for the tests.
    expect(binary).toContain("actions/upload-artifact@v7");
    expect(binary).not.toContain("check-rust.sh shard");
    expect(fast).toContain("check-rust.sh shard fast");
    expect(fast).not.toContain("v2:composition:smoke");
    expect(fast).not.toContain("v2:browser:check");
    expect(composition).toContain("needs: smoke-binary");
    expect(composition).toContain("suite: [standalone, core-ruby]");
    expect(composition).toContain("actions/download-artifact@v8");
    expect(browser).toContain("needs: smoke-binary");
    for (const mode of [
      "baseline",
      "living-world",
      "cards-shared",
      "cards-ui",
      "cards-routes",
      "cards-drama",
      "cards-dialogue",
      "cards-quests",
    ])
      expect(browser).toContain(`- mode: ${mode}\n`);
    expect(browser).toContain("actions/download-artifact@v8");
    for (const job of ["node", "runtime", "smoke-binary", "rust-quality"])
      expect(build).toContain(job);
    expect(build).toContain("toJSON(needs)");
  });

  it("keeps the pull-request gate fast and runs the smoke suites on main", () => {
    const mainOnly =
      "if: ${{ github.event_name != 'pull_request' || contains(github.event.pull_request.labels.*.name, 'full-ci') }}";
    expect(ciJob("smoke-binary", "rust-quality")).toContain(mainOnly);
    expect(ciJob("publication", "build")).toContain(mainOnly);
    expect(ciJob("rust-rules", "runtime")).toContain(
      "if: needs.changes.outputs.rules == 'true'",
    );
    const changes = ciJob("changes", "rust-fast");
    expect(changes).toContain('if [ "$EVENT" != pull_request ]');
    expect(changes).toContain("v2/orchestrator-rust/src/card_shared");
    // Main must pass every job; only a pull request may skip one, and never
    // the fast gate.
    const build = ciJob("build");
    for (const job of [
      "node",
      "vitest",
      "changes",
      "rust-fast",
      "runtime",
      "rust-quality",
    ])
      expect(build).toContain(`"${job}"`);
    expect(ciJob("runtime", "smoke-binary")).toContain(
      'test "$RULES_RESULT" = success',
    );
  });

  it("folds pending version changes into one commit that deploys only the primary app", () => {
    const version = readFileSync(
      new URL("../../.github/workflows/version.yml", import.meta.url),
      "utf8",
    );
    expect(version).toContain('paths: [".changes/**"]');
    expect(version).toContain("cancel-in-progress: false");
    expect(version).toContain("node scripts/version-changes.mjs apply");
    expect(version).toContain("gh workflow run ci.yml --ref main");
    expect(version).toContain("gh workflow run deploy.yml --ref main -f target=primary");
    expect(version).not.toContain("lonelyforest");
    expect(ciWorkflow).toContain("workflow_dispatch:");
    expect(ciWorkflow).not.toContain("github.event_name == 'push'");
    expect(readFileSync(
      new URL("../../scripts/check-deployment-impact.mjs", import.meta.url),
      "utf8",
    )).toContain("pendingChanges()");
  });

  it("saves the Cargo cache only from main", () => {
    const fast = ciJob("rust-fast", "rust-rules");
    expect(fast).toContain("actions/cache/restore@v6");
    expect(fast).toContain("actions/cache/save@v6");
    expect(fast).toContain("github.ref == 'refs/heads/main'");
    for (const [name, next] of [
      ["rust-rules", "runtime"],
      ["smoke-binary", "rust-quality"],
    ])
      expect(ciJob(name, next)).not.toContain("actions/cache/save");
  });

  it("skips docs-only deploys and reuses release compilation work", () => {
    const impact = job("deployment-impact", "production-node-gate");
    const primaryFly = job("primary-fly", "lonelyforest-image");

    expect(impact).toContain("scripts/check-deployment-impact.mjs");
    expect(primaryFly).toContain(
      "needs.deployment-impact.outputs.deploy == 'true'",
    );
    expect(dockerfile).toContain("id=cosyworld-release-target-v1");
    expect(dockerfile).toContain(
      "from=dependencies,source=/app/v2/orchestrator-rust/target,sharing=locked",
    );
    expect(dockerfile).toContain("touch build.rs");
    expect(dockerfile).toContain("cargo build --release --locked");
    expect(dockerfile).toContain(
      "cp target/release/cosyworld-orchestrator /app/bin/cosyworld-orchestrator",
    );
    expect(dockerfile).toContain(
      "COPY --from=build /app/bin/cosyworld-orchestrator /app/cosyworld-orchestrator",
    );
    expect(dockerfile).toContain("ARG CARGO_BUILD_JOBS=1");
    expect(dockerfile).toContain(
      "CARGO_INCREMENTAL=1 CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS}",
    );
  });

  it("runs Lonely Forest as one process behind the same bundle guard as primary", () => {
    expect(lonelyForestFlyConfig).toContain(
      'app = "/app/cosyworld-orchestrator"',
    );
    expect(lonelyForestFlyConfig).toContain(
      'COSYWORLD_V2_SHARD_ID = "lonelyforest-root"',
    );
    expect(lonelyForestFlyConfig).toContain(
      'COSYWORLD_V2_EVENT_DB_PATH = "/data/cosyworld-v2-events.sqlite"',
    );
    expect(lonelyForestFlyConfig).not.toContain("MULTITENANT");
    expect(job("lonelyforest-backup", "lonelyforest-fly")).toContain(
      "node v2/scripts/check-deploy-worldpack.mjs https://lonelyforest.com",
    );
    expect(workflow).not.toContain("lonelyforest_fresh_empty_tenant");
    expect(dockerfile).not.toContain("nginx");
    expect(
      existsSync(new URL("../../deploy/lonelyforest", import.meta.url)),
    ).toBe(false);
  });

  it("serializes deployments across branch and tag refs", () => {
    expect(workflow).toContain("group: deploy-${{ github.repository }}");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).not.toContain("group: deploy-${{ github.ref }}");
  });

  it("uses separate app-scoped release jobs before publishing a release", () => {
    const primaryJobs = job("primary-image", "lonelyforest-image");
    const lonelyForestJobs = job("lonelyforest-image", "deploy-outcome");
    const primaryFly = job("primary-fly", "lonelyforest-image");
    const lonelyForestFly = job("lonelyforest-fly", "deploy-outcome");
    expect(primaryFly).toContain(
      'flyctl deploy --config fly.toml --image "$RELEASE_IMAGE"',
    );
    expect(primaryJobs).toContain(
      "FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}",
    );
    expect(primaryJobs).not.toContain("FLY_LONELYFOREST_API_TOKEN");
    expect(lonelyForestFly).toContain(
      'flyctl deploy --config fly.lonelyforest.toml --image "$RELEASE_IMAGE" --ha=false',
    );
    expect(lonelyForestJobs).toContain(
      "FLY_API_TOKEN: ${{ secrets.FLY_LONELYFOREST_API_TOKEN }}",
    );
    expect(lonelyForestFly).not.toContain("secrets.FLY_API_TOKEN");
    expect(primaryFly).toContain(
      "RELEASE_IMAGE: ${{ needs.primary-image.outputs.image }}",
    );
    expect(lonelyForestFly).toContain(
      "RELEASE_IMAGE: ${{ needs.lonelyforest-image.outputs.image }}",
    );
    for (const [name, next] of [
      ["lonelyforest-image", "lonelyforest-backup"],
      ["lonelyforest-backup", "lonelyforest-fly"],
      ["lonelyforest-fly", "deploy-outcome"],
    ]) {
      const lonelyForestJob = job(name, next);
      expect(lonelyForestJob).toContain(
        "startsWith(github.ref, 'refs/tags/v')",
      );
      expect(lonelyForestJob).toContain(
        "github.event_name == 'workflow_dispatch'",
      );
      expect(lonelyForestJob).not.toContain("github.ref == 'refs/heads/main'");
    }
    // An app-scoped token cannot deploy the other app's image (#172), so each
    // app deploys the prepared image from its own registry.
    expect(workflow).not.toContain("flyctl image show");
    expect(primaryJobs).not.toContain("registry.fly.io/cosyworld-lonelyforest");
    expect(lonelyForestJobs).not.toContain("registry.fly.io/cosyworld:");
    expect(workflow).not.toContain("\n  aws:");
    expect(job("github-release")).toContain(
      "needs: [production-gate, primary-fly, lonelyforest-fly]",
    );
  });

  it.each([
    ["primary-fly", "lonelyforest-image", "https://cosyworld.fly.dev"],
    ["lonelyforest-fly", "deploy-outcome", "https://lonelyforest.com"],
  ])(
    "checks readiness and persistence for %s after one feed refresh",
    (name, next, url) => {
      const deploy = job(name, next);
      expect(deploy).toContain("for attempt in {1..13}");
      expect(deploy).toContain(
        `node v2/scripts/smoke-deployed-ruby-high.mjs ${url}`,
      );
      expect(deploy).toContain("sleep 10");
      expect(deploy).toContain("remained degraded after 120 seconds");
    },
  );

  it("reports only for runs that own their commit and closes shipped alerts (#1044)", () => {
    const outcome = job("deploy-outcome", "github-release");
    expect(outcome).toContain("if: ${{ !cancelled() }}");
    expect(outcome).not.toContain("if: always()");
    expect(outcome).toMatch(/permissions:\s+contents: read\s+issues: write/);
    expect(outcome).toContain("gh api --paginate");
    expect(outcome).toContain("compare/${sha}...${GITHUB_SHA}");
    expect(outcome).toMatch(
      /needs\.primary-fly\.result == 'success' &&\s+needs\.lonelyforest-fly\.result == 'success'/,
    );
  });

  it("retries a Lonely Forest rolling deploy after a transient Fly polling failure", () => {
    const lonelyForestFly = job("lonelyforest-fly", "deploy-outcome");
    expect(lonelyForestFly).toContain("for attempt in 1 2");
    expect(lonelyForestFly).toContain("--ha=false --strategy rolling");
    expect(lonelyForestFly).toContain("retrying once in 15 seconds");
  });

  it("auto-extends both data volumes before the deploy guard, with bounded spend", () => {
    for (const config of [primaryFlyConfig, lonelyForestFlyConfig]) {
      expect(config).toContain("auto_extend_size_threshold = 80");
      expect(config).toContain('auto_extend_size_increment = "1GB"');
      expect(config).toContain('auto_extend_size_limit = "5GB"');
    }

    const primaryBackup = job("primary-backup", "primary-fly");
    const lonelyForestBackup = job("lonelyforest-backup", "lonelyforest-fly");
    expect(primaryBackup).toContain(
      "check-fly-volume-space.sh cosyworld /data 85",
    );
    expect(primaryBackup).toMatch(
      /- name: Guard primary volume free space\s+timeout-minutes: 2\s+run:/,
    );
    expect(lonelyForestBackup).toContain(
      "check-fly-volume-space.sh cosyworld-lonelyforest /data 85",
    );
    expect(lonelyForestBackup).toMatch(
      /- name: Guard Lonely Forest volume free space\s+timeout-minutes: 2\s+run:/,
    );
    expect(80).toBeLessThan(85);
  });

  it("refuses a blind deploy while preserving the Fly SSH diagnostic", () => {
    const result = runVolumeGuard(
      'echo "Error: machine is stopped and cannot accept SSH" >&2\nexit 1',
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("refusing to deploy blind");
    expect(result.stderr).toContain("machine is stopped and cannot accept SSH");
  });

  it("creates and verifies an exact Fly volume snapshot before deployment", () => {
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
      esac`,
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Verified Fly volume snapshot vs_new");
  });

  it("allows queued Fly snapshots ten minutes to complete before failing closed", () => {
    expect(backupScript).toContain("COSYWORLD_FLY_SNAPSHOT_TIMEOUT_SECS:-600");
    expect(backupScript).toContain(
      "timed out waiting for Fly volume snapshot $snapshot_id to reach created",
    );
  });

  it("recovers a verifiable new snapshot when flyctl create returns an empty successful response", () => {
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
      esac`,
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Verified Fly volume snapshot vs_new");
  });

  it("fails closed when an empty successful create response exposes multiple new snapshots", () => {
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
      esac`,
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "could not identify exactly one new snapshot",
    );
  });

  it("recovers the exact new snapshot when Fly emits non-JSON create diagnostics", () => {
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
      esac`,
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("returned no JSON snapshot id");
    expect(result.stdout).not.toContain("snapshot created");
    expect(result.stdout).toContain("Verified Fly volume snapshot vs_new");
  });

  it("collapses identical and same-status Fly snapshot duplicates", () => {
    const result = runBackup(
      `case "$*" in
        *"volumes list"*) echo '[{"id":"vol_123","name":"cosyworld_data","state":"created","attached_machine_id":"machine_123"}]' ;;
        *"snapshots create"*) echo 'snapshot created' ;;
        *"snapshots list"*)
          state_file="$(dirname "$0")/snapshot-list-count"
          if [ -f "$state_file" ]; then
            echo '[{"id":"vs_existing","status":"created","size_gb":1},{"id":"vs_existing","status":"created","size_gb":2},{"id":"vs_identical","status":"created"},{"id":"vs_identical","status":"created"},{"id":"vs_new","status":"created","region":"yyz"},{"id":"vs_new","status":"created","region":"sea"}]'
          else
            touch "$state_file"
            echo '[{"id":"vs_existing","status":"created","size_gb":1},{"id":"vs_existing","status":"created","size_gb":2},{"id":"vs_identical","status":"created"},{"id":"vs_identical","status":"created"}]'
          fi ;;
        *) exit 1 ;;
      esac`,
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Verified Fly volume snapshot vs_new");
  });

  it("waits for conflicting duplicate Fly snapshot statuses to converge", () => {
    const result = runBackup(
      `case "$*" in
        *"volumes list"*) echo '[{"id":"vol_123","name":"cosyworld_data","state":"created","attached_machine_id":"machine_123"}]' ;;
        *"snapshots create"*) echo '{"id":"vs_new","status":"running"}' ;;
        *"snapshots list"*)
          state_file="$(dirname "$0")/snapshot-list-count"
          count=0
          if [ -f "$state_file" ]; then count="$(cat "$state_file")"; fi
          count=$((count + 1))
          echo "$count" > "$state_file"
          if [ "$count" -eq 1 ]; then
            echo '[]'
          elif [ "$count" -eq 2 ]; then
            echo '[{"id":"vs_new","status":"created"},{"id":"vs_new","status":"running"}]'
          else
            echo '[{"id":"vs_new","status":"created","region":"yyz"},{"id":"vs_new","status":"created","region":"sea"}]'
          fi ;;
        *) exit 1 ;;
      esac`,
      "primary",
      "3",
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "Waiting for Fly volume snapshot vs_new: conflicting",
    );
    expect(result.stdout).toContain("Verified Fly volume snapshot vs_new");
  });

  it("fails closed when conflicting duplicate Fly snapshot statuses do not converge", () => {
    const result = runBackup(
      `case "$*" in
        *"volumes list"*) echo '[{"id":"vol_123","name":"cosyworld_data","state":"created","attached_machine_id":"machine_123"}]' ;;
        *"snapshots create"*) echo '{"id":"vs_new","status":"running"}' ;;
        *"snapshots list"*)
          state_file="$(dirname "$0")/snapshot-list-count"
          if [ -f "$state_file" ]; then
            echo '[{"id":"vs_new","status":"created"},{"id":"vs_new","status":"running"}]'
          else
            touch "$state_file"
            echo '[]'
          fi ;;
        *) exit 1 ;;
      esac`,
      "primary",
      "2",
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "Waiting for Fly volume snapshot vs_new: conflicting",
    );
    expect(result.stderr).toContain(
      "timed out waiting for Fly volume snapshot vs_new",
    );
    expect(result.stdout).not.toContain("Verified Fly volume snapshot");
  });

  it("fails closed when a duplicate Fly snapshot record reports a terminal failure", () => {
    const result = runBackup(
      `case "$*" in
        *"volumes list"*) echo '[{"id":"vol_123","name":"cosyworld_data","state":"created","attached_machine_id":"machine_123"}]' ;;
        *"snapshots create"*) echo '{"id":"vs_new","status":"running"}' ;;
        *"snapshots list"*)
          state_file="$(dirname "$0")/snapshot-list-count"
          if [ -f "$state_file" ]; then
            echo '[{"id":"vs_new","status":"created"},{"id":"vs_new","status":"failed"}]'
          else
            touch "$state_file"
            echo '[]'
          fi ;;
        *) exit 1 ;;
      esac`,
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("terminal state 'failed'");
    expect(result.stdout).not.toContain("Verified Fly volume snapshot");
  });

  it("fails closed when the configured volume is ambiguous", () => {
    const result = runBackup(
      `echo '[{"id":"vol_123","name":"cosyworld_data","state":"created","attached_machine_id":"machine_123"},{"id":"vol_456","name":"cosyworld_data","state":"created","attached_machine_id":"machine_456"}]'`,
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("expected exactly one active volume");
  });

  it("accepts a healthy volume report below the configured threshold", () => {
    const result = runVolumeGuard(
      'echo "Connecting to fdaa:73:809:a7b:8c:51:4894:2..." >&2\n' +
        'echo "Filesystem 1024-blocks Used Available Capacity Mounted on"\n' +
        'echo "/dev/vdb 100000 42000 58000 42% /data"',
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("example-world /data is 42% used");
  });

  it("checks production volume headroom every fifteen minutes", () => {
    expect(flyHealthWorkflow).toContain('cron: "*/15 * * * *"');
    expect(flyHealthWorkflow).toContain(
      "check-fly-volume-space.sh cosyworld /data 70",
    );
    expect(flyHealthWorkflow).toContain(
      "check-fly-volume-space.sh cosyworld-lonelyforest /data 70",
    );
    expect(flyHealthWorkflow).toContain(
      "FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}",
    );
    expect(flyHealthWorkflow).toContain(
      "FLY_API_TOKEN: ${{ secrets.FLY_LONELYFOREST_API_TOKEN }}",
    );
  });

  it("alerts on OOM exits for both Fly apps every fifteen minutes", () => {
    expect(flyHealthWorkflow).toContain('cron: "*/15 * * * *"');
    for (const app of ["cosyworld", "cosyworld-lonelyforest"]) {
      expect(flyHealthWorkflow).toContain(
        `node v2/scripts/check-fly-oom.mjs personal ${app} 30m`,
      );
    }
    expect(flyHealthWorkflow).toContain(
      "FLY_METRICS_READ_TOKEN: ${{ secrets.FLY_METRICS_READ_TOKEN }}",
    );
  });

  it("uses one scheduled workflow and one runner per Fly app", () => {
    for (const retired of ["oom-alert", "volume-headroom"]) {
      expect(
        existsSync(
          new URL(`../../.github/workflows/${retired}.yml`, import.meta.url),
        ),
      ).toBe(false);
    }
    expect(flyHealthWorkflow.match(/cron:/g)).toHaveLength(1);
    expect(flyHealthWorkflow.match(/runs-on: ubuntu-latest/g)).toHaveLength(2);
    expect(flyHealthWorkflow.match(/uses: actions\/checkout@v7/g)).toHaveLength(
      2,
    );
    expect(flyHealthWorkflow).toContain("contents: read");
  });

  it.each([
    ["primary", "lonely-forest", "primary", "cosyworld", "FLY_API_TOKEN"],
    [
      "lonely-forest",
      undefined,
      "lonelyforest",
      "cosyworld-lonelyforest",
      "FLY_LONELYFOREST_API_TOKEN",
    ],
  ])(
    "keeps %s checks independent and failures visible",
    (name, next, budget, app, secret) => {
      const healthJob = workflowJob(flyHealthWorkflow, name, next);
      const steps = healthJob.split(/\n      - name: /).slice(1);
      const checks = steps.filter((step) => step.startsWith("Check "));
      expect(checks).toHaveLength(3);
      expect(healthJob).not.toMatch(/\n\s+continue-on-error:/);
      expect(healthJob).not.toMatch(/\n\s+needs:/);
      expect(healthJob).not.toContain("|| true");
      expect(healthJob).toContain(
        `node v2/scripts/check-fly-oom.mjs personal ${app} 30m`,
      );
      expect(healthJob).toContain(
        `node v2/scripts/check-storage-budget.mjs ${budget}`,
      );
      expect(healthJob).toContain(
        `scripts/check-fly-volume-space.sh ${app} /data 70`,
      );
      expect(healthJob).toContain(`FLY_API_TOKEN: \${{ secrets.${secret} }}`);
      expect(healthJob).toContain(
        "FLY_METRICS_READ_TOKEN: ${{ secrets.FLY_METRICS_READ_TOKEN }}",
      );
      for (const check of checks) {
        const dependency = check.includes("volume headroom")
          ? "flyctl"
          : "node";
        expect(check).toContain(
          `if: \${{ !cancelled() && steps.checkout.outcome == 'success' && steps.${dependency}.outcome == 'success' }}`,
        );
        expect(check).toMatch(/timeout-minutes: [1-3]/);
      }
      const flyctl = steps.find((step) => step.startsWith("Setup flyctl"));
      expect(flyctl).toContain(
        "if: ${{ !cancelled() && steps.checkout.outcome == 'success' }}",
      );
      expect(flyctl).not.toContain("steps.node");
    },
  );

  it("allows manual checks for either app without interrupting scheduled coverage", () => {
    expect(flyHealthWorkflow).toContain("workflow_dispatch:");
    expect(flyHealthWorkflow).toContain("default: all");
    for (const app of ["cosyworld", "cosyworld-lonelyforest"]) {
      expect(flyHealthWorkflow).toContain(`- ${app}`);
      expect(flyHealthWorkflow).toContain(
        `if: \${{ github.event_name != 'workflow_dispatch' || inputs.app == 'all' || inputs.app == '${app}' }}`,
      );
    }
    expect(flyHealthWorkflow).toContain(
      "group: fly-health-${{ github.repository }}-${{ github.event_name }}-${{ inputs.app || 'all' }}",
    );
  });

  it("keeps the image workshop configured on both Fly tenants", () => {
    const model =
      'COSYWORLD_REPLICATE_AVATAR_MODEL = "black-forest-labs/flux-dev-lora"';
    const mirquoLora = 'COSYWORLD_REPLICATE_AVATAR_LORA = "immanencer/mirquo"';
    const loraInput = 'COSYWORLD_REPLICATE_AVATAR_LORA_INPUT = "lora_weights"';
    const loraScaleInput =
      'COSYWORLD_REPLICATE_AVATAR_LORA_SCALE_INPUT = "lora_scale"';
    const trigger =
      'COSYWORLD_REPLICATE_AVATAR_PROMPT_PREFIX = "MRQ, cozy storybook trading-card portrait"';
    const visionModel = 'COSYWORLD_AI_VISION_MODEL = "openai/gpt-5-image-mini"';
    const visionReasoning = 'COSYWORLD_AI_VISION_REASONING_EFFORT = "low"';

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

  it("uses the low-latency model for unbound and player-avatar voice", () => {
    const voiceDefault =
      'COSYWORLD_AI_CAPABILITY_MODELS_JSON = \'{"voice":"openai/gpt-5.4-nano"';
    const voiceDeclaration =
      '"requested_model_id":"openai/gpt-5.4-nano","provider":"openrouter"';

    for (const config of [primaryFlyConfig, lonelyForestFlyConfig]) {
      expect(config).toContain(voiceDefault);
      expect(config).toContain(voiceDeclaration);
      expect(config).not.toContain('"voice":"mistralai/mistral-nemo"');
    }
    expect(lonelyForestFlyConfig).toContain(
      'OPENROUTER_CHAT_MODEL = "openai/gpt-5.4-nano"',
    );
  });

  it("copies every out-of-crate compile-time input into the release image build", () => {
    const dependencyBuild =
      "RUN cargo chef cook --release --recipe-path /app/recipe.json";
    const engineVersionCopy =
      "COPY v2/content-engine-version.txt /app/v2/content-engine-version.txt";
    const mediaCopy = "COPY v2/media /app/v2/media";
    // Matched without the RUN prefix so the ordering contract survives
    // env prefixes on the build command, such as CARGO_BUILD_JOBS.
    const releaseBuild = "cargo build --release";

    expect(dockerignore).toContain("!v2/content-engine-version.txt");
    expect(dockerignore).toContain("!v2/media/");
    expect(dockerignore).toContain("!v2/media/**");
    expect(dockerfile).toContain(engineVersionCopy);
    expect(dockerfile).toContain(mediaCopy);
    expect(dockerfile.indexOf(dependencyBuild)).toBeLessThan(
      dockerfile.indexOf(engineVersionCopy),
    );
    expect(dockerfile.indexOf(engineVersionCopy)).toBeLessThan(
      dockerfile.indexOf(releaseBuild),
    );
    expect(dockerfile.indexOf(dependencyBuild)).toBeLessThan(
      dockerfile.indexOf(mediaCopy),
    );
    expect(dockerfile.indexOf(mediaCopy)).toBeLessThan(
      dockerfile.indexOf(releaseBuild),
    );
  });
});
