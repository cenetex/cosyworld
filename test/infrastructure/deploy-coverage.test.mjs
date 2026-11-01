import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ciWorkflow = readFileSync(
  new URL("../../.github/workflows/ci.yml", import.meta.url),
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

describe("deployment-only contracts run in manual CI", () => {
  it("the CI Node job runs the full vitest suite, which includes every infrastructure contract", () => {
    expect(ciWorkflow).toContain("npm test");
    expect(vitestConfig).toMatch(/include:\s*\[\s*'test\/\*\*\/\*\.test\.\{js,mjs\}'/);
  });

  it("the production deployment gate keeps running the same deployment-only contracts", () => {
    const gate = deployWorkflow.match(
      /Run Node and deployment contract checks\n\s*run: \|\n([\s\S]*?)\n\n {2}\w/,
    )?.[1];
    expect(gate).toBeTruthy();
    expect(gate).toContain("npm run v2:syntax");
    expect(gate).toMatch(/vitest run test\/infrastructure\/deploy-workflow\.test\.mjs/);
  });
});

describe("check workflows run only by manual dispatch", () => {
  const checkWorkflows = ["ci", "image-build", "local-desktop", "pages"];

  it.each(checkWorkflows)("%s.yml has only a workflow_dispatch trigger", (name) => {
    const workflow = readFileSync(
      new URL(`../../.github/workflows/${name}.yml`, import.meta.url),
      "utf8",
    );
    const triggers = workflow.match(/^on:\n((?: {2}.*\n|\n)*)/m)?.[1] ?? "";
    expect(triggers).toMatch(/^ {2}workflow_dispatch:/m);
    expect(triggers).not.toMatch(/^ {2}(pull_request|push|pull_request_target):/m);
    expect(workflow).not.toMatch(/cancel-in-progress: (?!false\b)/);
  });

  it("tags deploy production and a schedule runs the .dev train", () => {
    expect(deployWorkflow).toMatch(/on:\n {2}push:\n {4}tags: \["v\*"\]\n {2}schedule:\n {4}- cron: /);
    // Merges to main no longer deploy on their own.
    expect(deployWorkflow).not.toMatch(/^ {4}branches: \[main\]/m);
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

  it("workflow concurrency serializes release actors without self-rejection", () => {
    // .dev trains and production runs queue apart, so a train can never
    // replace a waiting tag deploy. Each production run has its own group,
    // so a newer release never waits behind a whole older run; the
    // supersede script serializes the Fly rollouts instead.
    expect(deployWorkflow).toContain(
      "group: deploy-${{ github.repository }}-${{ (github.event_name == 'schedule' || inputs.target == 'dev') && 'dev' || format('production-{0}', github.run_id) }}\n  cancel-in-progress: false",
    );
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
      "needs.primary-fly.result == 'success' && needs.primary-fly.outputs.deployed == 'true'",
    );
  });

  it("a merge that produces no successful deploy opens a loud tracking issue", () => {
    expect(deployWorkflow).toContain("Report production deployment outcome");
    expect(deployWorkflow).toContain("Production did not deploy ${GITHUB_SHA:0:7}");
    expect(deployWorkflow).toMatch(/permissions:\s*\n(?:\s*contents: read\n)?\s*issues: write/);
  });

  it("the deploy workflow never cancels an in-progress production run", () => {
    for (const match of deployWorkflow.matchAll(
      /cancel-in-progress:\s*(\S+)/g,
    )) {
      expect(["false"]).toContain(match[1]);
    }
  });
});
