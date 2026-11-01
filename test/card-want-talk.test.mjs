import { questing } from "./helpers/first-quest.mjs";
import { describe, expect, it } from "vitest";
import {
  createWorld as baseCreateWorld,
  legalActions,
  nameOf,
  play,
} from "../v2/card-game/world.mjs";
// Play here starts past the pond, where the first quest begins.
const createWorld = (...args) => questing(baseCreateWorld(...args));
import { enableMotives } from "../v2/card-game/motives.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { wantFact, wantOf } from "../v2/card-game/want-talk.mjs";

const QUEST_LINES =
  /^(What I want most now|I also want to pursue|I just finished|Help needed here|Open story here)|is pursuing /u;

function talkTo(world, target) {
  const action = legalActions(world).find(
    (a) => a.kind === "talk" && a.target === target,
  );
  expect(action).toBeTruthy();
  const result = play(world, action);
  expect(result.ok).toBe(true);
  return narrativeContext(result.state, action);
}
const factsOf = (context, id) =>
  context.entities.find((e) => e.id === id)?.facts || [];
const atStation = () => {
  const world = enableMotives(createWorld());
  for (const id of ["vale", "moth", "keeper"])
    world.actors[id].place = "station";
  world.items.lamp.holder = "station";
  return world;
};

describe("a want in Talk context", () => {
  it("says the speaker's want in the first person", () => {
    const world = atStation();
    expect(wantOf(world, "moth")).toMatchObject({ kind: "item", target: "lamp" });
    expect(wantFact(world, "moth", nameOf)).toBe("I want the Lamp.");
    world.items.bell.holder = "keeper";
    expect(wantFact(world, "keeper", nameOf)).toBe(null);
    world.items.bell.holder = "vale";
    expect(wantFact(world, "keeper", nameOf)).toBe("I want the Bell.");
    world.actors.moth.want = { kind: "place", target: "pond" };
    expect(wantFact(world, "moth", nameOf)).toBe(
      `I want to be at ${nameOf("pond")}.`,
    );
    world.actors.moth.want = { kind: "person", target: "keeper" };
    world.actors.keeper.place = "pond";
    expect(wantFact(world, "moth", nameOf)).toBe("I want to see The keeper.");
  });

  it("stays quiet once the want is met", () => {
    const world = atStation();
    world.items.lamp.holder = "moth";
    expect(wantFact(world, "moth", nameOf)).toBe(null);
  });

  it("replaces the quest facts with one want fact for the Talk partner", () => {
    // Vale holds the lamp and keeps it, so Pip still wants it after Talk.
    const world = atStation();
    world.items.lamp.holder = "vale";
    world.actors.vale.want = { kind: "place", target: "pond", since: 0, refusals: 0 };
    const context = talkTo(world, "moth");
    const pip = factsOf(context, "moth");
    expect(pip.filter((f) => f === "I want the Lamp.")).toHaveLength(1);
    for (const entity of context.entities)
      expect(entity.facts.some((f) => QUEST_LINES.test(f))).toBe(false);
    expect(factsOf(context, "vale")).toContain(`I want to be at ${nameOf("pond")}.`);
    expect(pip.length).toBeLessThanOrEqual(16);
  });

  it("keeps a bystander's want out of someone else's Talk", () => {
    const world = atStation();
    world.items.bell.holder = "vale";
    const context = talkTo(world, "moth");
    expect(factsOf(context, "keeper")).not.toContain("I want the Bell.");
    const wait = legalActions(world).find((a) => a.kind === "wait");
    expect(wait).toBeTruthy();
    const next = play(world, wait).state;
    expect(factsOf(narrativeContext(next), "moth")).not.toContain(
      "I want the Lamp.",
    );
  });
});
