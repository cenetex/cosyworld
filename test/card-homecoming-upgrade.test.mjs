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
    // Rules 95 brought figs, a wine skin and libation wine too.
    .filter(
      ([id]) =>
        id.startsWith("greek-ajax-") ||
        ["greek-figs", "greek-wine-skin", "greek-libation"].includes(id),
    )
    .map(([id, item]) => [id, { holder: item.holder, history: [] }]),
);
// Greek revision 20: Creon holds his writ, and Dione her wheat, when an
// earlier world first gains them.
const decreeItems = Object.fromEntries(
  ["greek-creon-writ", "greek-wheat"].map((id) => [
    id,
    {
      holder: currentPackDefinition("greek-drama").items[id].holder,
      history: [],
    },
  ]),
);
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { createWorld, decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import { entityActive } from "../v2/card-game/pack-registry.mjs";
import {
  branchItems,
  upgradedActor,
  upgradedItems,
  withoutHomeDoors,
} from "./fixtures/card-upgraded-items.mjs";

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
