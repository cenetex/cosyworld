import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildAuthoringTree } from "../v2/card-game/authoring-tree.mjs";
import {
  authoringField,
  authoringFieldEdit,
  authoringFieldHidden,
} from "../v2/card-game/authoring-fields.mjs";
import { applySourceEdit } from "../v2/card-game/authoring-edits.mjs";

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
      const paths = new Set(
        tree.cards.map((card) => JSON.stringify(card.source)),
      );
      for (const collection of ["places", "avatars", "items"])
        for (const [id, entity] of Object.entries(input.pack[collection] || {}))
          for (const key of Object.keys(entity)) {
            if (
              { places: "exits", avatars: "place", items: "holder" }[
                collection
              ] === key
            )
              continue;
            expect(
              paths.has(JSON.stringify(["pack", collection, id, key])),
            ).toBe(true);
          }
      for (const key of Object.keys(input.pack))
        if (!["places", "avatars", "items", "routes", "choices"].includes(key))
          expect(paths.has(JSON.stringify(["pack", key]))).toBe(true);
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
    expect(buildAuthoringTree({ pack: null }).cards).toHaveLength(2);
  });

  it("gives each place and avatar a quest box before its first quest", () => {
    const tree = buildAuthoringTree({
      pack: {
        places: { a: { exits: [] } },
        avatars: { person: { place: "a" } },
      },
    });
    for (const entity of tree.cards.filter((c) => c.role === "entity")) {
      const box = tree.cards.find(
        (c) => c.holder === entity.id && c.role === "quests",
      );
      expect(box).toMatchObject({
        name: "Quests",
        group: true,
        art: "assets/card-back-locked.webp",
      });
      expect(tree.children[box.id]).toEqual([]);
    }
    const greek = buildAuthoringTree(load("greek-drama"));
    const starter = at(greek, ["pack", "avatars", "greek-antigone", "want"]);
    expect(starter.name).toBe("Starting quest");
    expect(greek.cards.find((c) => c.id === starter.holder).role).toBe(
      "quests",
    );
    const road = at(greek, ["pack", "routes", 0]);
    const owner = greek.cards.find((c) => c.id === road.holder);
    expect(owner.role).toBe("quests");
    expect(owner.source).toEqual([
      "pack",
      "places",
      load("greek-drama").pack.routes[0].to,
    ]);
  });

  it("edits ordinary imported fields and restores every other authored value", () => {
    const input = freeze(load("badger-forest")),
      before = JSON.stringify(input);
    let source = input;
    const undo = [];
    for (const [path, text] of [
      [["pack", "name"], "My forest"],
      [["pack", "places", "clearing", "text"], "An open glade.\n雪"],
      [["pack", "avatars", "badger", "name"], "Bramble"],
      [
        ["pack", "avatars", "badger", "variants", "asleep", "portrait"],
        "images/rest.webp",
      ],
    ]) {
      const card = at(buildAuthoringTree(source), path);
      const field = authoringField(source, card);
      expect(field.editable).toBe(true);
      const expected = structuredClone(source);
      const parent = path
        .slice(0, -1)
        .reduce((value, key) => value[key], expected);
      parent[path.at(-1)] = text;
      const result = applySourceEdit(
        source,
        authoringFieldEdit(source, field, text),
      );
      expect(result.source).toEqual(expected);
      source = result.source;
      undo.push(result.undo);
    }
    for (const edit of undo.reverse())
      source = applySourceEdit(source, edit).source;
    expect(JSON.stringify(source)).toBe(before);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("keeps custom branches, identity fields and hidden generation paths intact", () => {
    const input = freeze({
      pack: {
        id: "my-world",
        namespace: "my-world",
        schemaVersion: 1,
        entry: "a",
        custom: { enabled: true, values: [0, null, "雪"] },
        places: {
          a: {
            name: "Yard",
            exits: [],
            generation: { systemPrompt: "Internal" },
          },
        },
        avatars: { person: { name: "Person", place: "a", home: "a" } },
        items: {
          lamp: { name: "Lamp", art: "images/lamp.webp", holder: "person" },
        },
      },
    });
    const tree = buildAuthoringTree(input);
    for (const key of ["id", "namespace", "schemaVersion"])
      expect(authoringField(input, at(tree, ["pack", key])).editable).toBe(
        false,
      );
    for (const path of [
      ["custom", "enabled"],
      ["custom", "values", 0],
      ["custom", "values", 2],
      ["items", "lamp", "art"],
    ])
      expect(authoringField(input, at(tree, ["pack", ...path])).editable).toBe(
        true,
      );
    const generated = tree.cards.filter((card) =>
      card.source.includes("generation"),
    );
    expect(generated).toHaveLength(2);
    expect(generated.every(authoringFieldHidden)).toBe(true);
    for (const path of [["entry"], ["avatars", "person", "home"]]) {
      const card = tree.cards.find(
        (card) =>
          JSON.stringify(card.source) === JSON.stringify(["pack", ...path]),
      );
      expect(card).toMatchObject({ kind: "link", canonicalId: "a" });
      expect(authoringField(input, card)).toBeNull();
    }
    expect(
      tree.cards.filter(
        (card) => card.source.join("/") === "pack/items/lamp/holder",
      ),
    ).toEqual([]);
    expect(new Set(tree.cards.map((card) => card.id)).size).toBe(
      tree.cards.length,
    );
  });
});
