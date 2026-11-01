import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  drawSpecials,
  specialsAllow,
  RARITY_WEIGHTS,
} from "../v2/card-game/pack-specials.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import {
  hub,
  packDefinition,
  packDefinitions,
} from "../v2/card-game/pack-registry.mjs";
import { createWorld, decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import { sharedContentInput } from "../v2/scripts/shared-content-input.mjs";

// A test pool over the Hoppy Cat archive: the garden is core, the rest is drawn.
const hoppy = packDefinition("hoppycat-archive");
const garden = "hoppycat-halfway-tea-garden";
const places = Object.keys(hoppy.places).filter((id) => id !== garden);
const residents = Object.entries(hoppy.avatars)
  .filter(([, a]) => a.place !== garden)
  .map(([id]) => id);
const things = Object.entries(hoppy.items)
  .filter(([, i]) => i.holder !== garden && hoppy.places[i.holder])
  .map(([id]) => id);
const pooled = (ids, rarity = "common") =>
  ids.map((id) => ({ id, rarity, anchor: garden }));
const specials = {
  draw: { places: 2, avatars: 1, items: 1 },
  pool: [
    ...places.map((id, i) => ({ id, rarity: i ? "common" : "rare" })),
    ...pooled(residents),
    ...pooled(things),
  ],
};
const pack = { ...hoppy, specials };

describe("seeded specials", () => {
  it("draws the same specials for a seed, and different ones across seeds", () => {
    const draws = new Set();
    for (let seed = 0; seed < 1000; seed++) {
      const drawn = drawSpecials(pack, seed);
      expect(drawSpecials(pack, seed)).toEqual(drawn);
      expect(drawn).toHaveLength(4);
      expect(new Set(drawn).size).toBe(4);
      const [a, b, avatar, item] = drawn;
      expect([a, b].every((id) => hoppy.places[id])).toBe(true);
      // A drawn place brings its own residents and things.
      expect([a, b]).not.toContain(hoppy.avatars[avatar].place);
      expect([a, b]).not.toContain(hoppy.items[item].holder);
      draws.add(drawn.join());
    }
    expect(draws.size).toBeGreaterThan(500);
  });

  it("weights each slot by card tier, and none can keep a slot empty", () => {
    const counts = {};
    const pool = [
      { id: places[0], rarity: "rare" },
      { id: places[1], rarity: "legendary" },
      { id: places[2], rarity: "common" },
      { none: true, rarity: "common" },
    ];
    const one = { ...pack, specials: { draw: { places: 1 }, pool } };
    for (let seed = 0; seed < 4000; seed++) {
      const id = drawSpecials(one, seed)[0] ?? "none";
      counts[id] = (counts[id] || 0) + 1;
    }
    // Legendary is earned, never drawn; rare has a quarter of common's weight.
    expect(counts[places[1]]).toBeUndefined();
    expect(counts.none).toBeGreaterThan(1000);
    expect(counts[places[0]] / counts[places[2]]).toBeGreaterThan(0.15);
    expect(counts[places[0]] / counts[places[2]]).toBeLessThan(0.4);
    expect(RARITY_WEIGHTS).toMatchObject({ common: 8, rare: 2, legendary: 0 });
  });

  it("shows only drawn entries and what a drawn place brings", () => {
    const [a, b, avatar, item] = drawSpecials(pack, 7);
    const state = { specials: [a, b, avatar, item] };
    const brought = Object.keys(hoppy.avatars).filter(
      (id) => hoppy.avatars[id].place === a,
    );
    for (const id of [a, b, avatar, item, garden, ...brought])
      expect(specialsAllow(state, pack, id)).toBe(true);
    const hidden = places.find((id) => ![a, b].includes(id));
    expect(specialsAllow(state, pack, hidden)).toBe(false);
    expect(specialsAllow({}, pack, a)).toBe(false);
  });

  it("validates the pool", () => {
    const mounted = packDefinitions.flatMap((p) => Object.keys(p.places));
    const problems = (s) =>
      packProblems({ ...hoppy, routes: [], specials: s }, hub, mounted).filter((p) =>
        p.startsWith("specials"),
      );
    expect(problems(specials)).toEqual([]);
    // The entry stays core, tiers are card tiers, and the human cast is never pooled.
    for (const [id, rarity] of [
      [garden, "common"],
      [places[0], "free"],
      ["vale", "common"],
    ])
      expect(problems({ ...specials, pool: [{ id, rarity }] })).toHaveLength(1);
  });

  it("keeps a world's run seed in its save", () => {
    const world = createWorld({ seed: 42 });
    expect(world.run).toEqual({ seed: 42 });
    expect(decodeSave(encodeSave(world)).run).toEqual({ seed: 42 });
    expect(() => createWorld({ seed: -1 })).toThrow();
    expect(() =>
      decodeSave(JSON.stringify({ ...world, run: { seed: 1.5 } })),
    ).toThrow();
  });
});

// The shared engine, built from these rule modules, reading content with the
// test pool mounted, as the Rust host supplies it.
async function sharedEngine() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["v2/card-game/shared-world-entry.mjs"],
    bundle: true,
    write: false,
    platform: "neutral",
    format: "iife",
    target: "es2022",
    plugins: [sharedContentInput(root)],
  });
  const file = "../v2/orchestrator-rust/src/card_shared/content.json";
  const content = JSON.parse(readFileSync(new URL(file, import.meta.url)));
  const packs = content.files["v2/card-game/packs.json"];
  packs.packs = packs.packs.map((p) =>
    p.id === hoppy.id ? { ...p, specials } : p,
  );
  const context = vm.createContext({ cardContent: content });
  vm.runInContext(result.outputFiles[0].text, context);
  return (request) => JSON.parse(context.cardShared(JSON.stringify(request)));
}

describe("specials in the shared engine", () => {
  it("draws once at create from the host's seed, as the browser rule does", async () => {
    const engine = await sharedEngine();
    for (const seed of [0, 1, 99, 4294967295]) {
      const created = engine({ op: "create", seed });
      expect(created.error).toBeUndefined();
      expect(created.world.run).toEqual({ seed });
      expect(created.world.packs[hoppy.id].specials).toEqual(
        drawSpecials(pack, seed),
      );
    }
  });

  it("gives an older world its seed once on upgrade, and never draws again", async () => {
    const engine = await sharedEngine();
    const created = engine({ op: "create" }).world;
    expect(created.run).toBeUndefined();
    expect(created.packs[hoppy.id].specials).toBeUndefined();
    const who = { op: "upgrade", actor: "vale", claimed: ["vale"] };
    const upgraded = engine({ ...who, world: created, seed: 5 }).world;
    expect(upgraded.packs[hoppy.id].specials).toEqual(drawSpecials(pack, 5));
    // A recorded draw is kept as saved; a later seed changes nothing.
    const recorded = structuredClone(upgraded);
    recorded.packs[hoppy.id].specials = [places[3]];
    const again = engine({ ...who, world: recorded, seed: 6 }).world;
    expect(again.run).toEqual({ seed: 5 });
    expect(again.packs[hoppy.id].specials).toEqual([places[3]]);
  });
});
