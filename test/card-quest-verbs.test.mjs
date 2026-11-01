import { describe, expect, it } from "vitest";
import { createWorld, wantText } from "../v2/card-game/world.mjs";
import { STEP_VERBS, validWant, wantMet } from "../v2/card-game/want.mjs";

// A level quest step with a verb beyond its kind's own.
const step = (s, kind, target, verb, cards = {}) => {
  s.actors.vale.want = {
    kind,
    target,
    since: 0,
    refusals: 0,
    quest: { level: 3, left: 2 },
    step: { verb, ...cards },
  };
  return s;
};

describe("quest step verbs", () => {
  it("finds an item by standing where it is, whoever holds it", () => {
    const s = step(createWorld(), "item", "lamp", "find");
    s.items.lamp.holder = "moth";
    s.actors.moth.place = "pond";
    expect(wantMet(s, "vale")).toBe(s.actors.vale.place === "pond");
    s.actors.vale.place = "pond";
    expect(wantMet(s, "vale")).toBe(true);
  });

  it("meets a person by being together, without a Talk", () => {
    const s = step(createWorld(), "person", "moth", "meet");
    s.actors.moth.place = s.actors.vale.place === "pond" ? "attic" : "pond";
    expect(wantMet(s, "vale")).toBe(false);
    s.actors.moth.place = s.actors.vale.place;
    expect(wantMet(s, "vale")).toBe(true);
  });

  it("brings an item to a person at a place, all at once", () => {
    const s = step(createWorld(), "item", "lamp", "bring", { to: "moth", at: "pond" });
    s.items.lamp.holder = "vale";
    s.actors.vale.place = "pond";
    s.actors.moth.place = "attic";
    expect(wantMet(s, "vale")).toBe(false);
    s.actors.moth.place = "pond";
    expect(wantMet(s, "vale")).toBe(true);
    expect(wantText(s.actors.vale.want)).toBe("bring Lamp to Pip at Black pond");
  });

  it("meets act verbs when the play resolves: Give only when accepted", () => {
    const s = step(createWorld(), "item", "lamp", "give", { to: "moth" });
    const give = { kind: "give", actor: "vale", item: "lamp", target: "moth" };
    expect(wantMet(s, "vale", null, { ...give, accepted: false })).toBe(false);
    expect(wantMet(s, "vale", null, { ...give, accepted: true })).toBe(true);
    step(s, "person", "moth", "threaten");
    expect(wantMet(s, "vale", null, { kind: "threaten", actor: "vale", target: "moth" })).toBe(true);
    expect(wantMet(s, "vale", null, { kind: "talk", actor: "vale", target: "moth" })).toBe(false);
  });

  it("validates a step's verb and cards", () => {
    const s = step(createWorld(), "item", "lamp", "bring", { to: "moth", at: "pond" });
    s.turn = 1;
    expect(validWant(s, "vale")).toBe(true);
    s.actors.vale.want.step = { verb: "meet" };
    expect(validWant(s, "vale")).toBe(false);
    s.actors.vale.want.step = { verb: "give" };
    expect(validWant(s, "vale")).toBe(false);
    expect(STEP_VERBS.person).toContain("attack");
    step(s, "item", "lamp", "find");
    expect(validWant(s, "vale")).toBe(true);
  });
});
