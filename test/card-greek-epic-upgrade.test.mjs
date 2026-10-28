import { describe, expect, it } from "vitest";
import { decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { greekRevisionSeven } from "../v2/card-game/legacy-greek-catalog.mjs";
import { releasedCardEngine } from "./helpers/released-card-engine.mjs";

const oldEngine = releasedCardEngine(20);
const oldWorld = () => oldEngine.dispatch({ op: "create" }).world;
const greek = () => packDefinition("greek-drama");

describe("one Greek revision7 to8 catalog upgrade", () => {
  it("matches the complete published rules20 entity catalog", () => {
    const published = oldEngine.packs.find((pack) => pack.id === "greek-drama");
    expect(greekRevisionSeven).toEqual(
      Object.fromEntries(
        ["avatars", "items", "places"].map((key) => [
          key,
          Object.keys(published[key]),
        ]),
      ),
    );
  });
  it("adds every current new ID while preserving the published records", () => {
    const before = oldWorld();
    const after = decodeSave(JSON.stringify(before));
    expect(after.packs["greek-drama"].revision).toBe(8);
    for (const [id, value] of Object.entries(before.items))
      expect(after.items[id]).toEqual(value);
    for (const id of Object.values(greekRevisionSeven).flat())
      expect(after.memories[id]).toEqual(before.memories[id]);
    for (const id of greekRevisionSeven.avatars) {
      const { trust: oldTrust, ...oldRecord } = before.actors[id];
      const { trust: newTrust, ...newRecord } = after.actors[id];
      expect(newRecord).toEqual(oldRecord);
      for (const [other, value] of Object.entries(oldTrust))
        expect(newTrust[other]).toBe(value);
    }
    const oldActors = new Set(greekRevisionSeven.avatars);
    const oldItems = new Set(greekRevisionSeven.items);
    const oldPlaces = new Set(greekRevisionSeven.places);
    for (const [id, actor] of Object.entries(greek().avatars))
      if (!oldActors.has(id)) {
        expect(after.actors[id].place).toBe(actor.place);
        expect(after.memories[id]).toBeDefined();
        expect(after.peaceUntil[id]).toBe(0);
        for (const other of Object.keys(after.actors))
          if (other !== id) expect(after.actors[other].trust[id]).toBeDefined();
      }
    for (const [id, item] of Object.entries(greek().items))
      if (!oldItems.has(id)) {
        expect(after.items[id]).toEqual({ holder: item.holder, history: [] });
        expect(after.memories[id]).toBeDefined();
      }
    for (const id of Object.keys(greek().places))
      if (!oldPlaces.has(id)) expect(after.memories[id]).toBeDefined();
    expect(after.packs["greek-drama"].receipts).toEqual(
      before.packs["greek-drama"].receipts,
    );
    expect(decodeSave(encodeSave(after))).toEqual(after);
  });
  it.each([
    ["actors", "greek-ajax-teucer"],
    ["items", "greek-water-jar"],
  ])("requires the original %s record for %s", (collection, id) => {
    const before = oldWorld();
    delete before[collection][id];
    expect(() => decodeSave(JSON.stringify(before))).toThrow(
      "original entity records",
    );
  });
  it("carries the known eastern road through the new camp", () => {
    const before = oldWorld();
    before.routeKnowledge.vale = [
      ["greek-susa", "greek-scythian-crag"],
      ["greek-scythian-crag", "greek-susa"],
    ];
    const after = decodeSave(JSON.stringify(before));
    expect(after.routeKnowledge.vale).toContainEqual([
      "greek-susa",
      "greek-vii-crag-camp",
    ]);
    expect(after.routeKnowledge.vale).toContainEqual([
      "greek-vii-crag-camp",
      "greek-scythian-crag",
    ]);
    expect(after.routeKnowledge.vale).toContainEqual([
      "greek-scythian-crag",
      "greek-vii-crag-camp",
    ]);
    expect(after.routeKnowledge.vale).toContainEqual([
      "greek-vii-crag-camp",
      "greek-susa",
    ]);
    expect(after.routeKnowledge.vale).not.toContainEqual([
      "greek-susa",
      "greek-scythian-crag",
    ]);
  });
});
