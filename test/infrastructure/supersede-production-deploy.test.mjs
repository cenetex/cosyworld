import { describe, expect, it } from "vitest";

import {
  planClaim,
  planStart,
  rolloutInFlight,
  runTargets,
  supersedes,
} from "../../scripts/supersede-production-deploy.mjs";

// Commits on one line of history: a higher number contains every lower one.
const run = (
  id,
  commit,
  { tag = false, target = "both", status = "in_progress", minute = id } = {},
) => ({
  id,
  head_sha: String(commit).repeat(40),
  head_branch: tag ? `v1.2.${commit}` : `promote/${String(commit).repeat(40)}`,
  event: tag ? "push" : "workflow_dispatch",
  display_title: `Deploy ${tag ? `v1.2.${commit}` : "promote/x"} to ${target}`,
  created_at: `2026-11-01T19:${String(minute).padStart(2, "0")}:00Z`,
  status,
});
const contains = (a, b) => Number(a.head_sha[0]) >= Number(b.head_sha[0]);
const job = (name, status = "in_progress", conclusion = null, steps = []) => ({
  name,
  status,
  conclusion,
  steps,
});
const gates = [job("Production Rust gate"), job("Prepare Lonely Forest image")];

describe("production run order", () => {
  it("reads the target from the run name; a tag deploys both apps", () => {
    expect(runTargets(run(1, 1, { target: "lonelyforest" }))).toEqual([
      "lonelyforest",
    ]);
    expect(runTargets(run(1, 1, { tag: true }))).toEqual([
      "primary",
      "lonelyforest",
    ]);
    expect(runTargets({ display_title: "Deploy v1.2.113" })).toEqual([
      "primary",
      "lonelyforest",
    ]);
  });

  it("a later run supersedes an earlier one", () => {
    const promotion = run(26, 3, { target: "lonelyforest" });
    const tag = run(28, 4, { tag: true });
    expect(supersedes(tag, promotion, contains)).toBe(true);
    expect(supersedes(promotion, tag, contains)).toBe(false);
  });

  it("a later promotion of an older commit never supersedes a tag", () => {
    const tag = run(26, 4, { tag: true });
    const promotion = run(28, 3, { target: "lonelyforest" });
    expect(supersedes(promotion, tag, contains)).toBe(false);
    expect(supersedes(tag, promotion, contains)).toBe(true);
  });

  it("an owner's later dispatch of an older commit still wins (a rollback)", () => {
    const tag = run(26, 4, { tag: true });
    const rollback = { ...run(28, 3), head_branch: "v1.2.3" };
    expect(supersedes(rollback, tag, contains)).toBe(true);
  });
});

describe("a newer production run at its start", () => {
  const promotion = run(26, 3, { target: "lonelyforest" });
  const tag = run(28, 4, { tag: true });

  it("cancels an older run still in its gates (the v1.2.114 case)", () => {
    const plan = planStart({
      self: tag,
      others: [promotion],
      contains,
      jobsOf: () => gates,
    });
    expect(plan).toEqual({ owns: true, cancel: [promotion] });
  });

  it("never cancels a run whose rollout job has started", () => {
    for (const status of ["queued", "in_progress", "completed"]) {
      const jobs = [
        ...gates,
        job(
          "Deploy Lonely Forest to Fly",
          status,
          status === "completed" ? "success" : null,
        ),
      ];
      const plan = planStart({
        self: tag,
        others: [promotion],
        contains,
        jobsOf: () => jobs,
      });
      expect(plan.cancel, status).toEqual([]);
    }
  });

  it("does not cancel a run that deploys an app it does not", () => {
    const self = run(28, 4, { target: "lonelyforest" });
    const both = run(26, 3, { tag: true });
    expect(
      planStart({ self, others: [both], contains, jobsOf: () => gates }).cancel,
    ).toEqual([]);
  });

  it("stops when an active run already supersedes it", () => {
    const stale = run(30, 3, { target: "lonelyforest" });
    const plan = planStart({
      self: stale,
      others: [run(28, 4, { tag: true })],
      contains,
      jobsOf: () => gates,
    });
    expect(plan.owns).toBe(false);
  });
});

describe("before a rollout", () => {
  const older = run(26, 3, { target: "lonelyforest" });
  const newer = run(28, 4, { tag: true });
  const rolling = [job("Deploy Lonely Forest to Fly")];

  it("an older run yields to an active newer one", () => {
    const plan = planClaim({
      self: older,
      others: [newer],
      app: "lonelyforest",
      contains,
      jobsOf: () => gates,
    });
    expect(plan.decision).toBe("yield");
  });

  it("an older run yields to a newer one that already rolled out", () => {
    const done = { ...newer, status: "completed" };
    const jobs = [
      job("Deploy Lonely Forest to Fly", "completed", "success", [
        { name: "Deploy Lonely Forest", conclusion: "success" },
      ]),
    ];
    expect(
      planClaim({
        self: older,
        others: [done],
        app: "lonelyforest",
        contains,
        jobsOf: () => jobs,
      }).decision,
    ).toBe("yield");
    // A newer run that ended before rolling out leaves the older one to ship.
    const failed = [job("Deploy Lonely Forest to Fly", "completed", "skipped")];
    expect(
      planClaim({
        self: older,
        others: [done],
        app: "lonelyforest",
        contains,
        jobsOf: () => failed,
      }).decision,
    ).toBe("go");
  });

  it("a newer run waits only for the older run's rollout, then goes", () => {
    expect(
      planClaim({
        self: newer,
        others: [older],
        app: "lonelyforest",
        contains,
        jobsOf: () => rolling,
      }).decision,
    ).toBe("wait");
    expect(
      planClaim({
        self: newer,
        others: [older],
        app: "lonelyforest",
        contains,
        jobsOf: () => gates,
      }).decision,
    ).toBe("go");
    // The other app's rollout does not hold it.
    expect(
      planClaim({
        self: newer,
        others: [older],
        app: "primary",
        contains,
        jobsOf: () => rolling,
      }).decision,
    ).toBe("go");
  });

  it("two runs at their rollouts never wait on each other", () => {
    const a = planClaim({
      self: older,
      others: [newer],
      app: "lonelyforest",
      contains,
      jobsOf: () => rolling,
    });
    const b = planClaim({
      self: newer,
      others: [older],
      app: "lonelyforest",
      contains,
      jobsOf: () => rolling,
    });
    expect([a.decision, b.decision]).toEqual(["yield", "wait"]);
  });

  it("a backup waits for every other rollout of its app", () => {
    const plan = planClaim({
      self: older,
      others: [newer],
      app: "lonelyforest",
      contains,
      jobsOf: () => rolling,
      waitAll: true,
    });
    expect(plan.decision).toBe("wait");
  });

  it("a tag's primary rollout lasts until its .dev restore finishes", () => {
    const tag = run(26, 3, { tag: true });
    const deployed = job("Deploy primary to Fly", "completed", "success", [
      { name: "Deploy primary Fly app", conclusion: "success" },
    ]);
    expect(rolloutInFlight(tag, [deployed], "primary")).toBe(true);
    expect(
      rolloutInFlight(
        tag,
        [deployed, job("Return .dev to the main commit it ran")],
        "primary",
      ),
    ).toBe(true);
    const restored = job(
      "Return .dev to the main commit it ran",
      "completed",
      "success",
    );
    expect(rolloutInFlight(tag, [deployed, restored], "primary")).toBe(false);
  });
});
