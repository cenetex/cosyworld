import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { decodeSave, encodeSave, exits } from "../v2/card-game/world.mjs";
import {
  entityActive,
  packDefinition,
} from "../v2/card-game/pack-registry.mjs";

const context = vm.createContext({});
vm.runInContext(
  readFileSync(
    new URL(
      "../v2/orchestrator-rust/src/card_shared/engine-v9.js",
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
const oldWorld = (scope) => {
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
    (choice) => choice.choiceId === "greek-return-water-jar",
  );
  expect(action).toBeTruthy();
  world = released({ ...request, op: "play", action }).world;
  if (scope === "full") world.actors.vale.place = "greek-athens";
  return world;
};

describe("Greek section save upgrade", () => {
  it.each(["opening", "full"])(
    "preserves a real version-9 %s world",
    (scope) => {
      const before = oldWorld(scope);
      expect(before.packs["greek-drama"].revision).toBe(2);
      const after = decodeSave(JSON.stringify(before));
      expect(after.packs["greek-drama"].revision).toBe(5);
      expect(after.packs["greek-drama"]).toEqual({
        ...before.packs["greek-drama"],
        revision: 5,
      });
      for (const field of [
        "turn",
        "revision",
        "eventSeq",
        "log",
        "transports",
              ])
        expect(after[field]).toEqual(before[field]);
      for (const [id, actor] of Object.entries(before.actors)) {
        expect(after.actors[id]).toMatchObject(actor);
        for (const other of Object.keys(after.actors).filter(
          (key) => !before.actors[key],
        ))
          expect(after.actors[id].trust[other]).toBe(0);
      }
      for (const field of ["items", "memories", "peaceUntil"])
        for (const [id, value] of Object.entries(before[field]))
          expect(after[field][id]).toEqual(value);
      const pack = packDefinition("greek-drama");
      for (const [id, actor] of Object.entries(pack.avatars).filter(
        ([key]) => !before.actors[key],
      ))
        expect(after.actors[id]).toMatchObject({
          place: actor.place,
          crossed: 0,
          lastTalk: -9,
        });
      for (const [id, item] of Object.entries(pack.items).filter(
        ([key]) => !before.items[key],
      ))
        expect(after.items[id]).toEqual({ holder: item.holder, history: [] });
      expect(
        exits(after, "greek-harbor", "vale").includes("greek-athens"),
      ).toBe(scope === "full");
      expect(entityActive(after, "greek-egypt-tomb")).toBe(false);
      expect(entityActive(after, "greek-mycenae-palace")).toBe(false);
      expect(decodeSave(encodeSave(after))).toEqual(after);
    },
  );

  it("keeps incomplete original records invalid and checks the declared revision", () => {
    for (const change of [
      (world) => delete world.actors["greek-antigone"],
      (world) => delete world.items["greek-water-jar"],
      (world) => delete world.memories.vale,
      (world) => delete world.actors.vale.trust.moth,
      (world) => (world.packs["greek-drama"].revision = 3),
      (world) =>
        (world.items["greek-burial-petition"] = {
          holder: "vale",
          history: [],
        }),
    ]) {
      const before = oldWorld("opening");
      change(before);
      expect(() => decodeSave(JSON.stringify(before))).toThrow();
    }
  });
});
