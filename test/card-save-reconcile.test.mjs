import { describe, it, expect } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
} from "../v2/card-game/world.mjs";
import { availableCards, cardActions } from "../v2/card-game/cards.mjs";

const released = encodeSave(createWorld());
const exercise = (s) => {
  for (const id of availableCards(s)) cardActions(s, [id]);
  return legalActions(s);
};

describe("a loaded save follows the current content", () => {
  it("adds a thing the save lacks and drops one the content no longer has", () => {
    const s = JSON.parse(released);
    delete s.items.bell;
    delete s.items.cloth;
    s.items["retired-thing"] = { holder: "vale", history: [] };
    s.items.lamp.holder = "retired-thing";
    const loaded = decodeSave(JSON.stringify(s));
    expect(loaded.items.bell).toBeTruthy();
    expect(loaded.items.cloth).toBeTruthy();
    expect(loaded.items["retired-thing"]).toBeUndefined();
    // Vale keeps what the retired thing held.
    expect(loaded.items.lamp.holder).toBe("vale");
    expect(() => exercise(loaded)).not.toThrow();
  });

  it("offers a fresh start, never a crash, for a save it cannot read", () => {
    const s = JSON.parse(encodeSave(createWorld()));
    s.items = null;
    expect(() => decodeSave(JSON.stringify(s))).toThrow(/fresh start/);
    const broken = JSON.parse(released);
    broken.actors.vale = null;
    expect(() => decodeSave(JSON.stringify(broken))).toThrow(/fresh start/);
  });
});
