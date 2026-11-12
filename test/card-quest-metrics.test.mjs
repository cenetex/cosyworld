import { describe, expect, it } from "vitest";
import { createWorld, legalActions, play } from "../v2/card-game/world.mjs";
import { newWant } from "../v2/card-game/want.mjs";
import { metWants, playCounter } from "../v2/card-game/metrics.mjs";
import { questing } from "./helpers/first-quest.mjs";

// The client looks at the saved log after each render (app.mjs): a want the
// rules met writes one `want_met` event, which is the one count.
const look = (world, since) => ({
  met: metWants(world.log, since, "vale"),
  seen: world.eventSeq,
});
const step = (world, kind) => {
  const result = play(world, legalActions(world).find((a) => a.kind === kind));
  expect(result.ok, result.error).toBe(true);
  return result.state;
};

describe("quest counters (#2662)", () => {
  it("counts one quest.met when the rules meet a quest", () => {
    let world = questing(createWorld());
    const { seen } = look(world, null);
    world.actors.vale.want = newWant("place", "station", 0);
    world = step(world, "wait");
    const met = look(world, seen);
    expect(met.met).toBe(1);
    // Another look, or a reload of the same save, counts nothing more.
    expect(look(world, met.seen).met).toBe(0);
    expect(look(world, null).met).toBe(0);
  });

  it("counts a second quest met later, once", () => {
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

  it("names plays honestly: a quest is held by the rules, Drop abandons", () => {
    expect(playCounter({ kind: "take", offer: "quest:box:x" })).toBe("play.take");
    expect(playCounter({ kind: "drop", quest: 0 })).toBe("quest.abandon");
    expect(playCounter({ kind: "drop", item: "oil" })).toBe("play.drop");
    expect(playCounter({ kind: "take", item: "oil" })).toBe("play.take");
  });
});
