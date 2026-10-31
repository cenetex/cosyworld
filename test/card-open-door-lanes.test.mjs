import { describe, expect, it } from "vitest";
import { exits, laneFact } from "../v2/card-game/world.mjs";
import { entityActive } from "../v2/card-game/pack-registry.mjs";
import { lanePath } from "../v2/card-game/pack-transport.mjs";
import { openingFixture } from "./helpers/greek-opening.mjs";
import { openDoorStart, openDoorWalk, openSeas } from "./helpers/open-door.mjs";

// Dione's invitation opens the Wine-Dark Harbor to Piraeus lane (with the
// Travel Provisions aboard) and every Attic road; the Piraeus to Athens
// Harbor lane waits for the plea at the Agora. The other Attic roads are
// local roads, and the Sacred Way lies outside the released opening.
const ATTICA = ["road-athens-piraeus", "athens", "eleusis", "colonus"]
  .concat(["marathon", "athens-harbor"])
  .map((id) => `greek-${id}`);
const sea = (s, from, to) => lanePath(s, "greek-ship", from, to) !== null;

describe("the Open Door opens the Piraeus lane and the Attic roads", () => {
  it("keeps the lane and every road closed until Dione's invitation", () => {
    const s = openingFixture("refusal").closed;
    expect(s.packs["greek-drama"].flags["greek-open-door-open"]).toBeFalsy();
    expect(s.items["greek-provisions"].holder).toBe("greek-ship");
    expect(sea(s, "greek-harbor", "greek-piraeus")).toBe(false);
    for (const id of ATTICA) expect(entityActive(s, id), id).toBe(false);
  });

  it("opens the lane with the provisions aboard and walks every road", () => {
    let s = openDoorStart();
    expect(sea(s, "greek-harbor", "greek-piraeus")).toBe(true);
    const ashore = structuredClone(s);
    ashore.items["greek-provisions"].holder = "greek-harbor";
    expect(sea(ashore, "greek-harbor", "greek-piraeus")).toBe(false);
    // Real plays: sail to Piraeus, then walk each road of Attica.
    s = openDoorWalk(s, "harbor", "piraeus", "eleusis", "athens", "colonus");
    s = openDoorWalk(s, "marathon", "athens", "athens-harbor", "athens");
    s = openDoorWalk(s, "piraeus");
    expect(s.actors.vale.place).toBe("greek-piraeus");
    for (const id of ATTICA) expect(entityActive(s, id), id).toBe(true);
    // The sea lane between Piraeus and Athens Harbor stays closed both ways.
    expect(sea(s, "greek-piraeus", "greek-athens-harbor")).toBe(false);
    expect(sea(s, "greek-athens-harbor", "greek-piraeus")).toBe(false);
    expect(exits(s, "greek-athens-harbor", "vale")).not.toContain("greek-ship");
  });

  it("opens the Piraeus to Athens Harbor lane with the plea at the Agora", () => {
    const s = openSeas();
    expect(
      s.packs["greek-drama"].flags["greek-open-door-plea-registered"],
    ).toBe(true);
    expect(sea(s, "greek-piraeus", "greek-athens-harbor")).toBe(true);
    expect(sea(s, "greek-athens-harbor", "greek-piraeus")).toBe(true);
    // A story gate is nothing aboard: Myrto's told words stay the same.
    expect(laneFact("greek-athens-harbor", "greek-piraeus").text).toBe(
      "Ships for Piraeus Quays leave from Athens Harbor.",
    );
  });
});
