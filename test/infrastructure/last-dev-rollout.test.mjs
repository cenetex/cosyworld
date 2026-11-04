import { describe, expect, it } from "vitest";
import { lastRollout } from "../../scripts/last-dev-rollout.mjs";

const sha = (letter) => letter.repeat(40);
const run = (id, commit, extra = {}) => ({
  id,
  head_sha: sha(commit),
  status: "completed",
  ...extra,
});
const step = (name, minute, conclusion = "success") => ({
  name,
  conclusion,
  completed_at: `2026-11-04T10:${minute}:00Z`,
});
const train = (minute) => ({
  name: "Deploy main to .dev",
  status: "completed",
  completed_at: `2026-11-04T10:${minute}:00Z`,
  steps: [step("Roll out .dev", minute)],
});
const primary = (minute) => ({
  name: "Deploy primary to Fly",
  status: "completed",
  steps: [step("Deploy primary Fly app", minute)],
});
const restore = (commit, minute, conclusion = "success") => ({
  name: "Return .dev to the main commit it ran",
  status: "completed",
  steps: [step(`Roll .dev forward to ${sha(commit)}`, minute, conclusion)],
});
const lookup = (runs, jobs, currentRunId = 30) =>
  lastRollout({
    runs,
    jobsFor: async (id) => jobs[id],
    currentRunId,
  });

describe("the commit left live by a .dev return", () => {
  const runs = [run(30, "c"), run(20, "a"), run(10, "b")];
  const jobs = {
    30: [primary("20")],
    20: [primary("10"), restore("b", "12")],
    10: [train("00")],
  };

  it("keeps train B for tag C after tag A returned to B (A -> C -> B)", async () => {
    expect(await lookup(runs, jobs)).toBe(sha("b"));
    // C's own rollout is excluded while C selects the commit to return to.
    expect(await lookup(runs, jobs, 40)).toBe(sha("c"));
  });

  it("counts a completed return even when its later smoke failed", async () => {
    const returned = {
      ...restore("b", "12"),
      conclusion: "failure",
      steps: [
        ...restore("b", "12").steps,
        step("Verify .dev", "13", "failure"),
      ],
    };
    expect(await lookup(runs, { ...jobs, 20: [primary("10"), returned] })).toBe(
      sha("b"),
    );
  });

  it.each(["failure", "skipped", "cancelled", null])(
    "keeps the tag after a %s return",
    async (conclusion) => {
      expect(
        await lookup(runs, {
          ...jobs,
          20: [primary("10"), restore("b", "12", conclusion)],
        }),
      ).toBe(sha("a"));
    },
  );

  it("uses a later train whose rollout job completed while its tests run", async () => {
    const later = run(25, "d", {
      status: "in_progress",
      display_title: `.dev train ${sha("d")}`,
    });
    expect(await lookup([later, ...runs], { ...jobs, 25: [train("15")] })).toBe(
      sha("d"),
    );
  });

  it("orders a rerun's return by completion time rather than run creation", async () => {
    const later = run(25, "d");
    expect(
      await lookup([later, ...runs], {
        ...jobs,
        25: [train("15")],
        20: [
          primary("10"),
          restore("b", "12"),
          primary("16"),
          restore("b", "18"),
        ],
      }),
    ).toBe(sha("b"));
  });

  it("retains a successful return from an earlier run attempt", async () => {
    expect(
      await lookup(runs, {
        ...jobs,
        20: [primary("10"), restore("b", "12"), restore("b", "18", "skipped")],
      }),
    ).toBe(sha("b"));
  });

  it("counts completed primary and restore jobs while other tag jobs run", async () => {
    const active = runs.map((r) =>
      r.id === 20 ? { ...r, status: "in_progress" } : r,
    );
    expect(await lookup(active, jobs)).toBe(sha("b"));
    expect(await lookup(active, { ...jobs, 20: [primary("10")] })).toBe(
      sha("a"),
    );
  });

  it("reads the target selected by an older restore step", async () => {
    const legacy = {
      ...restore("b", "12"),
      steps: [step("Roll .dev forward", "12")],
    };
    expect(await lookup(runs, { ...jobs, 20: [primary("10"), legacy] })).toBe(
      sha("b"),
    );
  });

  it("orders later rollouts and keeps uncertain legacy targets unknown", async () => {
    const legacy = {
      ...restore("b", "12"),
      steps: [step("Roll .dev forward", "12")],
    };
    const laterRerun = run(15, "d", { updated_at: "2026-11-04T10:19:00Z" });
    const history = [runs[0], runs[1], laterRerun, runs[2]];
    expect(
      await lookup(history, {
        ...jobs,
        20: [primary("10"), legacy],
        15: [primary("18")],
      }),
    ).toBe(sha("d"));
    // A rollout before the return with a later run update has uncertain history.
    expect(
      await lookup(history, {
        ...jobs,
        20: [primary("10"), legacy],
        15: [primary("08")],
      }),
    ).toBe("");
  });

  it("uses an empty base when an older restore's source record has expired", async () => {
    const legacy = {
      ...restore("b", "12"),
      steps: [step("Roll .dev forward", "12")],
    };
    expect(await lookup([run(20, "a")], { 20: [primary("10"), legacy] })).toBe(
      "",
    );
  });
});
