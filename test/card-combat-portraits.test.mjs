import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { humanAvatarIds } from "../v2/card-game/human-cast.mjs";
import { combatPortrait } from "../v2/card-game/combat-portraits.mjs";
import { people } from "../v2/card-game/world.mjs";
import { packPeople } from "../v2/card-game/pack-registry.mjs";
import { portrait } from "../v2/card-game/scene.mjs";
import variants from "../v2/card-game/image-variants.json" with { type: "json" };
import {
  nativePortraitFacing,
  flipStagePortrait,
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
  it("covers the current cast in both directions without changing backdrop residents", () => {
    for (const id of Object.keys(people))
      for (const pose of ["attack", "hit", "guard"])
        for (const facing of ["left", "right"]) {
          const result = combatPortrait(id, pose, portrait(id, facing), facing);
          if (
            (id === "keeper" && facing === "right") ||
            packPeople[id]?.presentation === "backdrop"
          ) {
            expect(result).toBeNull();
            continue;
          }
          expect(result, `${id}/${pose}/${facing}`).toBeTruthy();
          const stage = variants.images[result.slice(2)].stage;
          expect(
            existsSync(new URL(`../v2/card-game/${stage}`, import.meta.url)),
          ).toBe(true);
          const native = nativePortraitFacing(result);
          expect(native).toMatch(/^(left|right)$/u);
          expect(flipStagePortrait(result, facing)).toBe(native !== facing);
          expect(portraitFraming(result)).toBe("wide");
        }
  });
  it("shares the poses of accounts with the same canonical portrait", () => {
    const selected = new Map();
    for (const [id, actor] of Object.entries(packPeople)) {
      if (!actor.portrait) continue;
      for (const pose of ["attack", "hit", "guard"]) {
        const key = `${actor.portrait}/${pose}`;
        const result = combatPortrait(id, pose, actor.portrait, "left");
        if (selected.has(key)) expect(result).toBe(selected.get(key));
        else selected.set(key, result);
      }
    }
  });
  it("turns front-facing residents for combat without changing their neutral art", () => {
    for (const id of ["badger", "hoppycat-tapi-lilt"]) {
      expect(nativePortraitFacing(portrait(id))).toBe("front");
      expect(
        nativePortraitFacing(
          combatPortrait(id, "attack", portrait(id), "left"),
        ),
      ).toBe("left");
    }
  });
  it("leaves unpainted actors and unsupported poses on their authored portraits", () => {
    expect(
      combatPortrait("future-unpainted-avatar", "guard", "guard.png", "left"),
    ).toBeNull();
    expect(combatPortrait("vale", "walk", "vale.png", "right")).toBeNull();
  });
  it("keeps the original portrait when a registered stage image is missing", () => {
    const path = "assets/combat/greek-antigone-guard.webp";
    const original = variants.images[path];
    variants.images[path] = { card: "assets/card-back.webp" };
    try {
      expect(
        combatPortrait("greek-antigone", "guard", "original.png", "left"),
      ).toBeNull();
    } finally {
      variants.images[path] = original;
    }
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
    // Recovered poses complete the families; Oak remains a backdrop.
    expect(combatPortrait("greek-shipmaster", "attack", null, "left")).toBe(
      "./assets/combat/greek-shipmaster-attack.webp",
    );
    expect(combatPortrait("hoppycat-arc", "hit", null, "left")).toBe(
      "./assets/combat/hoppycat-arc-hit.webp",
    );
    expect(combatPortrait("oak", "hit", null, "left")).toBe(null);
  });
});
