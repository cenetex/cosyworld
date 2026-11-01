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
        expect(portraitFraming(result)).toBe("wide");
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
      combatPortrait("greek-ferryman", "guard", "ferryman.png", "left"),
    ).toBeNull();
    expect(combatPortrait("vale", "walk", "vale.png", "right")).toBeNull();
  });
});

describe("combat art for the wider cast", () => {
  it("serves painted poses by identity, shares them with aliases and falls back without one", () => {
    const greek = combatPortrait(
      "greek-antigone",
      "attack",
      "./assets/greek-drama/chthonic-antigone.png",
      "left",
    );
    expect(greek).toBe("./assets/combat/greek-antigone-attack.webp");
    expect(nativePortraitFacing(greek)).toBe("left");
    expect(combatPortrait("greek-orestes-euripides", "hit", null, "left")).toBe(
      "./assets/combat/greek-orestes-aeschylus-hit.webp",
    );
    const cat = combatPortrait("hoppycat-tapi-lilt", "guard", null, "right");
    expect(cat).toBe("./assets/combat/hoppycat-tapi-lilt-guard.webp");
    expect(nativePortraitFacing("./assets/combat/rati-attack.webp")).toBe(
      "right",
    );
    // Unpainted poses and Oak's backdrop keep the neutral portrait.
    expect(combatPortrait("greek-shipmaster", "attack", null, "left")).toBe(
      null,
    );
    expect(combatPortrait("hoppycat-arc", "hit", null, "left")).toBe(null);
    expect(combatPortrait("oak", "hit", null, "left")).toBe(null);
  });
});
