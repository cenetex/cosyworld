import hoppycat from "../v2/content/hoppycat-archive/card-world.json" with { type: "json" };
import {
  packDefinition as currentPackDefinition,
  packDefinitions,
} from "../v2/card-game/pack-registry.mjs";
const willowsItems = Object.fromEntries(
  Object.entries(currentPackDefinition("willows").items).map(([id, item]) => [
    id,
    { holder: item.holder, history: [] },
  ]),
);
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import { emptyPoemReadings } from "../v2/card-game/poem-readings.mjs";
import { entityActive } from "../v2/card-game/pack-registry.mjs";

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
      const newActors = packDefinitions
        .flatMap((pack) => Object.keys(pack.avatars))
        .filter((id) => !before.actors[id]);
      const after = decodeSave(JSON.stringify(before));
      expect(after.packs["greek-drama"]).toEqual({
        ...before.packs["greek-drama"],
        revision: currentPackDefinition("greek-drama").revision,
        poemReadings: emptyPoemReadings(),
      });
      expect(Object.keys(after.actors).length).toBe(
        Object.keys(before.actors).length + newActors.length,
      );
      expect(after.items).toEqual({
        ...before.items,
        ...willowsItems,
        ...Object.fromEntries(
          Object.entries(currentPackDefinition("greek-drama").items)
            .filter(([id]) => !before.items[id])
            .map(([id, item]) => [id, { holder: item.holder, history: [] }]),
        ),
        "boardyai-calling-card": { holder: "pond", history: [] },
        ...Object.fromEntries(
          Object.entries(hoppycat.items).map(([id, item]) => [
            id,
            { holder: item.holder, history: [] },
          ]),
        ),
        "forest-story-button": { holder: "forest-cottage", history: [] },
        "forest-dewbright-button": { holder: "forest-garden", history: [] },
        "forest-watch-bell": { holder: "forest-garden", history: [] },
        "forest-wolfprint-charm": { holder: "forest-trail", history: [] },
      });
      for (const key of ["turn", "revision", "eventSeq", "log", "transports"])
        expect(after[key]).toEqual(before[key]);
      expect(after.crossings).toMatchObject(before.crossings);
      for (const [id, actor] of Object.entries(before.actors))
        expect(after.actors[id]).toEqual(actor);
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
        delete w.items["greek-return-list"];
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
