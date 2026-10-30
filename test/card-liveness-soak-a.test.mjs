import { describe, it } from "vitest";
import { expectSeedsKeepProgressing } from "./helpers/card-liveness-soak.mjs";

// These seeds left the whole world frozen before the liveness rules.
describe("the table stays playable", () => {
  it("keeps every avatar progressing after long loose play (seeds 1-5)", async () => {
    await expectSeedsKeepProgressing([1, 2, 3, 4, 5]);
  }, 120_000);
});
