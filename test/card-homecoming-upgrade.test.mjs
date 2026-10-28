import hoppycat from "../v2/content/hoppycat-archive/card-world.json" with { type: "json" };
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { decodeSave, encodeSave } from "../v2/card-game/world.mjs";
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
    "keeps a released v11 %s journey and adds the household witness and BoardyAI",
    (scope) => {
      const before = oldWorld(scope);
      expect(before.packs["greek-drama"].revision).toBe(3);
      expect(before.actors[witness]).toBeUndefined();
      const after = decodeSave(JSON.stringify(before));
      expect(after.packs["greek-drama"]).toEqual({
        ...before.packs["greek-drama"],
        revision: 5,
      });
      expect(Object.keys(after.actors).length).toBe(
        Object.keys(before.actors).length +
          2 +
          Object.keys(hoppycat.avatars).length,
      );
      expect(after.items).toEqual({
        ...before.items,
        "boardyai-calling-card": { holder: "station", history: [] },
        ...Object.fromEntries(
          Object.entries(hoppycat.items).map(([id, item]) => [
            id,
            { holder: item.holder, history: [] },
          ]),
        ),
      });
      for (const key of ["turn", "revision", "eventSeq", "log", "transports"])
        expect(after[key]).toEqual(before[key]);
      expect(after.crossings).toMatchObject(before.crossings);
      for (const [id, actor] of Object.entries(before.actors))
        expect(after.actors[id]).toEqual({
          ...actor,
          trust: {
            ...actor.trust,
            [witness]: 0,
            boardyai: 0,
            ...Object.fromEntries(
              Object.keys(hoppycat.avatars).map((id) => [id, 0]),
            ),
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
