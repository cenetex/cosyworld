import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { decodeSave } from "../v2/card-game/world.mjs";

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
