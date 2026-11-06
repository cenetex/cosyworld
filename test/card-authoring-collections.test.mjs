import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildAuthoringTree,
  authoringCardId,
} from "../v2/card-game/authoring-tree.mjs";
import {
  authoringCollections,
  WORLD,
  TOOLS,
} from "../v2/card-game/authoring-collections.mjs";
import { residentPortrait } from "../v2/card-game/resident-portrait.mjs";
const load = (path) => JSON.parse(readFileSync(path, "utf8"));

describe("authoring collections", () => {
  it.each(["greek-drama", "badger-forest", "hoppycat-archive"])(
    "keeps %s source paths and custody references in three collections",
    (name) => {
      const source = {
        pack: load(`v2/content/${name}/card-world.json`),
        bridge: load(`v2/worlds/${name}/card-bridge.json`),
      };
      const before = JSON.stringify(source),
        raw = buildAuthoringTree(source).cards;
      const { world, tools } = authoringCollections(raw, source);
      expect(
        world.filter((c) => c.holder === WORLD).map((c) => c.name),
      ).toEqual(["Items", "Avatars", "Locations"]);
      expect(tools[0].id).toBe(TOOLS);
      const all = new Map([...world, ...tools].map((c) => [c.id, c]));
      for (const card of raw) {
        expect(all.get(card.id).source).toEqual(card.source);
        expect(all.get(card.id).canonicalId).toBe(card.canonicalId);
        if (card.role === "entity") {
          expect(all.get(card.id).holder).toBe(
            authoringCardId(["pack", card.source[1]], "collection"),
          );
          if (card.holder !== WORLD) {
            const ref = all.get(`${card.id}-contents`);
            expect(ref.ref).toBe(card.id);
            expect(ref.holder).toBe(card.holder);
          }
        }
      }
      expect(JSON.stringify(source)).toBe(before);
    },
  );
  it("uses the initial Badger variant for the entity and its Contents reference", () => {
    const source = { pack: load("v2/content/badger-forest/card-world.json") };
    const view = authoringCollections(buildAuthoringTree(source).cards, source);
    const cards = view.world.filter((c) => c.canonicalId === "badger");
    expect(cards).toHaveLength(2);
    expect(
      cards.every(
        (c) => c.art === source.pack.avatars.badger.variants.asleep.portrait,
      ),
    ).toBe(true);
  });
  it("keeps the scene's pose, portrait and variant precedence", () => {
    const resident = {
      portrait: "base",
      variants: { awake: { portrait: "awake" } },
    };
    expect(
      residentPortrait(
        resident,
        { portrait: "variant" },
        { portrait: "pose", scale: 0.5 },
      ),
    ).toBe("pose");
    expect(residentPortrait(resident, { portrait: "variant" })).toBe("base");
    delete resident.portrait;
    expect(residentPortrait(resident, { portrait: "variant" })).toBe("variant");
    expect(residentPortrait(resident)).toBe("awake");
  });
});
