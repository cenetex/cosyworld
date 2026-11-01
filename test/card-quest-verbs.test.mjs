import { describe, expect, it } from "vitest";
import {
  createWorld,
  legalActions,
  play,
  wantText,
} from "../v2/card-game/world.mjs";
import {
  STEP_VERBS,
  drawStep,
  validWant,
  wantMet,
} from "../v2/card-game/want.mjs";
import { actorCanVisit } from "../v2/card-game/pack-registry.mjs";

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
    const s = step(createWorld(), "item", "lamp", "bring", {
      to: "moth",
      at: "pond",
    });
    s.items.lamp.holder = "vale";
    s.actors.vale.place = "pond";
    s.actors.moth.place = "attic";
    expect(wantMet(s, "vale")).toBe(false);
    s.actors.moth.place = "pond";
    expect(wantMet(s, "vale")).toBe(true);
    expect(wantText(s.actors.vale.want)).toBe(
      "bring Lamp to Pip at Black pond",
    );
  });

  it("meets act verbs when the play resolves: Give only when accepted", () => {
    const s = step(createWorld(), "item", "lamp", "give", { to: "moth" });
    const give = { kind: "give", actor: "vale", item: "lamp", target: "moth" };
    expect(wantMet(s, "vale", null, { ...give, accepted: false })).toBe(false);
    expect(wantMet(s, "vale", null, { ...give, accepted: true })).toBe(true);
    step(s, "person", "moth", "threaten");
    expect(
      wantMet(s, "vale", null, {
        kind: "threaten",
        actor: "vale",
        target: "moth",
      }),
    ).toBe(true);
    expect(
      wantMet(s, "vale", null, { kind: "talk", actor: "vale", target: "moth" }),
    ).toBe(false);
    step(s, "person", "moth", "attack");
    expect(wantText(s.actors.vale.want)).toBe("strike Pip");
  });

  it("validates a step's verb and cards", () => {
    const s = step(createWorld(), "item", "lamp", "bring", {
      to: "moth",
      at: "pond",
    });
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

  it("draws steps from other avatars' quests so they interlock", () => {
    const s = createWorld();
    const api = { home: () => "pond" };
    s.actors.moth.want = {
      kind: "item",
      target: "lamp",
      since: 0,
      refusals: 0,
    };
    expect(drawStep(s, "vale", api, "item", "lamp", 3, 0)).toEqual({
      verb: "give",
      to: "moth",
    });
    expect(drawStep(s, "vale", api, "item", "lamp", 3, 7)).toEqual({
      verb: "bring",
      to: "moth",
      at: "pond",
    });
    s.actors.moth.want = {
      kind: "place",
      target: "pond",
      since: 0,
      refusals: 0,
    };
    s.actors.moth.place = "attic";
    expect(drawStep(s, "vale", api, "person", "moth", 3, 7)).toEqual({
      verb: "meet",
      at: "pond",
    });
    s.items.lamp.holder = "moth";
    expect(drawStep(s, "vale", api, "item", "lamp", 3, 7)).toEqual({
      verb: "find",
    });
    // A step already true where Vale stands is no step.
    s.actors.moth.place = s.actors.vale.place;
    expect(drawStep(s, "vale", api, "item", "lamp", 3, 7)).toBeNull();
    expect(drawStep(s, "vale", api, "person", "moth", 3, 14)).toBeNull();
    expect(drawStep(s, "vale", api, "person", "moth", 20, 21)).toEqual({
      verb: "attack",
    });
  });

  it("resolves both sides when giving meets another avatar's quest, through a long run", () => {
    let s = createWorld(),
      both = 0;
    for (let turn = 0; turn < 300; turn++) {
      const vale = s.actors.vale;
      // Keep Pip wanting the lamp and Vale's step giving it to Pip.
      if (s.actors.moth.want?.target !== "lamp" || s.actors.moth.want.step)
        s.actors.moth.want = {
          kind: "item",
          target: "lamp",
          since: s.turn,
          refusals: 0,
        };
      if (vale.want?.step?.verb !== "give")
        vale.want = {
          kind: "item",
          target: "lamp",
          since: s.turn,
          refusals: 0,
          quest: { level: 3, left: 2 },
          step: drawStep(
            s,
            "vale",
            { home: () => "pond" },
            "item",
            "lamp",
            3,
            0,
          ),
        };
      // Every few turns Pip comes to Vale and the lamp is back in Vale's
      // hands: this tests resolution, not routes or Pip's own taking.
      // Pip can't follow Vale into a place closed to him.
      if (turn % 5 === 0 && actorCanVisit("moth", vale.place, s)) {
        s.actors.moth.place = vale.place;
        s.items.lamp.holder = "vale";
      }
      const actions = legalActions(s);
      const give = actions.find(
        (a) => a.kind === "give" && a.item === "lamp" && a.target === "moth",
      );
      const before = { vale: vale.xp, moth: s.actors.moth.xp };
      const next = play(
        s,
        give || actions[(turn * 7919) % actions.length],
      ).state;
      const last = s.log.at(-1)?.seq ?? 0;
      const accepted =
        give &&
        next.log.some((e) => e.seq > last && e.verb === "give" && e.accepted);
      if (accepted) {
        expect(next.actors.vale.xp).toBeGreaterThan(before.vale);
        expect(next.actors.moth.xp).toBeGreaterThan(before.moth);
        both++;
      }
      s = next;
      expect(validWant(s, "vale")).toBe(true);
    }
    expect(both).toBeGreaterThan(0);
  });
});
