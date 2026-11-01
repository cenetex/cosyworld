import { describe, expect, it } from "vitest";

import {
  criticalPath,
  oneLine,
  percentile,
  runKind,
  summarize,
} from "../../scripts/deploy-timings.mjs";

const at = (minute) => `2026-11-01T19:${String(minute).padStart(2, "0")}:00Z`;
const job = (name, start, end, steps = []) => ({
  name,
  conclusion: "success",
  startedAt: at(start),
  completedAt: at(end),
  steps,
});
const step = (name, start, end, conclusion = "success") => ({
  name,
  conclusion,
  startedAt: at(start),
  completedAt: at(end),
});

describe("deploy timings", () => {
  it("tells run kinds apart", () => {
    expect(runKind({ event: "schedule" })).toBe("train");
    expect(runKind({ event: "push", headBranch: "main" })).toBe("train");
    expect(runKind({ event: "push", headBranch: "v1.2.114" })).toBe("tag");
    expect(
      runKind({ event: "workflow_dispatch", headBranch: "promote/abc" }),
    ).toBe("promotion");
    expect(
      runKind({ event: "workflow_dispatch", displayTitle: ".dev train abc" }),
    ).toBe("train");
    expect(runKind({ event: "workflow_dispatch", headBranch: "main" })).toBe(
      "dispatch",
    );
  });

  // Run 41341734000: the image build, not the Rust gate, set its length.
  const jobs = [
    job("Check production impact", 1, 2),
    job("Production Rust gate", 2, 9, [
      step("Verify Rust orchestrator tests", 3, 9),
    ]),
    job("Prepare Lonely Forest image", 2, 12, [
      step("Prepare Lonely Forest image", 3, 12),
    ]),
    job("Deploy Lonely Forest to Fly", 12, 15),
    { ...job("Deploy primary to Fly", 9, 9), conclusion: "skipped" },
  ];

  it("follows the critical path back from the last job", () => {
    expect(criticalPath(jobs).map((j) => j.name)).toEqual([
      "Check production impact",
      "Prepare Lonely Forest image",
      "Deploy Lonely Forest to Fly",
    ]);
  });

  it("reports queue, wall time, Rust reuse, and image reuse", () => {
    const summary = summarize(
      {
        databaseId: 1,
        event: "workflow_dispatch",
        headBranch: "promote/x",
        createdAt: at(0),
      },
      jobs,
    );
    expect(summary).toMatchObject({
      kind: "promotion",
      wallMs: 15 * 60_000,
      queueMs: 60_000,
      rustReused: false,
      imageReused: false,
    });
    expect(oneLine(summary)).toContain(
      "15.0m total, 1.0m queued · Rust gate ran 6.0m · image built 9.0m",
    );
    const reused = jobs.map((j) =>
      j.name === "Production Rust gate"
        ? {
            ...j,
            steps: [step("Verify Rust orchestrator tests", 3, 3, "skipped")],
          }
        : j.name === "Prepare Lonely Forest image"
          ? { ...j, steps: [step("Prepare Lonely Forest image", 3, 4)] }
          : j,
    );
    expect(
      summarize({ event: "push", headBranch: "v1", createdAt: at(0) }, reused),
    ).toMatchObject({ rustReused: true, imageReused: true });
  });

  it("takes nearest-rank percentiles", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 90)).toBe(5);
    expect(percentile([], 50)).toBeNaN();
  });
});
