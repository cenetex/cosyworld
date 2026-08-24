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
const packageScripts = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
).scripts;

describe("deployment-only contracts run in pull-request CI", () => {
  it("the CI Node job runs the full vitest suite, which includes every infrastructure contract", () => {
    expect(ciWorkflow).toContain("npm test");
    expect(vitestConfig).toMatch(/include:\s*\[\s*'test\/\*\*\/\*\.test\.\{js,mjs\}'/);
  });

  it("the CI Node job runs the Lonely Forest multitenant contract", () => {
    expect(packageScripts["v2:lonelyforest:contract"]).toBeTruthy();
    expect(ciWorkflow).toContain("npm run v2:lonelyforest:contract");
  });

  it("the production deployment gate keeps running the same deployment-only contracts", () => {
    const gate = deployWorkflow.match(
      /Run Node and deployment contract checks\n\s*run: \|\n([\s\S]*?)\n\n {2}\w/,
    )?.[1];
    expect(gate).toBeTruthy();
    expect(gate).toContain("npm run v2:lonelyforest:contract");
    expect(gate).toMatch(/vitest run test\/infrastructure\/deploy-workflow\.test\.mjs/);
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
    expect(deployWorkflow).toMatch(
      /concurrency:\s*\n\s*group: deploy-\$\{\{ github\.repository \}\}\s*\n\s*cancel-in-progress: false/,
    );
    expect(deployWorkflow).not.toContain("actions/runs?status=");
  });

  it("a merge that produces no successful deploy opens a loud tracking issue", () => {
    expect(deployWorkflow).toContain("Report production deployment outcome");
    expect(deployWorkflow).toContain("Production did not deploy ${GITHUB_SHA:0:7}");
    expect(deployWorkflow).toMatch(/permissions:\s*\n\s*issues: write/);
  });

  it("the deploy workflow never cancels an in-progress production run", () => {
    for (const match of deployWorkflow.matchAll(
      /cancel-in-progress:\s*(\S+)/g,
    )) {
      expect(["false"]).toContain(match[1]);
    }
  });
});
