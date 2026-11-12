// The 2026-11-11 audit fixes, on the real Greek pack in a new world:
// nothing opens the Open Door, and a Hoppy Cat thing does not open the harbor
// lane to Piraeus. (Finishing the Open Door without Marathon is checked in
// card-open-door.test.mjs.)
import { describe, expect, it } from "vitest";
import { createWorld, legalActions } from "../v2/card-game/world.mjs";
import { conditionMet } from "../v2/card-game/pack-rules.mjs";
import {
  entityActive,
  packDefinition,
} from "../v2/card-game/pack-registry.mjs";

describe("Attica is simply there", () => {
  it("shows Attica, its residents and its things with Polynices unburied", () => {
    const world = createWorld();
    const flags = world.packs["greek-drama"].flags;
    expect(flags["greek-burial-performed"]).toBeFalsy();
    expect(flags["greek-open-door-open"]).toBeUndefined();
    for (const id of [
      "greek-aethra",
      "greek-adrastus",
      "greek-theseus",
      "greek-quay-host",
      "greek-colonus-keeper",
    ])
      expect(entityActive(world, id), id).toBe(true);
    for (const id of [
      "greek-colonus",
      "greek-eleusis",
      "greek-cithaeron",
      "greek-road-athens-eleusis",
    ])
      expect(entityActive(world, id), id).toBe(true);
    for (const id of [
      "greek-return-cloths",
      "greek-provision-basket",
      "greek-grove-cup",
      "greek-grove-honey",
    ])
      expect(entityActive(world, id), id).toBe(true);
    // Marathon stays a rumour in a new world.
    expect(entityActive(world, "greek-marathon")).toBe(false);
  });

  it("no pack data reads or writes the burial's old flag", () => {
    const text = JSON.stringify(packDefinition("greek-drama"));
    expect(text).not.toContain("greek-open-door-open");
  });
});

describe("harbor to Piraeus needs the provisions on deck", () => {
  it("is not opened by a Hoppy Cat thing aboard", () => {
    const lane = packDefinition("greek-drama").transports[
      "greek-ship"
    ].lanes.find((l) => l.from === "greek-harbor" && l.to === "greek-piraeus");
    expect(JSON.stringify(lane.opensWith)).not.toContain("hoppycat");
    const world = createWorld();
    world.items["hoppycat-halfway-cup"].holder = "greek-ship";
    world.actors.vale.place = "greek-ship";
    world.transports["greek-ship"].dock = "greek-harbor";
    expect(
      conditionMet(world, {
        kind: "pack_item_present",
        pack: "hoppycat-archive",
        place: "greek-ship",
      }),
    ).toBe(true);
    const courses = legalActions(world, "vale")
      .filter((a) => a.kind === "course")
      .map((a) => a.target);
    expect(courses).not.toContain("greek-piraeus");
    // Provisions lying on deck do open it.
    world.items["greek-provisions"].holder = "greek-ship";
    world.usedUp = [];
    expect(
      legalActions(world, "vale")
        .filter((a) => a.kind === "course")
        .map((a) => a.target),
    ).toContain("greek-piraeus");
  });
});
