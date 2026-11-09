import { atticOpening } from "./fixtures/card-attic-opening.mjs";
import { describe, expect, it } from "vitest";
import { legalActions, exits } from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";

// #1550 replaces the old "ring twice for a three-turn window" signal with a
// static gate: the pond-clearing crossing opens while the player holds the
// bell at the pond.
function heldBellAtPond() {
  const s = enableMotives(atticOpening());
  s.actors.vale.place = "pond";
  s.actors.moth.place = "attic";
  s.items.lamp.holder = "moth";
  s.items.bell.holder = "vale"; // Vale holds the bell at the pond
  return s;
}
const visible = (s) => exits(s, "pond", "vale").includes("clearing");

describe("the held-bell path to Forest Clearing", () => {
  it("opens while Vale holds the bell at the pond", () => {
    expect(visible(heldBellAtPond())).toBe(true);
  });

  it("closes when the bell is put down", () => {
    const s = heldBellAtPond();
    s.items.bell.holder = "pond";
    expect(visible(s)).toBe(false);
  });

  it("closes when Vale leaves the pond while still holding the bell", () => {
    const s = heldBellAtPond();
    s.actors.vale.place = "attic";
    expect(visible(s)).toBe(false);
  });

  it("keeps independent NPC crossing gated", () => {
    const s = heldBellAtPond();
    s.actors.moth.place = "pond";
    for (const actor of ["moth", "keeper", "badger"]) {
      expect(exits(s, "pond", actor)).not.toContain("clearing");
      expect(
        legalActions(s, actor).some(
          (a) => a.kind === "move" && a.target === "clearing",
        ),
      ).toBe(false);
    }
  });
});
