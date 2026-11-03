// "Between us" (#2078): the pair history a speaker sees, from the real
// return-visit fixture (test/fixtures/card-voice-eval-cases.mjs).
import { describe, expect, it } from "vitest";
import { legalActions, play } from "../v2/card-game/world.mjs";
import { betweenUs } from "../v2/card-game/between-us.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { nameIn } from "../v2/card-game/life.mjs";
import { returnVisitWorld } from "./fixtures/card-voice-eval-cases.mjs";

const facts = (world, id) => {
  const other = id === "vale" ? "moth" : "vale";
  return (
    betweenUs(world, id, ["vale", "moth"], (x) =>
      nameIn(world, x),
    ).entries.find((e) => e.with === other)?.facts ?? []
  );
};

describe("between us", () => {
  it("tells both directions in the speaker's own words, newest first", () => {
    const world = returnVisitWorld();
    // Vale threatened Pip over the cloth on turn 2; Pip answered over the
    // Lamp on turn 7.
    expect(facts(world, "moth")).toEqual([
      "I threatened Vale over the Lamp, a little while ago.",
      "Vale threatened me over the Black cloth, some time ago.",
    ]);
    expect(facts(world, "vale")).toEqual([
      "Pip threatened me over the Lamp, a little while ago.",
      "I threatened Pip over the Black cloth, some time ago.",
      "Pip gave me this Black cloth. I'm keeping it.",
    ]);
  });

  it("leaves a retold incident out of What I know", () => {
    const context = narrativeContext(returnVisitWorld());
    const vale = context.entities.find((e) => e.id === "vale");
    expect(vale.facts.join("\n")).not.toContain("Pip threatens Vale");
  });

  it("tells a dormant incident by its age", () => {
    const world = returnVisitWorld();
    world.turn += 40;
    expect(facts(world, "moth")).toEqual([
      "I threatened Vale over the Lamp, long ago.",
      "Vale threatened me over the Black cloth, long ago.",
    ]);
  });

  it("says who made a repaired incident right, or leaves it out", () => {
    let world = returnVisitWorld();
    const give = (w) =>
      legalActions(w).find(
        (a) => a.kind === "give" && a.target === "moth" && a.item === "cloth",
      );
    for (let i = 0; i < 6 && !give(world); i++)
      world = play(
        world,
        legalActions(world).find((a) => a.kind === "wait"),
      ).state;
    world = play(world, give(world)).state;
    const pip = world.motives.grievances.moth.find((g) => g.other === "vale");
    expect(pip.repaired).toBe(true);
    expect(facts(world, "moth")[1]).toMatch(
      /^Vale threatened me over the Black cloth, [a-z ]+\. Vale made it right\.$/u,
    );
    expect(facts(world, "vale")[1]).toMatch(
      /^I threatened Pip over the Black cloth, [a-z ]+\. I made it right\.$/u,
    );
    // A repair the speaker never learned of: the incident is not told.
    const repair = Object.values(world.knowledge.facts).find(
      (f) => f.source.kind === "repair",
    );
    delete world.knowledge.known.moth[repair.id];
    expect(facts(world, "moth").join(" ")).not.toContain(
      "threatened me over the Black cloth",
    );
  });

  it("never tells the other's taste or noise grievances", () => {
    const world = returnVisitWorld();
    const threat = world.motives.grievances.moth[0];
    world.motives.grievances.moth.push(
      { ...threat, kind: "noise", reason: "Vale rang the bell." },
      { ...threat, kind: "light", reason: "Vale spoiled my light." },
    );
    world.motives.grievances.moth.splice(0, 1);
    // Only the threats remain; Pip's dislikes stay Pip's.
    expect(facts(world, "vale")).toEqual([
      "Pip threatened me over the Lamp, a little while ago.",
      "Pip gave me this Black cloth. I'm keeping it.",
    ]);
    // Vale's own pestering grievance has no line either.
    expect(
      world.motives.grievances.vale.some((g) => g.kind === "pestering"),
    ).toBe(true);
  });
});
