import { expect, test } from "vitest";
import { createPipWorld } from "../v2/card-game/pip-landing.mjs";
import { summonTransport } from "../v2/card-game/pack-transport.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { newWant } from "../v2/card-game/want.mjs";
import { decodeSave, legalActions, play } from "../v2/card-game/world.mjs";

const lantern = "station-lantern", wick = "station-lantern-wick";
const crossing = "pond-greek-harbor", ship = "greek-ship";
const portableClaim = "claim:hub:keeper-log:pond-signal";
const retiredClaim = "claim:hub:keeper-log:station-signal";

function oldStation() {
  const s = createPipWorld(17);
  s.actors.vale.place = "station";
  s.actors.vale.visited.push("station");
  const read = legalActions(s).find((a) => a.kind === "read" && a.item === "keeper-log");
  const readResult = play(s, read);
  expect(readResult.ok, readResult.error).toBe(true);
  const state = readResult.state;
  const portable = state.knowledge.facts[portableClaim];
  state.knowledge.facts[retiredClaim] = {
    ...portable,
    id: retiredClaim,
    text: "Repair and light the Station lantern to call the ship.",
    source: { ...portable.source, claim: "station-signal", about: "station" },
  };
  state.knowledge.known.vale[retiredClaim] = { ...state.knowledge.known.vale[portableClaim] };
  state.items[lantern] = { holder: "station", repaired: false, lit: false, fuel: 0, history: [] };
  state.items[wick] = { holder: "vale", history: [] };
  return state;
}

test("a carried retired wick, its want and its clue leave old saves", () => {
  const old = oldStation();
  old.actors.vale.heldItem = wick;
  old.actors.vale.want = newWant("item", wick, old.turn);

  const s = decodeSave(JSON.stringify(old));
  expect(s.items[lantern]).toBeUndefined();
  expect(s.items[wick]).toBeUndefined();
  expect(s.actors.vale.heldItem).not.toBe(wick);
  expect(s.actors.vale.want).toBeNull();
  expect(s.items.lamp).toEqual(old.items.lamp);
  expect(s.crossings[crossing]).toEqual({ discovered: false });
  expect(s.knowledge.facts[retiredClaim]).toBeUndefined();
  expect(s.knowledge.known.vale[retiredClaim]).toBeUndefined();
  expect(s.knowledge.facts[portableClaim]).toEqual(old.knowledge.facts[portableClaim]);
  expect(s.knowledge.known.vale["quest:keeper:pond"]).toBeDefined();
});

test("a retired station signal keeps the ship and Keeper's credit in an upgraded shared world", () => {
  const old = oldStation();
  old.sharedVersion = 1;
  old.items[lantern] = { ...old.items[lantern], repaired: true, lit: true, fuel: 1 };
  old.items[wick].holder = "pond";
  old.usedUp.push(wick);
  old.crossings[crossing] = { discovered: true, method: lantern };
  summonTransport(old, ship, "pond");
  const credit = { by: "vale", turn: old.turn, want: old.actors.keeper.want };
  old.actors.keeper.completedQuest = credit;
  old.actors.keeper.want = null;

  const s = dispatchShared({ op: "upgrade", world: old, seed: 17 }).world;
  expect(s.crossings[crossing]).toEqual({ discovered: true });
  expect(s.transports[ship]).toEqual(old.transports[ship]);
  expect(s.actors.keeper.completedQuest).toEqual(credit);
  expect(s.items[lantern]).toBeUndefined();
  expect(s.usedUp).not.toContain(wick);
});
