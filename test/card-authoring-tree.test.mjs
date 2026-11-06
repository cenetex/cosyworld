import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildAuthoringTree } from "../v2/card-game/authoring-tree.mjs";

const load = (name) => ({
  pack: JSON.parse(readFileSync(`v2/content/${name}/card-world.json`, "utf8")),
  bridge: JSON.parse(
    readFileSync(`v2/worlds/${name}/card-bridge.json`, "utf8"),
  ),
});
const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const at = (tree, source) =>
  tree.cards.find(
    (c) =>
      c.kind !== "link" && JSON.stringify(c.source) === JSON.stringify(source),
  );

describe("the authored world card tree", () => {
  it.each([
    "badger-forest",
    "greek-drama",
    "hoppycat-archive",
    "willows",
    "lonely-forest",
  ])(
    "indexes every entity and source record in %s without changing it",
    (name) => {
      const input = freeze(load(name)),
        before = JSON.stringify(input);
      const tree = buildAuthoringTree(input),
        ids = tree.cards.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.every((id) => /^[a-z0-9-]+$/u.test(id))).toBe(true);
      const reached = new Set();
      const walk = (id) => {
        expect(reached.has(id)).toBe(false);
        reached.add(id);
        tree.children[id].forEach(walk);
      };
      tree.roots.forEach(walk);
      expect(reached.size).toBe(ids.length);
      for (const collection of ["places", "avatars", "items"])
        for (const id of Object.keys(input.pack[collection] || {}))
          expect(at(tree, ["pack", collection, id])?.canonicalId).toBe(id);
      for (const card of tree.cards) {
        const source = card.source.reduce((v, key) => v[key], input);
        expect(source).toBeDefined();
        if (Object.hasOwn(card, "value")) expect(card.value).toEqual(source);
        if (card.ref) expect(ids).toContain(card.ref);
      }
      expect(JSON.stringify(input)).toBe(before);
      expect(buildAuthoringTree(input)).toEqual(tree);
    },
  );

  it("keeps route alternatives and their shared destination distinct", () => {
    const tree = buildAuthoringTree(load("greek-drama"));
    const links = tree.cards.filter(
      (c) =>
        c.kind === "link" &&
        c.source[1] === "routes" &&
        c.source.at(-1) === "to" &&
        c.canonicalId === "greek-cithaeron",
    );
    expect(links.length).toBeGreaterThanOrEqual(3);
    expect(new Set(links.map((c) => c.id)).size).toBe(links.length);
    expect(new Set(links.map((c) => c.ref)).size).toBe(1);
  });

  it("keeps funeral effects and ship lane conditions in their source order", () => {
    const input = load("greek-drama"),
      tree = buildAuthoringTree(input);
    const i = input.pack.choices.findIndex(
      (c) => c.id === "greek-anoint-polynices",
    );
    const effects = at(tree, ["pack", "choices", i, "effects"]);
    expect(
      tree.children[effects.id].map((id) =>
        tree.cards.find((c) => c.id === id).source.at(-1),
      ),
    ).toEqual([0, 1]);
    const lane = at(tree, [
      "bridge",
      "transports",
      "greek-ship",
      "lanes",
      1,
      "opensWith",
    ]);
    expect(lane.art).toBe("assets/card-back-locked.webp");
    const ports = tree.cards.filter(
      (c) =>
        c.source[0] === "bridge" &&
        c.source.includes("docks") &&
        c.kind === "link",
    );
    expect(ports.map((c) => c.canonicalId)).toEqual(
      input.bridge.transports["greek-ship"].docks,
    );
  });

  it("keeps external holders and unfinished worlds reachable", () => {
    const tree = buildAuthoringTree({
      pack: {
        items: { 'item"[雪]': { name: "Gift", holder: "vale" } },
      },
    });
    const item = tree.cards.find((c) => c.kind === "item");
    expect(tree.cards.find((c) => c.id === item.holder).name).toBe("Elsewhere");
    expect(tree.cards.find((c) => c.holder === item.id)).toMatchObject({
      kind: "link",
      canonicalId: "vale",
      ref: null,
    });
    expect(buildAuthoringTree({ pack: null }).cards).toHaveLength(1);
  });
});
