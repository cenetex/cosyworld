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

import { isKnownNonProductionPath } from "../../scripts/check-deployment-impact.mjs";

const workflow = readFileSync(
  new URL("../../.github/workflows/deploy.yml", import.meta.url),
  "utf8",
);
const checksWorkflow = readFileSync(
  new URL("../../.github/workflows/fast-check.yml", import.meta.url),
  "utf8",
);
const deployScripts = readFileSync(
  new URL("../../.github/workflows/deploy.yml", import.meta.url),
  "utf8",
);
const packageScripts = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
).scripts;
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

describe("deploy workflow", () => {
  it("only invokes package scripts that exist", () => {
    const invokedScripts = [checksWorkflow, deployScripts].flatMap((source) =>
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

  it("ships the checksummed card ranker file", () => {
    expect(cardPolicyModel.subarray(0, 8).toString("utf8")).toBe("CWRANK2\n");
    expect(cardPolicyModel).toHaveLength(516);
    expect(createHash("sha256").update(cardPolicyModel).digest("hex")).toBe(
      "778558accea1d57cc7fbb1a169cbc2c29d37672971141e2800421c9131775cf4",
    );
    expect(dockerignore).toContain("!models/card-policy/**");
    expect(dockerfile).toContain(
      "COPY models/card-policy /app/models/card-policy",
    );
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
    const nodeGate = job("production-node-gate", "production-unit");
    const rustGate = job("production-rust-gate", "production-rust-lint");
    const rustLint = job("production-rust-lint", "production-gate");
    const gate = job("production-gate", "primary-fly");
    expect(nodeGate).toContain("npm run v2:worldpack");
    expect(nodeGate).toContain("npm run v2:syntax");
    expect(nodeGate).toContain(
      "npx vitest run test/infrastructure/deploy-workflow.test.mjs",
    );
    expect(nodeGate).not.toContain("npm test");
    for (const check of ["npm run lint", "npm run check:test-guards", "npm run regen:check"])
      expect(nodeGate).toContain(check);
    const unit = job("production-unit", "production-rust-gate");
    expect(unit).toContain("shard: [1, 2, 3]");
    expect(unit).toContain("npx vitest run --shard=${{ matrix.shard }}/3");
    expect(rustGate).toContain("uses: actions/cache/restore@v6");
    expect(rustGate).toContain(
      "restore-keys: ${{ runner.os }}-cargo-deps-v1-\n",
    );
    expect(rustGate).not.toContain("uses: actions/cache@v6");
    expect(rustGate).toContain("bash v2/scripts/check-rust.sh test");
    // Lint runs in its own job beside the tests.
    expect(rustGate).not.toContain("check-rust-lint.sh");
    for (const rust of [rustGate, rustLint])
      expect(rust).not.toMatch(/await-ci-rust|steps\.ci\.|checks: read/);
    expect(rustLint).toContain("bash v2/scripts/check-main-size.sh");
    expect(rustLint).toContain("bash v2/scripts/check-rust-lint.sh");
    expect(gate).toContain(
      "needs: [deployment-impact, release-owner, production-node-gate, production-unit, production-rust-gate, production-rust-lint]",
    );
    expect(gate).toContain('test "$NODE_RESULT" = success');
    expect(gate).toContain('test "$UNIT_RESULT" = success');
    expect(gate).toContain('test "$RUST_RESULT" = success');
    expect(gate).toContain('test "$RUST_LINT_RESULT" = success');
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
    // The card-only server has no classic worldpack bundle to compare (#1652).
    expect(workflow).not.toContain("check-deploy-worldpack");
    expect(workflow).not.toContain("recovery_capture");
  });

  it("checks main beside the .dev build, without holding the rollout", () => {
    const checks = job("dev-checks", "dev-image");
    expect(checks).toContain("needs: dev-plan\n    if: needs.dev-plan.outputs.deploy == 'true'");
    expect(checks).toContain("cancel-in-progress: true");
    expect(checks).toContain("uses: ./.github/workflows/fast-check.yml");
    expect(checks).toContain("base: ${{ needs.dev-plan.outputs.checks-base }}");
    expect(job("dev-plan", "dev-checks")).toContain(
      "checks-base: ${{ steps.checked.outputs.base || steps.impact.outputs.base }}",
    );
    expect(job("dev-plan", "dev-checks")).toContain("node scripts/last-dev-rollout.mjs --checked");
    expect(job("dev-deploy", "deployment-impact")).toContain("needs: [dev-plan, dev-image]");
    const called = readFileSync(
      new URL("../../.github/workflows/fast-check.yml", import.meta.url),
      "utf8",
    );
    expect(called).toMatch(/^on:\n  workflow_call:\n/m);
    expect(called).not.toContain("pull_request");
    expect(called).toContain("name: All checks\n    if: ${{ !cancelled() }}");
  });

  it("deploys .dev on a main push, outside the release path", () => {
    const fullRelease =
      "(startsWith(github.ref, 'refs/tags/') || (github.event_name == 'workflow_dispatch' && inputs.target != 'dev'))";
    const train =
      "github.ref == 'refs/heads/main' &&\n      (((github.event_name == 'push' || github.event_name == 'schedule') && vars.COSYWORLD_DEV_TRAIN != 'off') ||\n       (github.event_name == 'workflow_dispatch' && inputs.target == 'dev'))";
    // The plan, the image build and the rollout.
    const dev = job("dev-plan", "deployment-impact");
    const impact = job("deployment-impact", "release-owner");
    const nodeGate = job("production-node-gate", "production-unit");
    const unitGate = job("production-unit", "production-rust-gate");
    const rustGate = job("production-rust-gate", "production-rust-lint");
    const rustLint = job("production-rust-lint", "production-gate");
    const gate = job("production-gate", "primary-fly");
    const primaryBackup = job("primary-backup", "primary-fly");
    const primaryFly = job("primary-fly", "lonelyforest-image");

    // Every release job hangs off the impact job, which runs only for tags
    // and production dispatches.
    expect(dev).toContain(`if: >-\n      ${train}`);
    expect(dev).toContain(
      "needs: dev-plan\n    if: needs.dev-plan.outputs.deploy == 'true'",
    );
    expect(dev).toContain("needs: [dev-plan, dev-image]");
    expect(impact).toContain(
      "if: startsWith(github.ref, 'refs/tags/') || (github.event_name == 'workflow_dispatch' && inputs.target != 'dev')",
    );
    expect(dev).not.toContain("production-gate");
    expect(dev).not.toContain("backup-fly-v2.sh");
    expect(dev).not.toContain("lonelyforest");
    expect(dev).not.toContain("FLY_LONELYFOREST_API_TOKEN");

    // The gates run only for tags and production dispatches, never after a
    // train, so no train holds the .dev group for them.
    for (const rust of [nodeGate, unitGate, rustGate, rustLint]) {
      expect(rust).toContain(
        "needs: [deployment-impact, release-owner]\n    if: needs.deployment-impact.outputs.deploy == 'true' && needs.release-owner.outputs.owns == 'true'\n",
      );
      expect(rust).not.toContain("dev-deploy");
    }
    expect(gate).toContain(`if: \${{ always() && ${fullRelease} }}`);
    expect(gate).not.toContain("FULL_RELEASE");
    expect(primaryBackup).toContain("startsWith(github.ref, 'refs/tags/') ||");
    expect(primaryBackup).toContain(
      "(github.event_name == 'workflow_dispatch' &&\n        (inputs.target == 'both' || inputs.target == 'primary'))",
    );
    expect(primaryBackup).not.toContain("github.event_name == 'push' ||");
    expect(primaryFly).toContain("!cancelled()");
    expect(primaryFly).toContain("needs.primary-image.result == 'success'");
    expect(primaryFly).toContain(
      "needs.production-gate.result == 'success' &&",
    );
    expect(primaryFly).toContain("needs.primary-backup.result == 'success'");
    expect(primaryFly).not.toContain("refs/heads/main");

    // The plan compares with what .dev runs and labels the drop, the build
    // saves its cache while the rollout runs, then the rollout verifies.
    const order = [
      "node scripts/fly-machines-serve-commit.mjs cosyworld --serving || true",
      'bash scripts/plan-dev-deploy.sh "${base:-$(node scripts/last-dev-rollout.mjs)}"',
      'node scripts/dev-release.mjs image-input "$IMAGE_COMMIT" "$GITHUB_SHA"',
      'bash scripts/dev-train-summary.sh >> "$GITHUB_STEP_SUMMARY"',
      "bash scripts/prepare-fly-image.sh cosyworld fly.toml",
      "actions/cache/save@v6",
      "bash scripts/serialize-primary-rollout.sh dev",
      'release="$(node scripts/fly-machines-serve-commit.mjs cosyworld --serving)"',
      'bash scripts/stage-dev-release.sh >> "$GITHUB_OUTPUT"',
      'bash scripts/fly-rollout.sh --config fly.toml --image "$RELEASE_IMAGE" --strategy "$STRATEGY" --env "COSYWORLD_SOURCE_COMMIT=$GITHUB_SHA" --env "COSYWORLD_IMAGE_COMMIT=$IMAGE_COMMIT"',
      "node v2/scripts/smoke-deployed-readiness.mjs https://cosyworld.fly.dev",
      'COSYWORLD_SMOKE_MANIFEST="$RUNNER_TEMP/dev-release/manifest.json" node v2/scripts/smoke-deployed-card-game.mjs',
      "node release/v2/scripts/smoke-deployed-card-game.mjs https://cosyworld.fly.dev",
      'git show "$PREVIOUS_COMMIT:fly.toml" > fly.previous.toml',
      'bash scripts/fly-rollout.sh --config "$config" --image "$PREVIOUS_IMAGE"',
    ];
    for (const [index, text] of order.entries()) {
      expect(dev).toContain(text);
      if (index)
        expect(dev.indexOf(order[index - 1])).toBeLessThan(dev.indexOf(text));
    }
    expect(dev).toContain("needs.dev-plan.outputs.deploy == 'true' && needs.dev-plan.outputs.image == 'true'");
    expect(dev).toContain("(needs.dev-image.result == 'success' || needs.dev-plan.outputs.image != 'true')");
    expect(dev).toContain("FAST: ${{ needs.dev-plan.outputs.image != 'true' }}");
    expect(dev).toContain("if: steps.serving.outputs.rollout == 'true' && env.FAST == 'true'");
    expect(dev).toContain("RELEASE_IMAGE: ${{ needs.dev-image.outputs.image || steps.serving.outputs.image }}");
    expect(dev).toContain("IMAGE_COMMIT: ${{ env.FAST == 'true' && steps.serving.outputs.image_commit || github.sha }}");
    expect(dev).toContain("if: steps.rollout.outcome == 'success' && env.FAST != 'true'");
    expect(dev).toContain('[ "$RELEASES" != off ]');
    expect(dev).toContain("COSYWORLD_EXPECT_COMMIT: ${{ github.sha }}");
    expect(dev).toContain("POLLS: ${{ env.FAST == 'true' && '20' || '1' }}");
    // A newer push cancels an older build, never a rollout. A run that
    // deploys nothing gets a group of its own and cancels nothing.
    expect(dev).toContain(
      "concurrency:\n      group: deploy-${{ github.repository }}-dev-image${{ needs.dev-plan.outputs.deploy != 'true' && format('-{0}', github.run_id) || '' }}\n      cancel-in-progress: true\n",
    );
    expect(dev).toContain(
      "concurrency:\n      group: deploy-${{ github.repository }}-dev\n      cancel-in-progress: false\n",
    );
    expect(dev).toContain('compare/${commit}...${GITHUB_SHA}" --jq .status)" ||');
    expect(dev).toContain('ahead | diverged) echo "rollout=true" >> "$GITHUB_OUTPUT" ;;');
    expect(dev).toContain("id: rollout\n        if: steps.serving.outputs.rollout == 'true'");
    expect(dev).toContain(
      "- name: Roll .dev back to ${{ steps.serving.outputs.commit }}\n        if: failure() && steps.rollout.outcome != 'skipped' && steps.serving.outputs.image != ''",
    );
    expect(dev).toContain("FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}");
    expect(dev).toContain("actions: read");
    expect(dev).not.toContain("actions: write");
    expect(dev).not.toContain("yield-superseded");
    expect(dev).toContain(
      "rolled-out: ${{ steps.rollout.outcome == 'success' }}",
    );
    expect(dev).toContain("for attempt in {1..60}");
    expect(dev).toContain("remained degraded after 120 seconds");
  });

  it("skips a push that changes only paths the impact check ignores", () => {
    const ignored = workflow.match(/^ {4}paths-ignore: \[(.*)\]$/m)[1];
    expect(ignored).toBe(
      '"**.md", "docs/**", "sites/**", "test/**", "v2/docs/**", "v2/tests/**", "v2/mvp.sh"',
    );
    for (const file of [
      "v2/card-game/README.md",
      "docs/design/books.md",
      "sites/lonelyforest/index.html",
      "test/card-rest.test.mjs",
      "v2/docs/a.txt",
      "v2/tests/a.mjs",
      "v2/mvp.sh",
    ])
      expect(isKnownNonProductionPath(file), file).toBe(true);
  });

  it("keeps every Lonely Forest gate and backup for tags and dispatches", () => {
    const forestBackup = job("lonelyforest-backup", "lonelyforest-fly");
    const forestFly = job("lonelyforest-fly", "deploy-outcome");
    for (const forestJob of [forestBackup, forestFly]) {
      expect(forestJob).toContain("startsWith(github.ref, 'refs/tags/v')");
      expect(forestJob).toContain("github.event_name == 'workflow_dispatch'");
      expect(forestJob).not.toContain("refs/heads/main");
    }
    expect(forestFly).toContain("needs.production-gate.result == 'success'");
    expect(forestFly).toContain(
      "needs.lonelyforest-backup.result == 'success'",
    );
    expect(forestFly).toContain("needs.lonelyforest-image.result == 'success'");
  });

  it("checks version alignment without requiring a bump per change", () => {
    expect(checksWorkflow).toContain("name: Check version alignment");
    expect(checksWorkflow).not.toContain("Ensure version bumped");
    const check = readFileSync(
      new URL("../../scripts/check-version-bump.mjs", import.meta.url),
      "utf8",
    );
    expect(check).not.toContain("Please bump the version");
    expect(workflow).not.toMatch(/flyctl deploy --config/);
    const deploys = workflow.match(/fly-rollout\.sh --config [^\n]+/g);
    expect(deploys).toHaveLength(5);
    const restoring = deploys.filter((deploy) => /DEV_SHA|PREVIOUS/.test(deploy));
    expect(restoring).toEqual([
      'fly-rollout.sh --config "$config" --image "$PREVIOUS_IMAGE" --strategy rolling --env "COSYWORLD_SOURCE_COMMIT=$PREVIOUS_COMMIT" --env "COSYWORLD_IMAGE_COMMIT=$PREVIOUS_IMAGE_COMMIT"',
      'fly-rollout.sh --config fly.toml --image "registry.fly.io/cosyworld:deploy-${built}" --strategy rolling --env "COSYWORLD_SOURCE_COMMIT=${DEV_SHA}" --env "COSYWORLD_IMAGE_COMMIT=${built}"',
    ]);
    for (const deploy of deploys.filter((d) => !restoring.includes(d))) {
      expect(deploy).toContain('--env "COSYWORLD_SOURCE_COMMIT=$GITHUB_SHA"');
    }
  });

  it("returns .dev to the newer main commit a tag deploy replaced", () => {
    const restore = job("restore-dev", "lonelyforest-image");
    expect(restore).toContain("needs: [primary-fly]");
    // dev-deploy is always skipped on a tag, and the implicit success()
    // then skipped this job on v1.2.116 and v1.2.117.
    expect(restore).toMatch(
      /if: >-\n\s+!cancelled\(\) &&\n\s+startsWith\(github\.ref, 'refs\/tags\/'\) &&\n\s+needs\.primary-fly\.result == 'success'\n/,
    );
    // A partial rerun drops primary-fly's outputs; a superseded tag skipped
    // its rollout step, so it restores nothing.
    expect(restore).toContain(
      '[ "$DEPLOYED" = "true" ] || scripts/rolled-out-in-run.sh "Deploy primary to Fly" "Deploy primary Fly app"',
    );
    expect(restore).toContain("if: steps.rolled.outputs.deployed == 'true'");
    expect(restore).toContain("node scripts/last-dev-rollout.mjs");
    expect(restore).toContain(
      "name: Roll .dev forward to ${{ steps.previous.outputs.sha }}",
    );
    // Only a commit ahead of the tag is restored, from its own image.
    expect(restore).toContain("compare/${GITHUB_SHA}...${sha}");
    expect(restore).toContain('if [ "$status" = ahead ]; then');
    expect(restore).toContain('git checkout --quiet "$DEV_SHA"');
    expect(restore).toContain(
      'GITHUB_SHA="$DEV_SHA" exec node v2/scripts/smoke-deployed-card-game.mjs https://cosyworld.fly.dev',
    );
    expect(restore).not.toContain("FLY_LONELYFOREST_API_TOKEN");
    const outcome = job("deploy-outcome", "github-release");
    expect(outcome).toContain("- restore-dev");
    expect(outcome).toContain("needs.restore-dev.result == 'failure'");
  });

  it("keeps the pre-push hook to fast checks", () => {
    const hook = readFileSync(
      new URL("../../git-hooks/pre-push", import.meta.url),
      "utf8",
    );
    expect(hook).toContain("# cosyworld-version-hook");
    expect(hook).toContain("npm run check:version");
    expect(hook).not.toMatch(/^\s*npm run check\s*$/m);
    expect(hook).not.toContain("v2:rust:test");
    expect(hook).not.toContain("v2:kernel");
    expect(packageScripts.check).toContain("v2:rust:test");
  });

  it("promotes the image .dev built instead of building it again", () => {
    const primary = job("primary-image", "primary-backup");
    expect(primary).toContain("actions: read");
    expect(primary.indexOf("bash scripts/await-dev-image.sh")).toBeLessThan(
      primary.indexOf("bash scripts/prepare-fly-image.sh cosyworld fly.toml"),
    );
    expect(primary).toContain(
      'node scripts/check-deployment-impact.mjs "$base" "$GITHUB_SHA" | grep -qx deploy=false',
    );
    expect(primary).toContain(
      "EQUIVALENT_COMMIT: ${{ steps.dev.outputs.commit }}",
    );
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

  it("uses compact Rust profiles and the dependency cache rust-cache.yml saves", () => {
    for (const source of [checksWorkflow, workflow]) {
      expect(source).toContain('CARGO_PROFILE_DEV_DEBUG: "0"');
      expect(source).toContain('CARGO_PROFILE_TEST_DEBUG: "0"');
      expect(source).toContain("-cargo-deps-v1-");
      expect(source).not.toMatch(/-cargo-(compact|orchestrator)-/);
    }
  });

  it("skips each quarantined flaky Rust test, which still exists", () => {
    const checkRust = readFileSync(
      new URL("../../v2/scripts/check-rust.sh", import.meta.url),
      "utf8",
    );
    // The list may be empty; every entry names its issue and fix-by date.
    const entries = checkRust
      .match(/^QUARANTINED_TESTS=\(\n([\s\S]*?)^\)$/m)[1]
      .split("\n")
      .filter((line) => line.trim());
    const names = entries.map(
      (line) => line.match(/^\s+(\w+) # #\d+, fix by \d{4}-\d{2}-\d{2}$/)?.[1],
    );
    expect(names).not.toContain(undefined);
    expect(checkRust).toContain('skips+=(--skip "$name")');
    const rustMain = readFileSync(
      new URL("../../v2/orchestrator-rust/src/main.rs", import.meta.url),
      "utf8",
    );
    for (const name of names) {
      expect(rustMain).toContain(`#[test]\n    fn ${name}()`);
    }
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
      "COPY --from=orchestrator-binary /app/bin/cosyworld-orchestrator /app/cosyworld-orchestrator",
    );
    expect(dockerfile).toContain("ARG CARGO_BUILD_JOBS=1");
    expect(dockerfile).toContain(
      "CARGO_INCREMENTAL=1 CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS}",
    );
  });

  it("builds the binary in the Dockerfile unless a main push supplies one", () => {
    // The default stays the in-image build used by tags, dispatches and the
    // Fly builder.
    const [preamble] = dockerfile.split(/^FROM /m);
    expect(preamble).toContain("ARG ORCHESTRATOR_BINARY=build");
    expect(dockerfile).toContain(
      "FROM ${ORCHESTRATOR_BINARY} AS orchestrator-binary",
    );
    expect(dockerfile.indexOf("AS build")).toBeLessThan(
      dockerfile.indexOf("AS orchestrator-binary"),
    );
    expect(dockerfile).toContain("COPY v2/content /app/v2/content");
    expect(dockerfile).not.toContain("COPY --from=build");
  });

  it("keeps the release target between main-push deploys only", () => {
    const dev = job("dev-image", "dev-deploy");
    expect(dev).toContain("actions/cache/restore@v6");
    expect(dev).toContain("actions/cache/save@v6");
    expect(dev).toContain("path: ${{ runner.temp }}/release-target");
    expect(dev).toContain(
      "key: release-target-v1-${{ hashFiles('Dockerfile') }}-${{ steps.release-cache-key.outputs.day }}",
    );
    expect(dev).toContain(
      "COSYWORLD_RELEASE_TARGET_CACHE: ${{ runner.temp }}/release-target",
    );
    expect(dev).toContain("steps.release-cache.outputs.cache-hit != 'true'");
    expect(dev).toContain("steps.image.outcome == 'success'");
    expect(dev).toContain(
      "key: ${{ steps.release-cache.outputs.cache-primary-key }}",
    );
    expect(dev.indexOf("Prepare primary image")).toBeLessThan(
      dev.indexOf("Save release build cache"),
    );
    for (const [name, next] of [
      ["primary-image", "primary-backup"],
      ["lonelyforest-image", "lonelyforest-backup"],
      ["lonelyforest-fly", "deploy-outcome"],
    ]) {
      expect(job(name, next)).not.toContain("release-target");
      expect(job(name, next)).not.toContain("actions/cache");
    }
  });

  it("exports the registry build cache only for in-image builds", () => {
    const build = readFileSync(
      new URL("../../scripts/build-release-image.sh", import.meta.url),
      "utf8",
    );
    expect(build).toContain(
      'cache_args=(--cache-from "type=registry,ref=$cache")',
    );
    expect(build).toMatch(
      /if \[ -z "\$prebuilt" \]; then\n\s+cache_args\+=\(--cache-to "type=registry,ref=\$cache,mode=max/,
    );
    expect(build).toContain('"${cache_args[@]}" --provenance=false');
  });

  it("runs Lonely Forest as one process like primary", () => {
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
    expect(workflow).not.toContain("lonelyforest_fresh_empty_tenant");
    expect(dockerfile).not.toContain("nginx");
    expect(
      existsSync(new URL("../../deploy/lonelyforest", import.meta.url)),
    ).toBe(false);
  });

  it("queues .dev and production apart and keeps their rollouts apart", () => {
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).not.toContain("group: deploy-${{ github.ref }}");
    const dev = job("dev-deploy", "deployment-impact");
    expect(dev).toContain("bash scripts/serialize-primary-rollout.sh dev");
    // The wait is the last step before the rollout.
    expect(dev.indexOf("- name: Wait for production deploys")).toBeLessThan(
      dev.indexOf("- name: Roll out .dev"),
    );
    for (const [name, next, step] of [
      ["primary-backup", "primary-fly", "Guard primary volume free space"],
      ["primary-fly", "lonelyforest-image", "Deploy primary Fly app"],
    ]) {
      const source = job(name, next);
      expect(source).toContain(
        "bash scripts/serialize-primary-rollout.sh production",
      );
      expect(source).toContain("actions: read");
      expect(source.indexOf("serialize-primary-rollout")).toBeLessThan(
        source.indexOf(step),
      );
    }
  });

  it("uses separate app-scoped release jobs before publishing a release", () => {
    const primaryJobs = job("primary-image", "lonelyforest-image");
    const lonelyForestJobs = job("lonelyforest-image", "deploy-outcome");
    const primaryFly = job("primary-fly", "lonelyforest-image");
    const lonelyForestFly = job("lonelyforest-fly", "deploy-outcome");
    expect(primaryFly).toContain(
      'fly-rollout.sh --config fly.toml --image "$RELEASE_IMAGE"',
    );
    expect(primaryJobs).toContain(
      "FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}",
    );
    expect(primaryJobs).not.toContain("FLY_LONELYFOREST_API_TOKEN");
    expect(lonelyForestFly).toContain(
      'fly-rollout.sh --config fly.lonelyforest.toml --image "$RELEASE_IMAGE" --ha=false',
    );
    for (const deploy of [primaryFly, lonelyForestFly])
      expect(deploy).toContain("COSYWORLD_FLY_WAIT_TIMEOUT: 5m");
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

  it("releases a tag both apps rolled out, across partial reruns", () => {
    const release = job("github-release");
    // Without !cancelled() the skipped dev-deploy upstream skipped the
    // release on v1.2.116 and v1.2.117.
    expect(release).toMatch(
      /if: >-\n\s+!cancelled\(\) &&\n\s+startsWith\(github\.ref, 'refs\/tags\/'\) &&\n\s+needs\.primary-fly\.result == 'success' &&\n\s+needs\.lonelyforest-fly\.result == 'success'\n/,
    );
    expect(release).toContain(
      'scripts/rolled-out-in-run.sh "Deploy primary to Fly" "Deploy primary Fly app"',
    );
    expect(release).toContain(
      'scripts/rolled-out-in-run.sh "Deploy Lonely Forest to Fly" "Deploy Lonely Forest"',
    );
    expect(release).toContain("actions: read");
    expect(release).toContain("if: steps.shipped.outputs.shipped == 'true'");
    // The step names the script looks up must match the rollout steps.
    expect(job("primary-fly", "restore-dev")).toContain(
      "- name: Deploy primary Fly app\n        id: deploy",
    );
    expect(job("lonelyforest-fly", "deploy-outcome")).toContain(
      "- name: Deploy Lonely Forest\n        id: deploy",
    );
  });

  it.each([
    ["primary-fly", "lonelyforest-image", "https://cosyworld.fly.dev"],
    ["lonelyforest-fly", "deploy-outcome", "https://lonelyforest.com"],
  ])(
    "checks readiness and persistence for %s without an external avatar feed",
    (name, next, url) => {
      const deploy = job(name, next);
      expect(deploy).toContain("for attempt in {1..13}");
      expect(deploy).toContain(
        `node v2/scripts/smoke-deployed-readiness.mjs ${url}`,
      );
      expect(deploy).not.toContain("ruby-high");
      expect(deploy).not.toContain("ownership feed");
      expect(deploy).toContain("sleep 10");
      expect(deploy).toContain("remained degraded after 120 seconds");
    },
  );

  it("reports only for runs that own their commit and closes shipped alerts (#1044)", () => {
    const outcome = job("deploy-outcome", "github-release");
    expect(outcome).toContain(
      "if: ${{ !cancelled() && needs.dev-plan.outputs.deploy != 'false' }}",
    );
    expect(outcome).not.toContain("if: always()");
    expect(outcome).toMatch(/permissions:\s+contents: read\s+issues: write/);
    expect(outcome).toContain("gh api --paginate");
    expect(outcome).toContain("compare/${sha}...${GITHUB_SHA}");
    expect(outcome).toMatch(
      /needs\.primary-fly\.outputs\.deployed == 'true' &&\s+needs\.lonelyforest-fly\.outputs\.deployed == 'true'\)/,
    );
  });

  it("lets a primary-only .dev train close the issues trains opened (#1420)", () => {
    const outcome = job("deploy-outcome", "github-release");
    expect(outcome).toContain("- Trigger: ${TRIGGER}");
    expect(outcome).toContain(
      "TRIGGER: ${{ ((github.ref == 'refs/heads/main' && github.event_name != 'workflow_dispatch') || inputs.target == 'dev') && '.dev train' || format('{0} {1}', github.event_name, github.ref) }}",
    );
    expect(outcome).toContain(
      "DEV_TRAIN: ${{ (github.ref == 'refs/heads/main' && github.event_name != 'workflow_dispatch') || inputs.target == 'dev' }}",
    );
    expect(outcome).toContain(
      String.raw`test("- Trigger: (push refs/heads/main|\\.dev train)\\r?\\n")`,
    );
    expect(outcome).toContain(
      'if [ "$DEV_TRAIN" = "true" ] && [ "$from_dev_train" != "true" ]; then',
    );
    // A train never runs Lonely Forest, so a skipped forest deploy
    // must not open an issue.
    const open = outcome.slice(
      outcome.indexOf("Open a loud tracking issue"),
      outcome.indexOf("Close tracking issues"),
    );
    expect(open).toContain("needs.lonelyforest-fly.result == 'failure'");
    for (const name of ["dev-plan", "dev-image", "dev-deploy"])
      expect(open).toContain(`needs.${name}.result == 'failure' ||`);
    expect(open).not.toContain("needs.lonelyforest-fly.result != 'success'");
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

  it("sets no environment the card-only server no longer reads", () => {
    const retired = [
      "COSYWORLD_PRIMARY_GAME",
      "COSYWORLD_CARD_POLICY_",
      "COSYWORLD_RENDEZVOUS_PARTY_",
      "COSYWORLD_STORY_METRICS_RETENTION_DAYS",
      "COSYWORLD_REPLICATE_AVATAR_",
      "COSYWORLD_AI_VISION_",
      "COSYWORLD_AI_VOICE_",
      "COSYWORLD_AI_DECISION_MODEL",
      "COSYWORLD_MEDIA_DAILY_LIMIT_MICROUSD",
      "COSYWORLD_COMMUNITY_IMAGE_ESTIMATED_COST_MICROUSD",
      "COSYWORLD_CANONICAL_",
      "COSYWORLD_GENERATION_",
      "COSYWORLD_CONTENT_ROOT",
    ];
    for (const config of [
      primaryFlyConfig,
      lonelyForestFlyConfig,
      dockerfile,
    ]) {
      for (const name of retired) expect(config).not.toContain(name);
    }
  });

  it("uses the card voice model for unbound and player-avatar voice", () => {
    const capabilities =
      'COSYWORLD_AI_CAPABILITY_MODELS_JSON = \'{"voice":"google/gemma-4-26b-a4b-it","intent_json":"openai/gpt-6-luna","world_content":"google/gemini-4-hydrogen"}\'';
    const voiceDeclaration =
      '"requested_model_id":"openai/gpt-6-luna","provider":"openrouter"';

    for (const config of [primaryFlyConfig, lonelyForestFlyConfig]) {
      expect(config).toContain(capabilities);
      expect(config).toContain(voiceDeclaration);
      expect(config).not.toContain('"voice":"mistralai/mistral-nemo"');
    }
    expect(lonelyForestFlyConfig).toContain(
      'OPENROUTER_CHAT_MODEL = "openai/gpt-6-luna"',
    );
  });

  it("answers residents on Gemma with Luna behind it on .dev and production", () => {
    const gemma = "google/gemma-4-26b-a4b-it";
    expect(primaryFlyConfig).toContain(`COSYWORLD_CARD_TEXT_MODEL = "${gemma}"`);
    expect(primaryFlyConfig).toContain(
      `COSYWORLD_CARD_FALLBACK_MODELS = '["openai/gpt-6-luna"]'`,
    );
    expect(primaryFlyConfig).toContain(
      `"requested_model_id":"${gemma}","provider":"openrouter"`,
    );
    expect(lonelyForestFlyConfig).toContain(`COSYWORLD_CARD_TEXT_MODEL = "${gemma}"`);
    expect(lonelyForestFlyConfig).toContain(
      `COSYWORLD_CARD_FALLBACK_MODELS = '["openai/gpt-6-luna"]'`,
    );
    expect(lonelyForestFlyConfig).toContain(
      `"requested_model_id":"${gemma}","provider":"openrouter"`,
    );
    const cast = (vale, moth, badger) =>
      `COSYWORLD_CARD_CHARACTER_MODELS_JSON = '{"vale":"${vale}","moth":"${moth}","keeper":"anthropic/claude-haiku-5.5","badger":"${badger}","listener":"${vale}"}'`;
    expect(primaryFlyConfig).toContain(cast(gemma, gemma, gemma));
    expect(lonelyForestFlyConfig).toContain(cast(gemma, gemma, gemma));
  });

  it("copies every out-of-crate compile-time input into the release image build", () => {
    const dependencyBuild =
      "RUN cargo chef cook --release --recipe-path /app/recipe.json";
    // Matched without the RUN prefix so the ordering contract survives
    // env prefixes on the build command, such as CARGO_BUILD_JOBS.
    const releaseBuild = "cargo build --release";
    const build = dockerfile.slice(
      dockerfile.indexOf(dependencyBuild),
      dockerfile.indexOf(releaseBuild),
    );

    expect(build).toContain("COPY v2/core-c /app/v2/core-c");
    for (const dir of ["v2/card-game", "v2/content", "v2/media"])
      expect(build).not.toContain(`COPY ${dir} `);
  });

  it("points the server at the assets directory the image ships", () => {
    expect(dockerfile).toContain(
      "COPY --link --from=assets /out/text/ /app/assets/",
    );
    expect(dockerfile).toContain("ENV COSYWORLD_ASSETS_DIR=/app/assets");
  });
});
