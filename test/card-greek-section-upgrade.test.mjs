import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import {
  entityActive,
  packDefinition,
} from "../v2/card-game/pack-registry.mjs";
import { upgradedActor, upgradedItems } from "./fixtures/card-upgraded-items.mjs";

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
      expect(after.packs["greek-drama"].revision).toBe(
        packDefinition("greek-drama").revision,
      );
      expect(after.packs["greek-drama"]).toEqual({
        ...before.packs["greek-drama"],
        revision: packDefinition("greek-drama").revision,
      });
      // The version 2 ship keeps its dock as a version 3 record.
      expect(after.transports["greek-ship"]).toMatchObject({
        version: 3,
        dock: before.transports["greek-ship"].dock,
      });
      for (const field of ["turn", "revision", "eventSeq", "log"])
        expect(after[field]).toEqual(before[field]);
      expect(after.crossings).toEqual({
        ...before.crossings,
        "greek-ship-willows-landing": { discovered: false },
        "willows-landing-greek-ship": { discovered: false },
        "willows-landing-pond": { discovered: false },
        "pond-willows-landing": { discovered: false },
        "station-boardyai-parlour": { discovered: false },
        "boardyai-parlour-station": { discovered: false },
        "greek-athens-harbor-ship": { discovered: false },
        "greek-piraeus-ship": { discovered: false },
        "greek-ajax-landing-ship": { discovered: false },
        "hoppycat-signal-jetty-ship": { discovered: false },
        // Greek revision 16: the east sea's ports.
        ...Object.fromEntries(
          [
            "greek-marathon",
            "greek-lemnos",
            "greek-thrace",
            "greek-egypt-tomb",
            "greek-tauris",
            "greek-sicily",
          ].map((id) => [`${id}-ship`, { discovered: false }]),
        ),
        "hoppycat-pond-garden": { discovered: false },
        "hoppycat-garden-pond": { discovered: false },
        "attic-forest-cottage": { discovered: false },
        "forest-cottage-attic": { discovered: false },
      });
      for (const [id, { progress, ...actor }] of Object.entries(before.actors)) {
        // Quest progress is dropped; the rest of the avatar survives.
        expect(after.actors[id].progress).toBeUndefined();
        expect(after.actors[id]).toMatchObject(upgradedActor(actor));
        for (const other of Object.keys(after.actors).filter(
          (key) => !before.actors[key],
        ))
          expect(after.actors[id].trust[other]).toBe(0);
      }
      for (const field of ["items", "peaceUntil"])
        for (const [id, value] of Object.entries(
          field === "items" ? upgradedItems(before.items) : before[field],
        ))
          expect(after[field][id]).toEqual(value);
      for (const [id, memory] of Object.entries(before.memories)) {
        const { seen, ...retained } = after.memories[id];
        expect(retained).toEqual(memory);
        if (seen) expect(typeof seen).toBe("object");
      }
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
      expect(entityActive(after, "greek-athens-harbor")).toBe(false);
      expect(entityActive(after, "greek-thinkery")).toBe(scope === "full");
      expect(entityActive(after, "greek-egypt-tomb")).toBe(false);
      expect(entityActive(after, "greek-mycenae-palace")).toBe(false);
      expect(decodeSave(encodeSave(after))).toEqual(after);
    },
  );

  it("keeps incomplete original records invalid and checks the declared revision", () => {
    for (const change of [
      (world) => delete world.actors["greek-antigone"],
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
