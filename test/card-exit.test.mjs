import { describe, expect, it } from "vitest";
import { EXIT_MAX, leavingFrames } from "../v2/card-game/card-exit.mjs";

// Just enough of a hand frame: its card or quest, holder and fold.
const frame = (id, { holder, hidden = false, quest = false } = {}) => ({
  id,
  hidden,
  dataset: holder ? { holder } : {},
  querySelector: () => ({
    dataset: quest ? { questEntry: id } : { card: id },
  }),
});
const ids = (frames) => frames.map((f) => f.id);

describe("card exit", () => {
  it("lets go of cards gone from view, not those still shown", () => {
    const before = [
      frame("vale"),
      frame("moth"),
      frame("lamp", { holder: "vale" }),
      frame("vale:item:lamp", { quest: true }),
      frame("bell", { holder: "station", hidden: true }),
    ];
    const after = [
      frame("vale"),
      // Given to Pip, out of view in Pip's folded stack.
      frame("lamp", { holder: "keeper", hidden: true }),
    ];
    expect(ids(leavingFrames(before, after))).toEqual([
      "moth",
      "lamp",
      "vale:item:lamp",
    ]);
  });

  it("keeps a card the player folds or one that moves in view", () => {
    const before = [frame("vale"), frame("lamp", { holder: "vale" })];
    expect(
      leavingFrames(before, [
        frame("vale"),
        frame("lamp", { holder: "vale", hidden: true }),
      ]),
    ).toEqual([]);
    expect(
      leavingFrames(before, [frame("lamp", { holder: "moth" }), frame("vale")]),
    ).toEqual([]);
  });

  it("drops only the first few of a whole hand left behind", () => {
    const before = Array.from({ length: 12 }, (_, i) => frame(`card${i}`));
    expect(leavingFrames(before, [])).toHaveLength(EXIT_MAX);
  });
});
