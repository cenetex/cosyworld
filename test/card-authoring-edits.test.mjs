import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  sourceEdit,
  applySourceEdit,
  moveCard,
  linkPlaces,
  setStarterQuest,
  setStartingPlace,
} from "../v2/card-game/authoring-edits.mjs";
const read = (path) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const source = {
  pack: read("../v2/content/greek-drama/card-world.json"),
  bridge: read("../v2/worlds/greek-drama/card-bridge.json"),
};
const small = () => ({
  pack: {
    places: { a: { name: "A", exits: [] }, b: { name: "B", exits: [] } },
    avatars: { vale: { name: "Vale", place: "a", home: "a", future: [1] } },
    items: {
      oil: { name: "Oil", holder: "a", home: "a", future: { yes: true } },
    },
  },
  bridge: {},
});
describe("atomic authoring edits", () => {
  it("edits one parallel gate clause and restores the exact source with Undo", () => {
    const original = JSON.stringify(source);
    const index = source.pack.routes.findIndex((r) => r.sealed);
    const path = ["pack", "routes", index, "sealed", "reason"];
    const edit = sourceEdit(source, "Change gate hint", [
      { path, value: "Bring the burial account." },
    ]);
    const result = applySourceEdit(source, edit);
    assert.equal(JSON.stringify(source), original);
    assert.equal(
      result.source.pack.routes[index].sealed.reason,
      "Bring the burial account.",
    );
    result.source.pack.routes.forEach((r, i) => {
      if (i !== index) assert.deepEqual(r, source.pack.routes[i]);
    });
    assert.equal(
      JSON.stringify(applySourceEdit(result.source, result.undo).source),
      original,
    );
    assert.throws(() => applySourceEdit(result.source, edit), /changed/);
  });
  it("rejects a stale second patch without applying the first", () => {
    const data = small();
    const edit = linkPlaces(data, "a", "b");
    const changed = structuredClone(data);
    changed.pack.places.b.exits = ["a"];
    const before = JSON.stringify(changed);
    assert.throws(() => applySourceEdit(changed, edit), /changed/);
    assert.equal(JSON.stringify(changed), before);
    const result = applySourceEdit(data, edit);
    assert.deepEqual(result.source.pack.places.a.exits, ["b"]);
    assert.deepEqual(result.source.pack.places.b.exits, ["a"]);
    assert.deepEqual(applySourceEdit(result.source, result.undo).source, data);
  });
  it("preserves custody rules and opaque author fields during a move", () => {
    const data = small();
    const result = applySourceEdit(
      data,
      moveCard(data, "items", "oil", "vale"),
    );
    assert.deepEqual(result.source.pack.items.oil, {
      ...data.pack.items.oil,
      holder: "vale",
    });
    assert.equal(data.pack.items.oil.holder, "a");
    data.pack.items.oil.regrow = "dawn";
    assert.throws(() => moveCard(data, "items", "oil", "vale"), /location/);
    assert.doesNotThrow(() => moveCard(data, "items", "oil", "b"));
    assert.throws(() => moveCard(data, "avatars", "vale", "vale"));
  });
  it("keeps ship links and gated approaches in their own editors", () => {
    assert.throws(
      () => linkPlaces(source, "greek-ship", "greek-harbor"),
      /dock/,
    );
    const approach = source.pack.routes.find((route) => route.sealed);
    assert.throws(
      () => linkPlaces(source, approach.from, approach.to),
      /quest/,
    );
    assert.throws(() => linkPlaces(small(), "a", "a"));
  });
  it("keeps an existing funeral goal and its complete lay step", () => {
    const want = source.pack.avatars["greek-polynices-shade"].want;
    const edit = setStarterQuest(
      source,
      "greek-polynices-shade",
      want.kind,
      want.target,
    );
    assert.deepEqual(edit.changes, []);
    assert.deepEqual(applySourceEdit(source, edit).source, source);
  });
  it("keeps richer starter quests through replacement and Undo", () => {
    const data = small();
    data.pack.avatars.vale.want = {
      kind: "place",
      target: "b",
      step: { verb: "lay", items: ["oil"] },
    };
    const result = applySourceEdit(
      data,
      setStarterQuest(data, "vale", "item", "oil"),
    );
    assert.deepEqual(result.source.pack.avatars.vale.want, {
      kind: "item",
      target: "oil",
    });
    assert.deepEqual(applySourceEdit(result.source, result.undo).source, data);
  });
  it("restores removed fields and array entries in their original order", () => {
    for (const path of [
      ["pack", "avatars", "vale", "home"],
      ["pack", "avatars", "vale", "future", 0],
    ]) {
      const data = small(),
        before = JSON.stringify(data);
      const result = applySourceEdit(
        data,
        sourceEdit(data, "Remove", [{ path, remove: true }]),
      );
      assert.equal(
        JSON.stringify(applySourceEdit(result.source, result.undo).source),
        before,
      );
    }
  });
  it("keeps a deck launch separate from pack entry and first dock", () => {
    const result = applySourceEdit(
      source,
      setStartingPlace(source, "greek-ship"),
    );
    assert.deepEqual(result.source.launch, {
      schemaVersion: 1,
      place: "greek-ship",
    });
    assert.deepEqual(result.source.pack, source.pack);
    assert.deepEqual(result.source.bridge, source.bridge);
    assert.deepEqual(
      applySourceEdit(result.source, result.undo).source,
      source,
    );
  });
  it("rejects values that would change when saved as JSON", () => {
    for (const value of [
      undefined,
      NaN,
      Infinity,
      { value: undefined },
      [Infinity],
    ])
      assert.throws(() =>
        sourceEdit(small(), "Edit", [{ path: ["pack", "name"], value }]),
      );
  });
  it("rejects inherited and unsafe paths", () => {
    for (const path of [
      ["owner", "id"],
      ["pack", "__proto__", "bad"],
      ["pack", "places", "missing", "name"],
    ])
      assert.throws(() => sourceEdit(small(), "Edit", [{ path, value: 1 }]));
    assert.equal({}.bad, undefined);
  });
});
