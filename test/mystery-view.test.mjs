import { describe, expect, it } from "vitest";
import { createWorld } from "../v2/card-game/world.mjs";
import { availableCards } from "../v2/card-game/cards.mjs";
import { tableHolder, tableType } from "../v2/card-game/mystery-view.mjs";
import { openingFixture } from "./helpers/greek-opening.mjs";

const raven = "ratiradio-raven";
const room = "ratiradio-listening-room";

describe("location mystery projection", () => {
  it("puts a sealed destination in the location stack without changing custody", () => {
    const world = structuredClone(openingFixture("burial").decree);
    world.actors.vale.place = "greek-gate";
    const before = JSON.stringify(world);
    expect(availableCards(world)).toContain("greek-battlefield");
    expect(tableHolder(world, "greek-battlefield")).toBe("greek-gate");
    expect(tableType(world, "greek-battlefield")).toBe("item");
    expect(world.items["greek-battlefield"]).toBeUndefined();
    expect(JSON.stringify(world)).toBe(before);
  });
  it("moves a revealed resident out of the item stack and reboxes if locked again", () => {
    const world = createWorld();
    world.actors.vale.place = room;
    world.packs.ratiradio.flags["listening-open"] = true;
    // The fixture opens the room's authored requirements directly.
    world.packs.ratiradio.scope = "full";
    world.packs.ratiradio.flags["raven-awake"] = false;
    const before = JSON.stringify(world);
    expect(tableType(world, raven)).toBe("item");
    expect(tableHolder(world, raven)).toBe(room);
    expect(JSON.stringify(world)).toBe(before);
    world.packs.ratiradio.flags["raven-awake"] = true;
    expect(tableType(world, raven)).toBe("avatar");
    expect(tableHolder(world, raven)).toBeNull();
    world.packs.ratiradio.flags["raven-awake"] = false;
    expect(tableType(world, raven)).toBe("item");
    expect(world.items[raven]).toBeUndefined();
  });
  it("preserves actual item custody and does not box personally hidden avatars", () => {
    const world = createWorld();
    world.hidden = { actor: "mara", place: "pond", met: [] };
    world.actors.mara.place = "pond";
    expect(tableHolder(world, "lamp")).toBe(world.items.lamp.holder);
    expect(tableType(world, "mara")).toBe("avatar");
    expect(tableHolder(world, "mara")).toBeNull();
    expect(world.hidden.met).toEqual([]);
  });
  it("does not manufacture boxes for absent actors or disabled packs", () => {
    const world = createWorld();
    world.absent = ["mara"];
    world.disabledPacks = ["ratiradio"];
    expect(availableCards(world)).not.toContain("mara");
    expect(availableCards(world)).not.toContain(raven);
    expect(tableType(world, "mara")).toBe("avatar");
  });
});
