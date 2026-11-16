import { describe, expect, it } from "vitest";
import { createWorld, exits, holdChoice, legalActions, play, placeText } from "../v2/card-game/world.mjs";
import { cardPlay, lockWords } from "../v2/card-game/cards.mjs";
import { isLockedBox } from "../v2/card-game/locked-box.mjs";
import { backdrop } from "../v2/card-game/scene.mjs";

const hold = (world, item) => {
  const next = structuredClone(world);
  holdChoice(next, "vale", { item, revision: next.revision });
  return next;
};

describe("a new world's opening", () => {
  const world = createWorld({ opening: true });
  const shut = (s) => {
    expect(s.items.lamp.lit).toBe(true);
    expect(isLockedBox(s, "pond")).toBe(true);
    expect(lockWords(s, "pond", () => true)).toBe("Hold the dark Lamp");
    expect(exits(s, "attic")).toEqual([]);
    expect(placeText(s, "attic")).not.toContain("black shore");
    expect(backdrop("attic", s)).toContain("attic-lit");
  };

  it("shows the Black pond as a locked box while the lamp is lit", () => {
    shut(world);
    expect(cardPlay(world, ["pond"]).action).toBeFalsy();
  });

  it("opens the mirror when the lamp is put away, and shuts it when raised", () => {
    const dark = hold(world, null);
    expect(dark.items.lamp).toMatchObject({ holder: "vale", lit: false });
    expect(isLockedBox(dark, "pond")).toBe(false);
    expect(exits(dark, "attic")).toEqual(["pond"]);
    expect(placeText(dark, "attic")).toContain("opens onto a black shore");
    expect(backdrop("attic", dark)).toContain("attic-doused");
    expect(cardPlay(dark, ["pond"]).action).toMatchObject({ kind: "move", target: "pond" });
    shut(hold(dark, "lamp"));
  });

  it("keeps the pond locked while the lit lamp lies in the attic", () => {
    const down = play(world, cardPlay(world, ["lamp", "attic"]).action, world.revision).state;
    expect(down.items.lamp.holder).toBe("attic");
    expect(down.opened).toBeUndefined();
    shut(down);
    const taken = play(down, cardPlay(down, ["lamp"]).action, down.revision).state;
    shut(taken);
    expect(exits(hold(taken, null), "attic")).toEqual(["pond"]);
  });

  it("locks the pond again each time the lamp is lit after a visit", () => {
    let s = hold(world, null);
    s = play(s, cardPlay(s, ["pond"]).action, s.revision).state;
    s = hold(s, "lamp");
    expect(exits(s, "pond")).toContain("attic");
    s = play(s, cardPlay(s, ["attic"]).action, s.revision).state;
    expect(s.actors.vale.place).toBe("attic");
    shut(s);
    expect(isLockedBox(hold(s, null), "pond")).toBe(false);
  });

  it("opens the way with a dry lamp or with no lamp in the attic", () => {
    const dry = structuredClone(world);
    Object.assign(dry.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
    expect(exits(dry, "attic")).toEqual(["pond"]);
    const gone = structuredClone(world);
    gone.items.lamp.holder = "pond";
    expect(exits(gone, "attic")).toEqual(["pond"]);
  });
});

describe("after the mirror first opens", () => {
  const go = (s, test) => {
    const action = legalActions(s).find(test);
    expect(action).toBeTruthy();
    const result = play(s, action, s.revision);
    expect(result.ok).toBe(true);
    return result.state;
  };

  it("carries the lamp to Pip and lights it there by ordinary plays", () => {
    let s = go(hold(createWorld({ opening: true }), null), (a) => a.kind === "move" && a.target === "pond");
    s = go(s, (a) => a.kind === "talk" && a.target === "moth");
    s = go(s, (a) => a.kind === "accept" && a.target === "moth");
    expect(s.actors.vale.want).toMatchObject({ target: "lamp", step: { verb: "give", to: "moth" } });
    s = hold(s, "lamp");
    expect(s.items.lamp.lit).toBe(true);
    s = go(s, (a) => a.kind === "give" && a.item === "lamp" && a.target === "moth");
    expect(s.items.lamp.holder).toBe("moth");
    expect(s.actors.vale.want).toBeNull();
  });
});
