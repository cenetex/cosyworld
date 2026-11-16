import { describe, expect, it } from "vitest";
import { createWorld, legalActions, play } from "../v2/card-game/world.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";

const talkTo = (world, target) =>
  play(
    world,
    legalActions(world).find((a) => a.kind === "talk" && a.target === target),
  ).state;
const meeting = (want) => {
  const world = createWorld();
  world.actors.moth.place = world.actors.vale.place;
  world.actors.moth.metTurn = 0;
  if (want !== undefined) world.actors.moth.want = want;
  return world;
};
const wantLines = (world) =>
  narrativeContext(talkTo(world, "moth"))
    .entities.find((entity) => entity.id === "moth")
    .facts.filter((fact) => /^I want /.test(fact));

describe("a stated want", () => {
  it("is not spoken once the rules have cleared it", () => {
    expect(wantLines(meeting(null))).toEqual([]);
  });

  it("is spoken while the rules hold one", () => {
    const world = meeting();
    const held = world.actors.moth.want;
    if (held) expect(wantLines(world).length).toBeGreaterThan(0);
    else expect(wantLines(meeting({ kind: "item", target: "lamp" })).length).toBeGreaterThan(0);
  });
});
