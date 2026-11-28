import "./helpers/no-dwell.mjs";
import { questing } from "./helpers/first-quest.mjs";
import { describe, expect, it } from "vitest";
import {
  createWorld as baseCreateWorld,
  decodeSave,
  validateWorld,
} from "../v2/card-game/world.mjs";
import { act, reload } from "./helpers/play.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { neverBack } from "../v2/card-game/pack-registry.mjs";
import { bringBack, gone, usedUp } from "../v2/card-game/item-use.mjs";
import { newWant } from "../v2/card-game/want.mjs";
import { giveUpForGood, goneSince } from "../v2/card-game/world/for-good.mjs";
import data from "../v2/card-game/arcana.json" with { type: "json" };
import { recordOf } from "../v2/card-game/world/arcana.mjs";

const createWorld = (...args) => questing(baseCreateWorld(...args));
const wait = (world) => act(world, { kind: "wait", sleep: undefined });
const COTTAGE = "forest-cottage";
const BUTTON = "forest-button-vale";
function sewing() {
  let world = enableMotives(createWorld());
  world.actors.vale.place = "attic";
  world.items.cloth.holder = "vale";
  world.items.lamp.holder = "attic";
  world.items.lamp.lit = true;
  world.items.lamp.fuel = 12;
  world = act(world, { kind: "move", target: COTTAGE });
  world.actors.vale.place = world.items[BUTTON].holder;
  world = act(world, { kind: "take", item: BUTTON });
  world.actors.vale.place = COTTAGE;
  return world;
}

describe("a thing given up for good", () => {
  it("never comes back, and a resident's want on it ends", () => {
    let world = createWorld({ seed: 7 });
    world.actors.moth.want = newWant("item", "bell", world.turn);
    expect(neverBack(world, "bell")).toBe(false);
    expect(giveUpForGood(world, "bell")).toBe(true);
    expect(gone(world, "bell")).toBe(true);
    expect(usedUp(world, "bell")).toBe(true);
    expect(neverBack(world, "bell")).toBe(true);
    bringBack(world, "bell", world.actors.vale.place);
    expect(usedUp(world, "bell")).toBe(true);
    world = reload(world);
    expect(world.gone).toEqual(["bell"]);
    for (let i = 0; i < 4; i++) world = wait(world);
    expect(usedUp(world, "bell")).toBe(true);
    expect(world.actors.moth.want?.target).not.toBe("bell");
  });

  it("keeps the gone list inside the used-up list on load", () => {
    const world = createWorld({ seed: 7 });
    giveUpForGood(world, "bell");
    const bad = structuredClone(world);
    bad.gone = ["bell", "lamp"];
    expect(() => validateWorld(bad)).toThrow();
    const loaded = decodeSave(JSON.stringify(bad));
    expect(loaded.gone).toEqual(["bell"]);
  });

  it("marks the play that loses a thing for good, then Collect proves XIII", () => {
    let world = sewing();
    const xiii = data.cards.find((card) => card.number === 13);
    world.actors.vale.arcana = {
      proved: [],
      did: [],
      spread: [{ card: xiii.id, face: "up" }],
    };
    const before = new Set(world.usedUp);
    world = act(world, { kind: "give", item: BUTTON, target: "rati" });
    expect(recordOf(world, "vale")).toMatchObject({
      proved: [],
      spread: [{ card: xiii.id, face: "reward", done: true }],
    });
    world = act(world, { kind: "accept", tarot: 0 });
    expect(neverBack(world, BUTTON)).toBe(true);
    expect(goneSince(world, before)).toEqual([BUTTON]);
    const entry = world.log.findLast(
      (e) => e.kind === "action" && e.verb === "give",
    );
    expect(entry.gone).toEqual([BUTTON]);
    expect(recordOf(world, "vale").proved).toContain(xiii.id);
  });

  it("leaves an ordinary play unmarked", () => {
    const world = wait(createWorld({ seed: 7 }));
    expect(world.log.some((e) => e.gone)).toBe(false);
  });
});
