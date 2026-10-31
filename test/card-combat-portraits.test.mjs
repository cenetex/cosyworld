import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { humanAvatarIds } from "../v2/card-game/human-cast.mjs";
import { combatPortrait } from "../v2/card-game/combat-portraits.mjs";
import {
  nativePortraitFacing,
  portraitFraming,
} from "../v2/card-game/portrait-facing.mjs";

describe("combat art on the current stage", () => {
  it("keeps each player's plain or scarf wardrobe and uses registered paintings", () => {
    for (const id of humanAvatarIds)
      for (const scarf of ["", "-scarf"]) {
        const source = `./assets/shared/characters/${id}${scarf}.png`;
        const result = combatPortrait(id, "guard", source, "left");
        expect(result).toBe(`./assets/combat/${id}${scarf}-guard.webp`);
        expect(
          existsSync(new URL(`../v2/card-game/${result}`, import.meta.url)),
        ).toBe(true);
        expect(nativePortraitFacing(result)).toBe("right");
        // A standing guard remains in the same wardrobe when another beat starts.
        expect(combatPortrait(id, "guard", result, "right")).toBe(result);
      }
  });
  it("keeps residents inside the phone and never mirrors the Keeper's clock", () => {
    for (const id of ["moth", "keeper"]) {
      const result = combatPortrait(id, "guard", `./assets/${id}.png`, "left");
      expect(nativePortraitFacing(result)).toBe("left");
      expect(portraitFraming(result)).toBe("wide");
    }
    expect(
      combatPortrait("keeper", "guard", "./assets/keeper-right.png", "right"),
    ).toBeNull();
  });
  it("leaves other actors and unsupported poses on their authored portraits", () => {
    expect(
      combatPortrait("greek-guard", "guard", "guard.png", "left"),
    ).toBeNull();
    expect(combatPortrait("vale", "walk", "vale.png", "right")).toBeNull();
  });
});
