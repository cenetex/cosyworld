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
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { lastRollout, rolledOut } from "../../scripts/last-dev-rollout.mjs";

const yieldScript = fileURLToPath(
  new URL("../../scripts/yield-superseded-deploy.sh", import.meta.url),
);
const sha = "a".repeat(40);
const newer = "b".repeat(40);

const runYield = (
  mode,
  {
    main = sha,
    event = "push",
    ref = "refs/heads/main",
    marker = false,
    apiFails = false,
  } = {},
) => {
  const directory = mkdtempSync(join(tmpdir(), "cosyworld-yield-"));
  const log = join(directory, "gh.log");
  writeFileSync(
    join(directory, "gh"),
    `#!/usr/bin/env bash\necho "$*" >> "${log}"\n` +
      `if [ "$1" = api ]; then ${apiFails ? "exit 1" : `echo ${main}`}; fi\n`,
  );
  chmodSync(join(directory, "gh"), 0o755);
  if (marker) writeFileSync(join(directory, "cosyworld-deploy-yielded"), "");
  try {
    const result = spawnSync("bash", [yieldScript, mode], {
      encoding: "utf8",
      timeout: 20_000,
      env: {
        ...process.env,
        PATH: `${directory}${delimiter}${process.env.PATH}`,
        GH_REPO: "example/world",
        GITHUB_RUN_ID: "42",
        GITHUB_SHA: sha,
        GITHUB_EVENT_NAME: event,
        GITHUB_REF: ref,
        RUNNER_TEMP: directory,
        COSYWORLD_YIELD_INTERVAL: "1",
        COSYWORLD_YIELD_WAIT_SECS: "1",
      },
    });
    const calls = existsSync(log) ? readFileSync(log, "utf8") : "";
    return { ...result, calls };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

describe("a superseded main deploy yields to the newer commit", () => {
  it("keeps deploying while it still owns main", () => {
    const result = runYield("check");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`owns main at ${sha.slice(0, 7)}`);
    expect(result.calls).not.toContain("run cancel");
  });

  it("cancels its own run when main has moved, then holds the step", () => {
    const result = runYield("check", { main: newer });
    expect(result.calls).toContain("run cancel 42 --repo example/world");
    expect(result.stdout).toContain(`main advanced to ${newer.slice(0, 7)}`);
    // The step never succeeds after a cancel request, so the rollout cannot start.
    expect(result.status).not.toBe(0);
  });

  it("the watcher cancels when main moves during the build", () => {
    const result = runYield("watch", { main: newer });
    expect(result.calls).toContain("run cancel 42");
    expect(result.status).not.toBe(0);
  });

  it("a final check honours a watcher that already asked to cancel", () => {
    const result = runYield("check", { marker: true });
    expect(result.calls).toContain("run cancel 42");
    expect(result.calls).not.toContain("api repos");
    expect(result.status).not.toBe(0);
  });

  it("never yields a tag or dispatch run", () => {
    for (const env of [
      { event: "push", ref: "refs/tags/v1.2.3" },
      { event: "workflow_dispatch", ref: "refs/heads/main" },
    ]) {
      const result = runYield("check", { ...env, main: newer, marker: true });
      expect(result.status).toBe(0);
      expect(result.calls).toBe("");
    }
  });

  it("keeps deploying when main cannot be read", () => {
    const result = runYield("check", { apiFails: true });
    expect(result.status).toBe(0);
    expect(result.calls).not.toContain("run cancel");
  });
});

describe("a main push compares with the commit .dev runs", () => {
  const step = (name, conclusion) => ({ name, conclusion });
  const runs = [
    { id: 9, status: "in_progress", head_sha: "9".repeat(40) },
    { id: 8, status: "completed", head_sha: "8".repeat(40) },
    { id: 7, status: "completed", head_sha: "7".repeat(40) },
    { id: 6, status: "completed", head_sha: "6".repeat(40) },
  ];
  const jobs = {
    // Superseded before its rollout.
    8: [
      {
        name: "Deploy main to .dev",
        steps: [step("Roll out .dev", "skipped")],
      },
    ],
    // Rolled out, then failed a later check: .dev still runs this commit.
    7: [
      {
        name: "Deploy main to .dev",
        conclusion: "failure",
        steps: [
          step("Roll out .dev", "success"),
          step("Verify primary card game", "failure"),
        ],
      },
    ],
    6: [
      {
        name: "Deploy primary to Fly",
        steps: [step("Deploy primary Fly app", "success")],
      },
    ],
  };

  it("finds the newest completed run whose rollout step succeeded", async () => {
    const seen = [];
    const base = await lastRollout({
      runs,
      currentRunId: 10,
      jobsFor: async (id) => {
        seen.push(id);
        return jobs[id];
      },
    });
    expect(base).toBe("7".repeat(40));
    expect(seen).toEqual([8, 7]);
  });

  it("counts release-path rollouts and skips the current run", async () => {
    const base = await lastRollout({
      runs: runs.slice(3),
      currentRunId: 7,
      jobsFor: async (id) => jobs[id],
    });
    expect(base).toBe("6".repeat(40));
    expect(
      await lastRollout({
        runs: [runs[3]],
        currentRunId: 6,
        jobsFor: async () => [],
      }),
    ).toBe("");
  });

  it("does not count a cancelled or failed rollout step", () => {
    for (const conclusion of ["cancelled", "failure", "skipped", null]) {
      expect(
        rolledOut([
          {
            name: "Deploy main to .dev",
            steps: [step("Roll out .dev", conclusion)],
          },
        ]),
      ).toBe(false);
    }
  });

  it("names the rollout steps the workflow really runs", () => {
    const workflow = readFileSync(
      new URL("../../.github/workflows/deploy.yml", import.meta.url),
      "utf8",
    );
    expect(workflow).toContain("name: Deploy main to .dev");
    expect(workflow).toContain("- name: Roll out .dev");
    expect(workflow).toContain("name: Deploy primary to Fly");
    expect(workflow).toContain("- name: Deploy primary Fly app");
  });
});
