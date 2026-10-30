import { describe, it } from "vitest";
import { expectSeedsKeepProgressing } from "./helpers/card-liveness-soak.mjs";

// These seeds left the whole world frozen before the liveness rules.
describe("the table stays playable", () => {
  it("keeps every avatar progressing after long loose play (seeds 6-10)", async () => {
    await expectSeedsKeepProgressing([6, 7, 8, 9, 10]);
  }, 120_000);
});
