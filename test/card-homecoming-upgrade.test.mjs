import hoppycat from "../v2/content/hoppycat-archive/card-world.json" with { type: "json" };
import { packDefinition as currentPackDefinition } from "../v2/card-game/pack-registry.mjs";
const willowsItems = Object.fromEntries(
  Object.entries(currentPackDefinition("willows").items).map(([id, item]) => [
    id,
    { holder: item.holder, history: [] },
  ]),
);
const ajaxItems = Object.fromEntries(
  Object.entries(currentPackDefinition("greek-drama").items)
    .filter(([id]) => id.startsWith("greek-ajax-"))
    .map(([id, item]) => [id, { holder: item.holder, history: [] }]),
);
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import { entityActive } from "../v2/card-game/pack-registry.mjs";
import { branchItems, upgradedActor, upgradedItems } from "./fixtures/card-upgraded-items.mjs";

const context = vm.createContext({});
vm.runInContext(
  readFileSync(
    new URL(
      "../v2/orchestrator-rust/src/card_shared/engine-v11.js",
      import.meta.url,
    ),
    "utf8",
  ),
  context,
);
const released = (request) => {
  const result = JSON.parse(context.cardShared(JSON.stringify(request)));
  expect(result.ok, result.error).toBe(true);
  return result;
};
const witness = "greek-household-witness";
function oldWorld(scope) {
  let world = released({ op: "create" }).world;
  delete world.opening;
  world.packs["greek-drama"].scope = scope;
  world.actors.vale.place = "greek-courtyard";
  world.items["greek-water-jar"].holder = "vale";
  const request = {
    world,
    actor: "vale",
    claimed: ["vale"],
    present: ["vale"],
  };
  const action = released({ ...request, op: "view" }).actions.find(
    (a) => a.choiceId === "greek-return-water-jar",
  );
  world = released({ ...request, op: "play", action }).world;
  return world;
}

describe("the household save upgrade", () => {
  it.each(["opening", "full"])(
    "keeps a released v11 %s journey and adds the household witness, BoardyAI, and forest cast",
    (scope) => {
      const before = oldWorld(scope);
      expect(before.packs["greek-drama"].revision).toBe(3);
      expect(before.actors[witness]).toBeUndefined();
      const after = decodeSave(JSON.stringify(before));
      expect(after.packs["greek-drama"]).toEqual({
        ...before.packs["greek-drama"],
        revision: currentPackDefinition("greek-drama").revision,
      });
      expect(Object.keys(after.actors).length).toBe(
        Object.keys(before.actors).length +
          10 +
          Object.keys(hoppycat.avatars).length,
      );
      expect(after.items).toEqual({
        ...upgradedItems(before.items),
        ...branchItems,
        ...willowsItems,
        ...ajaxItems,
        "boardyai-calling-card": { holder: "station", history: [] },
        ...Object.fromEntries(
          Object.entries(hoppycat.items).map(([id, item]) => [
            id,
            { holder: item.holder, history: [] },
          ]),
        ),
        ...Object.fromEntries(
          Object.entries(currentPackDefinition("lonely-forest").items).map(([id, item]) => [
            id,
            { holder: item.holder, history: [] },
          ]),
        ),
      });
      // The version 2 ship keeps its dock as a version 3 record.
      expect(after.transports["greek-ship"]).toMatchObject({
        version: 3,
        dock: before.transports["greek-ship"].dock,
      });
      for (const key of ["turn", "revision", "eventSeq", "log"])
        expect(after[key]).toEqual(before[key]);
      expect(after.crossings).toMatchObject(before.crossings);
      // Quest progress is dropped; each avatar gains its want record.
      const lived = ({ want, xp, visited, talked, metTurn, gaveUp, ...a }) => a;
      for (const [id, { progress, ...actor }] of Object.entries(before.actors))
        expect(lived(after.actors[id])).toEqual({
          ...upgradedActor(actor),
          trust: {
            ...actor.trust,
            [witness]: 0,
            boardyai: 0,
            ...Object.fromEntries(
              Object.keys(hoppycat.avatars).map((id) => [id, 0]),
            ),
            "willows-swede": 0,
            rati: 0,
            skull: 0,
            whiskerwind: 0,
            oak: 0,
            "greek-ajax-tecmessa": 0,
            "greek-ajax-teucer": 0,
            "greek-ajax-odysseus": 0,
          },
        });
      for (const [id, memory] of Object.entries(before.memories))
        expect(after.memories[id]).toMatchObject(memory);
      for (const [id, peace] of Object.entries(before.peaceUntil))
        expect(after.peaceUntil[id]).toEqual(peace);
      expect(after.actors[witness]).toMatchObject({
        place: "greek-eleusis",
        crossed: 0,
        lastTalk: -9,
      });
      expect(
        Object.values(after.actors[witness].trust).every((n) => n === 0),
      ).toBe(true);
      expect(entityActive(after, witness)).toBe(false);
      expect(decodeSave(encodeSave(after))).toEqual(after);
    },
  );

  it("checks the declared old records before installing the new resident", () => {
    for (const change of [
      (w) => {
        delete w.actors["greek-aethra"];
      },
      (w) => {
        w.actors[witness] = structuredClone(w.actors["greek-aethra"]);
      },
      (w) => {
        w.actors.vale.trust[witness] = 7;
      },
      (w) => {
        w.packs["greek-drama"].revision = 4;
      },
    ]) {
      const world = oldWorld("opening");
      change(world);
      expect(() => decodeSave(JSON.stringify(world))).toThrow();
    }
  });
});
