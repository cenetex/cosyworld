import { describe, expect, it } from "vitest";
import {
  activeWardrobe,
  wardrobePortrait,
  wardrobePoseForSource,
  validWardrobe,
  wardrobeKey,
} from "../v2/card-game/wardrobe.mjs";
const outfit = (items, base, images = {}) => ({
  items,
  images: { base, ...images },
});
const entries = [
  outfit([], "plain"),
  outfit(["scarf"], "scarf"),
  outfit(["armor"], "armor"),
  outfit(["armor", "scarf"], "both", {
    strike: "both-strike",
    sleep: "both-sleep",
  }),
];
const world = () => ({
  actors: { rati: {}, other: {} },
  items: { armor: { holder: "rati" }, scarf: { holder: "rati" } },
});
describe("item-dependent avatar wardrobe", () => {
  it("prefers complete combinations and reverts as items leave", () => {
    const state = world();
    expect(wardrobePortrait(state, "rati", entries)).toBe("both");
    state.items.scarf.holder = "other";
    expect(wardrobePortrait(state, "rati", entries)).toBe("armor");
    state.items.armor.holder = "room";
    expect(wardrobePortrait(state, "rati", entries)).toBe("plain");
  });
  it("does not equip nested, absent or another actor's items", () => {
    const state = world();
    state.items.scarf.holder = "box";
    delete state.items.armor;
    expect(activeWardrobe(state, "rati", entries).items).toEqual([]);
    expect(activeWardrobe(state, "missing", entries)).toBeNull();
    expect(activeWardrobe(null, "rati", entries)).toBeNull();
  });
  it("breaks ties independently of authored order and normalizes item order", () => {
    const singles = entries.slice(1, 3);
    expect(activeWardrobe(world(), "rati", singles)).toEqual(
      activeWardrobe(world(), "rati", [...singles].reverse()),
    );
    expect(wardrobeKey(["scarf", "armor"])).toBe(
      wardrobeKey(["armor", "scarf"]),
    );
  });
  it("keeps missing poses in the same outfit and maps runtime pose names", () => {
    expect(wardrobePortrait(world(), "rati", entries, "sleep")).toBe(
      "both-sleep",
    );
    expect(wardrobePortrait(world(), "rati", entries, "sad")).toBe("both");
    expect(wardrobePoseForSource(entries, "./both", "attack")).toBe(
      "both-strike",
    );
    expect(wardrobePoseForSource(entries, "./both-sleep", "guard")).toBe(
      "both",
    );
    expect(wardrobePoseForSource(entries, "unknown", "hit")).toBeNull();
  });
  it("validates bounded unique item sets, roles and media", () => {
    const valid = (value) =>
      validWardrobe(
        value,
        (id) => ["armor", "scarf"].includes(id),
        (path) => typeof path === "string" && !!path,
      );
    expect(valid(entries)).toBe(true);
    for (const bad of [
      [outfit(["missing"], "x")],
      [outfit(["armor", "armor"], "x")],
      [outfit([], "x"), outfit([], "y")],
      [outfit([], "x", { caption: "text" })],
      [{ items: [], images: {} }],
      [outfit([], null)],
    ])
      expect(valid(bad)).toBe(false);
  });
});

import { packProblems } from "../v2/card-game/pack-schema.mjs";
import {
  packDefinitions,
  packPeople,
  hub,
} from "../v2/card-game/pack-registry.mjs";
import { portrait } from "../v2/card-game/scene.mjs";
import { combatPortrait } from "../v2/card-game/combat-portraits.mjs";
it("schema accepts wardrobe alongside temperament and rejects unknown items", () => {
  const pack = structuredClone(
    packDefinitions.find(
      (p) => Object.keys(p.items || {}).length && Object.keys(p.avatars).length,
    ),
  );
  const id = Object.keys(pack.avatars)[0];
  pack.avatars[id].wardrobe = [
    outfit([Object.keys(pack.items)[0]], `assets/${pack.id}/wear.png`),
  ];
  expect(packProblems(pack, hub).filter((p) => p.includes("wardrobe"))).toEqual(
    [],
  );
  pack.avatars[id].wardrobe[0].items = ["missing-item"];
  expect(packProblems(pack, hub).some((p) => p.includes("wardrobe"))).toBe(
    true,
  );
});
it("scene and combat render the authored outfit without replacing legacy fallback", () => {
  const id = Object.keys(packPeople)[0],
    entity = packPeople[id];
  const previous = entity.wardrobe;
  entity.wardrobe = [
    outfit(["armor"], "assets/outfit.png", {
      strike: "assets/strike.png",
      sleep: "assets/sleep.png",
    }),
  ];
  const state = {
    actors: { [id]: { awake: true } },
    items: { armor: { holder: id } },
  };
  try {
    expect(portrait(id, null, state)).toBe("./assets/outfit.png");
    expect(combatPortrait(id, "attack", "./assets/outfit.png")).toBe(
      "./assets/strike.png",
    );
    state.actors[id].sleeping = { since: 1 };
    expect(portrait(id, null, state)).toBe("./assets/sleep.png");
  } finally {
    if (previous === undefined) delete entity.wardrobe;
    else entity.wardrobe = previous;
  }
});
