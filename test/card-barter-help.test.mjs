import { describe, expect, it } from "vitest";
import {
  createWorld, legalActions, play, plan, places, things,
  canTrade, willingToGive, encodeSave, decodeSave,
} from "../v2/card-game/world.mjs";
import { enableMotives, tastes } from "../v2/card-game/motives.mjs";
import { generateProgram } from "../v2/card-game/quests.mjs";
import { enablePersonalQuests } from "../v2/card-game/life.mjs";

function bargain() {
  const world = enableMotives(createWorld(), { questPrograms: true });
  world.turn = world.revision = 20;
  world.actors.moth.place = world.actors.keeper.place = "station";
  world.items.lamp.holder = "moth";
  world.items.lamp.fuel = 0;
  world.items.cloth.holder = world.items.bell.holder = "keeper";
  world.items.oil.holder = "station";
  world.actors.moth.progress = { program: 1, step: 0, marks: [1, 2] };
  world.actors.keeper.progress = { program: 2, step: 0, marks: [1, 2, 3, 4], completedHands: 4, recent: [] };
  const program = generateProgram(world, "keeper", places, things);
  program.steps = Array.from({ length: 3 }, () => ({
    items: ["lamp"], location: "station", avatars: ["moth"],
  }));
  world.actors.keeper.progress.current = program;
  world.peaceUntil.keeper = 23;
  world.motives.grievances.keeper = [{
    other: "moth", kind: "pestering", turn: 20, weight: 1,
    reason: "Pip kept asking for the same belongings.",
  }];
  return decodeSave(encodeSave(world));
}
function wait(world) {
  const action = legalActions(world).find((a) => a.kind === "wait");
  const result = play(world, action);
  expect(result.ok).toBe(true);
  expect(play(decodeSave(encodeSave(world)), action)).toEqual(result);
  return result.state;
}

describe("a useful gift before a renewed request", () => {
  it("helps the owner, earns a favour, and receives a spare through accepted plays", () => {
    const before = bargain();
    expect(canTrade(before, "moth", "lamp", "cloth")).toBe(false);
    expect(willingToGive(before, "keeper", "cloth", "moth")).toBe(false);
    expect(plan(before, "moth").action).toMatchObject({
      kind: "give", item: "lamp", target: "keeper",
    });
    const helped = wait(before);
    expect(helped.items.lamp.holder).toBe("keeper");
    expect(helped.actors.keeper.trust.moth).toBeGreaterThan(0);
    expect(helped.motives.grievances.keeper).toEqual([]);
    expect(plan(helped, "moth").action).toMatchObject({
      kind: "ask", item: "cloth", target: "keeper",
    });
    const received = wait(helped);
    expect(received.items.cloth.holder).toBe("moth");
    expect(received.log.findLast((e) => e.verb === "ask")).toMatchObject({
      actorId: "moth", itemId: "cloth", accepted: true,
    });
    expect(decodeSave(encodeSave(received))).toEqual(received);
  });

  it.each(["favorite", "gift"])("keeps a %s lamp in its owner's care", (kind) => {
    const world = bargain();
    enablePersonalQuests(world, (id) => kind === "gift" ? { ...tastes[id], values: {} } : tastes[id]);
    if (kind === "gift")
      world.life.actors.moth.attachments.lamp = { from: "vale", turn: 1 };
    expect(plan(world, "moth").action).not.toMatchObject({
      kind: "give", item: "lamp",
    });
    const next = wait(world);
    expect(next.items.lamp.holder).toBe("moth");
    expect(decodeSave(encodeSave(next))).toEqual(next);
  });
});
