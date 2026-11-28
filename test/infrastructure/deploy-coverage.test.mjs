import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const checksWorkflow = readFileSync(
  new URL("../../.github/workflows/fast-check.yml", import.meta.url),
  "utf8",
);
const deployWorkflow = readFileSync(
  new URL("../../.github/workflows/deploy.yml", import.meta.url),
  "utf8",
);
const vitestConfig = readFileSync(
  new URL("../../vitest.config.js", import.meta.url),
  "utf8",
);

describe("deployment checks", () => {
  it("runs every infrastructure test in the full unit shards for both release paths", () => {
    for (const source of [checksWorkflow, deployWorkflow]) {
      expect(source).toContain("npx vitest run --shard=${{ matrix.shard }}/3");
    }
    expect(vitestConfig).toMatch(/include:\s*\[\s*'test\/\*\*\/\*\.test\.\{js,mjs\}'/);
  });

  it("does not rerun unit tests in the production content gate", () => {
    const gate = deployWorkflow.slice(
      deployWorkflow.indexOf("\n  production-node-gate:"),
      deployWorkflow.indexOf("\n  production-unit:"),
    );
    expect(gate).toContain("npm run v2:syntax");
    expect(gate).not.toMatch(/\bvitest\b/);
  });
});

describe("deploy triggers", () => {
  it("main pushes deploy .dev, tags deploy production, and a schedule catches up", () => {
    expect(deployWorkflow).toMatch(
      /on:\n {2}push:\n {4}branches: \[main\]\n {4}tags: \["v\*"\]\n {4}paths-ignore: .*\n {2}schedule:\n {4}- cron: "23 \*\/2 \* \* \*"\n {2}workflow_dispatch:\n/,
    );
  });
});

describe("exactly one actor owns the release lever", () => {
  it("a queued run yields cleanly before its expensive gates when main has advanced", () => {
    expect(deployWorkflow).toContain(
      "Confirm committed release still owns production",
    );
    expect(deployWorkflow).toContain("Superseded: main advanced to");
    expect(deployWorkflow).toContain('echo "owns=false" >> "$GITHUB_OUTPUT"');
    expect(deployWorkflow).toMatch(
      /production-node-gate:[\s\S]*needs\.release-owner\.outputs\.owns == 'true'/,
    );
  });

  it("only the .dev jobs queue, so no .dev run can replace a production run", () => {
    // The supersede script serializes production rollouts instead.
    expect(deployWorkflow).not.toMatch(/^concurrency:/m);
    expect(deployWorkflow.match(/^ {4}concurrency:$/gm)).toHaveLength(3);
    expect(deployWorkflow).not.toContain("actions/runs?status=");
    expect(deployWorkflow).not.toContain("group: deploy-lonelyforest-production");
  });

  it("a newer production run supersedes an older one only before its rollouts", () => {
    expect(deployWorkflow).toContain("format('Deploy {0} to {1}', github.ref_name, inputs.target || 'both')");
    expect(deployWorkflow).toContain("node scripts/supersede-production-deploy.mjs start");
    for (const [app, step] of [
      ["primary", "- name: Deploy primary Fly app"],
      ["lonelyforest", "- name: Deploy Lonely Forest\n"],
    ]) {
      const claim = deployWorkflow.indexOf(`supersede-production-deploy.mjs claim ${app}`);
      const wait = deployWorkflow.indexOf(`supersede-production-deploy.mjs wait ${app}`);
      expect(claim).toBeGreaterThan(-1);
      expect(wait).toBeGreaterThan(-1);
      // The claim is the last check before the rollout, and the backup
      // waits for other rollouts of the same app.
      expect(claim).toBeLessThan(deployWorkflow.indexOf(step));
      expect(deployWorkflow.indexOf(step) - claim).toBeLessThan(600);
      expect(wait).toBeLessThan(deployWorkflow.indexOf("Create rollback backup", wait));
    }
    expect(deployWorkflow).toContain(
      'scripts/rolled-out-in-run.sh "Deploy primary to Fly" "Deploy primary Fly app"',
    );
  });

  it("a merge that produces no successful deploy opens a loud tracking issue", () => {
    expect(deployWorkflow).toContain("Report production deployment outcome");
    expect(deployWorkflow).toContain("Production did not deploy ${GITHUB_SHA:0:7}");
    expect(deployWorkflow).toMatch(/permissions:\s*\n(?:\s*contents: read\n)?\s*issues: write/);
  });

  it("the deploy workflow cancels only older .dev checks and builds", () => {
    // deploy-workflow.test.mjs checks which jobs cancel.
    expect(deployWorkflow.match(/cancel-in-progress: \S+/g)).toEqual([
      "cancel-in-progress: true",
      "cancel-in-progress: true",
      "cancel-in-progress: false",
    ]);
  });
});
