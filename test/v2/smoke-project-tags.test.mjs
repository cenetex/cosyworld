import { describe, expect, it } from "vitest";
import { spentPreparationTagBelongsToJob } from "../../v2/scripts/smoke-project-tags.mjs";

const moonlitJob = {
  location_ids: [3],
  progress_clock_id: "moonlit-trail.progress",
};

describe("browser smoke project-tag ownership", () => {
  it("matches preparation spent on the project being checked", () => {
    expect(spentPreparationTagBelongsToJob({
      id: "actor:5000:prepared_spent:3:moonlit-trail.progress",
      label: "spent preparation",
      expires: "when_job_resolves",
    }, moonlitJob)).toBe(true);
  });

  it("keeps preparation for another unresolved project out of the check", () => {
    expect(spentPreparationTagBelongsToJob({
      id: "actor:5000:prepared_spent:2:rain-soft-garden.trustworthy-path",
      label: "spent preparation",
      expires: "when_job_resolves",
    }, moonlitJob)).toBe(false);
  });

  it("does not treat unrelated or malformed tags as project preparation", () => {
    expect(spentPreparationTagBelongsToJob({
      id: "actor:5000:prepared_spent:3:moonlit-trail.progress",
      label: "prepared",
      expires: "when_job_resolves",
    }, moonlitJob)).toBe(false);
    expect(spentPreparationTagBelongsToJob({
      id: "actor:5000:prepared_spent",
      label: "spent preparation",
      expires: "when_job_resolves",
    }, moonlitJob)).toBe(false);
  });
});
