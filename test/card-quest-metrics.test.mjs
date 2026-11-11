import { describe, expect, it } from "vitest";
import { createWorld, legalActions, play } from "../v2/card-game/world.mjs";
import { newWant } from "../v2/card-game/want.mjs";
import { questRewardCards } from "../v2/card-game/quest-card.mjs";
import { metReceipts, playCounter } from "../v2/card-game/metrics.mjs";
import { questing } from "./helpers/first-quest.mjs";

// The client looks at the saved receipts after each render (app.mjs).
const look = (world, seen) =>
  metReceipts(
    questRewardCards(world).map((q) => q.key),
    seen,
  );
const step = (world, kind) => {
  const result = play(world, legalActions(world).find((a) => a.kind === kind));
  expect(result.ok, result.error).toBe(true);
  return result.state;
};

describe("quest counters (#2662)", () => {
  it("counts one quest.met when the rules meet a quest, claimed or not", () => {
    let world = questing(createWorld());
    const { seen } = look(world, null);
    world.actors.vale.want = newWant("place", "station", 0);
    world = step(world, "wait");
    const met = look(world, seen);
    expect(met.met).toBe(1);
    // Another look, or a reload of the same save, counts nothing more.
    expect(look(world, met.seen).met).toBe(0);
    expect(look(world, null).met).toBe(0);
    // Collecting the reward is not a second count.
    world = step(world, "claim");
    expect(look(world, met.seen).met).toBe(0);
  });

  it("counts two quests met in one play, and a second later one", () => {
    let world = questing(createWorld());
    let { seen } = look(world, null);
    world.actors.vale.want = newWant("place", "station", 0);
    world = step(world, "wait");
    let met = look(world, seen);
    expect(met.met).toBe(1);
    world.actors.vale.want = newWant("place", "station", world.turn);
    world = step(world, "wait");
    met = look(world, met.seen);
    expect(met.met).toBe(1);
  });

  it("names plays honestly: focus turns a held quest, Drop abandons one", () => {
    expect(playCounter({ kind: "focus", quest: 1 })).toBe("quest.accept");
    expect(playCounter({ kind: "drop", quest: 0 })).toBe("quest.abandon");
    expect(playCounter({ kind: "drop", item: "oil" })).toBe("play.drop");
  });
});
