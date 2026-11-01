import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  chooseTrain,
  isProductionRun,
  liveBlock,
  promotionBlock,
  trainRollout,
} from "../../scripts/promote-train.mjs";

const minute = 60_000;
const sha = (digit) => String(digit).repeat(40);
const train = (digit, rolledAt, passed = true) => ({
  sha: sha(digit),
  runId: digit,
  rolledAt,
  passed,
});
const soakMs = 25 * minute;

describe("production promotes the soaked .dev train", () => {
  it("promotes the newest passing train once it has soaked", () => {
    const now = 100 * minute;
    expect(
      chooseTrain({ trains: [train(2, 60 * minute)], now, soakMs }).train.sha,
    ).toBe(sha(2));
  });

  it("falls back to the previous train while the newest is still soaking", () => {
    const now = 100 * minute;
    const trains = [train(3, 90 * minute), train(2, 60 * minute)];
    expect(chooseTrain({ trains, now, soakMs }).train.sha).toBe(sha(2));
  });

  it("skips a train that was live too briefly", () => {
    const now = 100 * minute;
    const trains = [train(3, 90 * minute), train(2, 80 * minute)];
    expect(chooseTrain({ trains, now, soakMs }).train).toBeUndefined();
  });

  it("holds everything behind a newest train that failed its checks", () => {
    const trains = [train(3, 10 * minute, false), train(2, 0)];
    const result = chooseTrain({ trains, now: 100 * minute, soakMs });
    expect(result.train).toBeUndefined();
    expect(result.reason).toContain("failed its .dev checks");
  });

  it("never promotes a failed older train", () => {
    const trains = [train(4, 95 * minute), train(3, 30 * minute, false)];
    expect(
      chooseTrain({ trains, now: 100 * minute, soakMs }).train,
    ).toBeUndefined();
  });

  it("promote now skips the soak", () => {
    const trains = [train(4, 99 * minute)];
    expect(
      chooseTrain({ trains, now: 100 * minute, soakMs: 0 }).train.sha,
    ).toBe(sha(4));
  });
});

describe("promotion never ships something older than production", () => {
  const tag = (status, conclusion = null) => ({
    id: 9,
    event: "push",
    head_branch: "v1.2.114",
    head_sha: sha(9),
    status,
    conclusion,
  });

  it("waits while a tag deploy is queued or running", () => {
    for (const status of ["queued", "waiting", "in_progress"]) {
      expect(promotionBlock({ runs: [tag(status)], sha: sha(4) })).toContain(
        "production deploy is active",
      );
    }
    expect(
      promotionBlock({ runs: [tag("completed", "success")], sha: sha(4) }),
    ).toBeNull();
  });

  it("never retries a commit whose production run failed", () => {
    const failed = { ...tag("completed", "failure"), head_sha: sha(4) };
    expect(promotionBlock({ runs: [failed], sha: sha(4) })).toContain(
      "already failed",
    );
  });

  it("promotes only a commit ahead of the live /meta commit", () => {
    const live = sha(9).slice(0, 12);
    expect(liveBlock({ live, sha: sha(4), status: "ahead" })).toBeNull();
    expect(
      liveBlock({
        live: sha(4).slice(0, 12),
        sha: sha(4),
        status: "identical",
      }),
    ).toContain("already runs");
    for (const status of ["behind", "diverged", "identical"]) {
      expect(liveBlock({ live, sha: sha(4), status })).toContain("not ahead");
    }
  });
});

describe("promotion reads Deploy runs", () => {
  const job = (conclusion, rollout = "success") => [
    {
      name: "Deploy main to .dev",
      status: "completed",
      conclusion,
      completed_at: "2026-11-01T00:10:00Z",
      steps: [
        {
          name: "Roll out .dev",
          conclusion: rollout,
          completed_at: "2026-11-01T00:05:00Z",
        },
      ],
    },
  ];
  const run = { id: 7, head_sha: sha(7) };

  it("counts a rollout and whether its smokes passed", () => {
    expect(trainRollout(run, job("success"))).toEqual({
      sha: sha(7),
      runId: 7,
      rolledAt: Date.parse("2026-11-01T00:05:00Z"),
      passed: true,
    });
    expect(trainRollout(run, job("failure")).passed).toBe(false);
    expect(trainRollout(run, job("cancelled", "skipped"))).toBeNull();
    expect(trainRollout(run, [])).toBeNull();
    // A train still running its rollout job does not count yet.
    expect(
      trainRollout(run, [{ ...job("success")[0], status: "in_progress" }]),
    ).toBeNull();
  });

  it("tells trains from production runs", () => {
    expect(isProductionRun({ event: "schedule" })).toBe(false);
    expect(isProductionRun({ event: "push", head_branch: "main" })).toBe(false);
    expect(
      isProductionRun({
        event: "workflow_dispatch",
        display_title: `.dev train ${sha(1)}`,
      }),
    ).toBe(false);
    expect(
      isProductionRun({
        event: "workflow_dispatch",
        display_title: "Deploy promote/x",
      }),
    ).toBe(true);
    expect(isProductionRun({ event: "push", head_branch: "v1.2.3" })).toBe(
      true,
    );
  });

  it("the names match the deploy workflow", () => {
    const deploy = readFileSync(
      new URL("../../.github/workflows/deploy.yml", import.meta.url),
      "utf8",
    );
    expect(deploy).toContain("name: Deploy main to .dev");
    expect(deploy).toContain("- name: Roll out .dev");
    // The promotion dispatch deploys Lonely Forest with its gates.
    expect(deploy).toContain("- lonelyforest");
    expect(deploy).toContain(
      "inputs.target == 'both' || inputs.target == 'lonelyforest'",
    );
  });
});

describe("the promotion workflow", () => {
  const workflow = readFileSync(
    new URL("../../.github/workflows/promote.yml", import.meta.url),
    "utf8",
  );

  it("runs between trains, pauses on the hold variable, and keeps a manual run", () => {
    expect(workflow).toMatch(/schedule:\n {4}- cron: "22,52 \* \* \* \*"/);
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain(
      "(github.event_name == 'workflow_dispatch' || vars.COSYWORLD_HOLD_PRODUCTION != 'on')",
    );
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("node scripts/promote-train.mjs");
    expect(workflow).not.toContain("secrets.");
  });
});
