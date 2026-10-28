import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { upgradeShoreRouteSave } from "../v2/card-game/legacy-saves.mjs";
const releasedSource = readFileSync(new URL(
  "../v2/orchestrator-rust/src/card_shared/engine-v14.js", import.meta.url,
), "utf8");
function earlierPlay(place) {
  const runtime = vm.createContext({ structuredClone });
  vm.runInContext(releasedSource, runtime);
  const old = (request) => JSON.parse(runtime.cardShared(JSON.stringify(request)));
  let world = old({ op: "create" }).world;
  delete world.opening;
  world.actors.vale.place = world.actors.mara.place = place;
  world.actors["greek-rhapsode"].place = place;
  world.items.lamp.holder = "pond";
  world.items.lamp.lit = false;
  world.items.lamp.fuel = 0;
  const claimed = ["vale", "mara"];
  const request = (op, extra = {}) => ({ op, world, actor: "vale", claimed, present: claimed, ...extra });
  const action = old(request("view")).actions.find((a) => a.kind === "wait");
  expect(action).toBeTruthy();
  const accepted = old(request("play", { action }));
  expect(accepted.ok, accepted.error).toBe(true);
  world = accepted.world;
  return { world, request };
}
describe("earlier station route knowledge", () => {
  for (const place of ["attic", "station", "train", "boardyai-parlour"]) {
    it(`upgrades an accepted old14 play at ${place} through the pond`, () => {
      const { world, request } = earlierPlay(place);
      const moved = ["attic", "train", "boardyai-parlour"];
      const expectedOld = place === "station" ? moved.map((to) => [place, to]) : [[place, "station"]];
      for (const edge of expectedOld) expect(world.routeKnowledge["greek-rhapsode"]).toContainEqual(edge);
      const next = dispatchShared(request("upgrade", { from: "full-card-world/14", to: "full-card-world/17" })).world;
      for (const [from, to] of expectedOld) {
        expect(next.routeKnowledge["greek-rhapsode"]).not.toContainEqual([from, to]);
        expect(next.routeKnowledge["greek-rhapsode"]).toContainEqual([from, "pond"]);
        expect(next.routeKnowledge["greek-rhapsode"]).toContainEqual(["pond", to]);
      }
      expect(next.log).toEqual(world.log);
      expect(next.turn).toBe(world.turn);
      for (const [id, item] of Object.entries(world.items)) expect(next.items[id], id).toEqual(item);
      const before = structuredClone(next);
      upgradeShoreRouteSave(next);
      expect(next).toEqual(before);
    });
  }
  it("deduplicates shared steps and preserves unrelated knowledge and history", () => {
    const world = { routeKnowledge: { bard: [["station", "attic"], ["station", "train"], ["station", "pond"]] }, log: [{ text: "An earlier walk." }] };
    upgradeShoreRouteSave(world);
    expect(world.routeKnowledge.bard).toEqual([["station", "pond"], ["pond", "attic"], ["pond", "train"]]);
    expect(world.log).toEqual([{ text: "An earlier walk." }]);
    const unrelated = { routeKnowledge: { bard: [["station", "pond"], ["forest-garden", "forest-oak"]] }, log: [] };
    const before = structuredClone(unrelated);
    upgradeShoreRouteSave(unrelated);
    expect(unrelated).toEqual(before);
  });
});
