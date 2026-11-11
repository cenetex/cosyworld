import { describe, expect, it } from "vitest";
import { cardPlay, settledChoice } from "../v2/card-game/cards.mjs";
import { createWorld, legalActions } from "../v2/card-game/world.mjs";

// A raised held thing must not turn the next tap into a pair with no play.
function carrying() {
  const world = createWorld();
  world.items.lamp.holder = "vale";
  const take = legalActions(world).find(
    (a) => a.kind === "take" && a.item !== "lamp",
  );
  return { world, take };
}
describe("settledChoice", () => {
  it("lets a taken thing replace the raised held one", () => {
    const { world, take } = carrying();
    expect(take).toBeTruthy();
    expect(world.items.lamp.holder).toBe("vale");
    const pair = ["lamp", take.item];
    expect(cardPlay(world, pair).action).toBeFalsy();
    expect(settledChoice(world, pair, take.item)).toEqual([take.item]);
  });
  it("keeps a pair that plays", () => {
    const { world } = carrying();
    const pair = ["lamp", "vale"];
    expect(settledChoice(world, pair, "lamp")).toEqual(pair);
  });
  it("leaves other selections alone", () => {
    const { world, take } = carrying();
    expect(settledChoice(world, [take.item], take.item)).toEqual([take.item]);
  });
});
