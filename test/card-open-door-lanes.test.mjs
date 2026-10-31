import { describe, expect, it } from "vitest";
import { exits, laneFact } from "../v2/card-game/world.mjs";
import { entityActive } from "../v2/card-game/pack-registry.mjs";
import { lanePath } from "../v2/card-game/pack-transport.mjs";
import { openingFixture } from "./helpers/greek-opening.mjs";
import {
  openDoorStart,
  openDoorWalk,
  openSeas,
} from "./helpers/open-door.mjs";

// The Open Door chain at sea and on land (#1535, owner decision 2026-10-31):
// Dione's invitation opens the Wine-Dark Harbor to Piraeus lane (with the
// Travel Provisions aboard) and every Attic road. The lane between Piraeus
// and Athens Harbor waits for the plea registered at the Agora.
// The other Attic roads are local roads (direct exits between their ends);
// the Sacred Way and Delphi are outside the released opening.
const ATTICA = [
  "greek-road-athens-piraeus",
  "greek-athens",
  "greek-eleusis",
  "greek-colonus",
  "greek-marathon",
  "greek-athens-harbor",
];
const sea = (s, from, to) => lanePath(s, "greek-ship", from, to) !== null;
const flag = (s, key) => s.packs["greek-drama"].flags[key] ?? false;
// Every place a traveller can walk to from here, without the ship.
function onFoot(s, start) {
  const seen = new Set([start]);
  for (const here of seen)
    for (const to of exits(s, here, "vale"))
      if (to !== "greek-ship" && to !== "greek-road-thebes") seen.add(to);
  return seen;
}

describe("the Open Door opens the Piraeus lane and the Attic roads", () => {
  it("keeps the lane and every road closed until Dione's invitation", () => {
    const s = openingFixture("refusal").closed;
    expect(flag(s, "greek-open-door-open")).toBe(false);
    // The provisions ride on deck, yet the lane waits for the Open Door.
    expect(s.items["greek-provisions"].holder).toBe("greek-ship");
    expect(sea(s, "greek-harbor", "greek-piraeus")).toBe(false);
    for (const id of ATTICA) expect(entityActive(s, id), id).toBe(false);
    expect(exits(s, "greek-piraeus", "vale")).not.toContain(
      "greek-road-athens-piraeus",
    );
  });

  it("opens the lane with the provisions aboard and lets every road be walked", () => {
    let s = openDoorStart();
    expect(flag(s, "greek-open-door-open")).toBe(true);
    expect(sea(s, "greek-harbor", "greek-piraeus")).toBe(true);
    const ashore = structuredClone(s);
    ashore.items["greek-provisions"].holder = "greek-harbor";
    expect(sea(ashore, "greek-harbor", "greek-piraeus")).toBe(false);
    // Real plays: board at the harbor, sail to Piraeus, then walk Attica.
    s = openDoorWalk(s, "harbor", "piraeus");
    expect(s.actors.vale.place).toBe("greek-piraeus");
    expect([...onFoot(s, "greek-piraeus")]).toEqual(
      expect.arrayContaining(ATTICA),
    );
    s = openDoorWalk(s, "eleusis", "athens", "colonus", "marathon");
    s = openDoorWalk(s, "athens", "athens-harbor", "athens", "piraeus");
    expect(s.actors.vale.place).toBe("greek-piraeus");
    // The sea lane between Piraeus and Athens Harbor stays closed both ways.
    expect(sea(s, "greek-piraeus", "greek-athens-harbor")).toBe(false);
    expect(sea(s, "greek-athens-harbor", "greek-piraeus")).toBe(false);
    expect(exits(s, "greek-athens-harbor", "vale")).not.toContain(
      "greek-ship",
    );
  });

  it("opens the Piraeus to Athens Harbor lane with the plea at the Agora", () => {
    const s = openSeas();
    expect(flag(s, "greek-open-door-plea-registered")).toBe(true);
    expect(sea(s, "greek-piraeus", "greek-athens-harbor")).toBe(true);
    expect(sea(s, "greek-athens-harbor", "greek-piraeus")).toBe(true);
  });

  it("tells a story gate as nothing aboard, so told lanes keep their words", () => {
    expect(laneFact("greek-harbor", "greek-piraeus").text).toBe(
      "Ships for Piraeus Quays leave from The Wine-Dark Harbor only with Travel Provisions aboard.",
    );
    expect(laneFact("greek-athens-harbor", "greek-piraeus").text).toBe(
      "Ships for Piraeus Quays leave from Athens Harbor.",
    );
  });
});
