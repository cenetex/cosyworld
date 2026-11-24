import { describe, expect, it } from "vitest";
import { decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { hub, packDefinition } from "../v2/card-game/pack-registry.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import { funeralJourney } from "./helpers/greek-funeral.mjs";

const BOOKS = {
  "greek-theban-chronicle": "greek-elder",
  "greek-city-roll": "greek-elder",
  "greek-songbook": "greek-elder",
  "greek-guide": "vale",
  "greek-cargo-list": "greek-shipmaster",
};
const greek = (s) => s.packs["greek-drama"];
function asBefore(world) {
  const s = structuredClone(world);
  for (const [id, holder] of Object.entries(BOOKS)) {
    s.items[id] = { holder, history: [] };
    s.memories[id] = structuredClone(s.memories["greek-shovel"]);
  }
  s.items["greek-guide"].history = ["Turn 2: Vale takes it."];
  s.log.push({ ...s.log.at(-1), seq: s.eventSeq + 1, itemId: "greek-guide" });
  s.eventSeq += 1;
  greek(s).revision = 32;
  return s;
}

describe("the five Greek prose books", () => {
  it("are gone from the pack, and the schema takes no lore", () => {
    const pack = structuredClone(packDefinition("greek-drama"));
    for (const id of Object.keys(BOOKS)) expect(pack.items[id]).toBeUndefined();
    expect(pack.release.items.filter((id) => BOOKS[id])).toEqual([]);
    pack.items["greek-shovel"].lore = [{ text: "A page." }];
    expect(packProblems(pack, hub).join("\n")).toContain("item greek-shovel is invalid");
  });

  it("leave a rules 194 world that held them, locally and shared", () => {
    const buried = funeralJourney().buried;
    const shared = dispatchShared({ op: "create", save: encodeSave(buried) });
    for (const world of [
      decodeSave(JSON.stringify(asBefore(buried))),
      dispatchShared({
        op: "upgrade",
        from: "full-card-world/194",
        world: asBefore(shared.world),
      }).world,
    ]) {
      for (const id of Object.keys(BOOKS)) {
        expect(world.items[id]).toBeUndefined();
        expect(world.memories[id]).toBeUndefined();
      }
      expect(world.log.some((e) => BOOKS[e.itemId])).toBe(false);
      expect(greek(world).revision).toBe(packDefinition("greek-drama").revision);
      expect(greek(world).receipts).toEqual(greek(buried).receipts);
      expect(world.knowledge.facts).toEqual(buried.knowledge.facts);
      expect(decodeSave(encodeSave(world))).toEqual(world);
    }
  });
});
