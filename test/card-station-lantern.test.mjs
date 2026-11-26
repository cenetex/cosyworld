import { expect, test } from "vitest";
import { cardActions } from "../v2/card-game/cards.mjs";
import { gone } from "../v2/card-game/item-use.mjs";
import { seatActors } from "../v2/card-game/human-cast.mjs";
import { fillLampFuel } from "../v2/card-game/lamp-state.mjs";
import { createPipWorld } from "../v2/card-game/pip-landing.mjs";
import { createWorld, decodeSave, encodeSave, legalActions, play, validateWorld } from "../v2/card-game/world.mjs";

const LANTERN = "station-lantern", WICK = "station-lantern-wick";
const CROSSING = "pond-greek-harbor";
const repair = (state, actor = "vale") => act(state, "Repair lantern", actor);
const light = (state, actor = "vale") => act(state, "Light lantern", actor);
const read = (state, label, actor) => legalActions(state, actor).find((action) => action.label === label);

function act(state, label, actor) {
  const action = read(state, label, actor);
  expect(action, label).toBeTruthy();
  const result = play(state, action, state.revision, actor);
  expect(result.ok, result.error).toBe(true);
  return result.state;
}

function atStation(wickHolder = "vale") {
  const state = createPipWorld(17);
  state.actors.vale.place = "station";
  state.actors.vale.visited.push("station");
  state.items[WICK].holder = wickHolder;
  return state;
}

test("the station can be repaired by the wick's carrier and only a separate Light calls", () => {
  let state = atStation("pond");
  expect(read(state, "Repair lantern", "vale")).toBeUndefined();
  expect(read(state, "Light lantern", "vale")).toBeUndefined();
  expect(legalActions(state).find((a) => a.kind === "take" && a.item === LANTERN)).toBeUndefined();
  state = atStation();
  expect(cardActions(state, [WICK, LANTERN]).actions[0]?.label).toBe("Repair lantern");
  state = repair(state);
  expect(gone(state, WICK)).toBe(true);
  expect(state.items[LANTERN]).toMatchObject({ repaired: true, lit: false });
  expect(state.crossings[CROSSING]).toEqual({ discovered: false });
  expect(cardActions(state, [LANTERN]).actions[0]?.label).toBe("Light lantern");
  state = light(decodeSave(encodeSave(state)));
  expect(state.crossings[CROSSING]).toEqual({ discovered: true, method: LANTERN });
  expect(state.transports["greek-ship"].dock).toBe("pond");
  expect(state.actors.keeper.completedQuest.by).toBe("vale");
  expect(read(state, "Light lantern", "vale")).toBeUndefined();
  state.items[LANTERN].lit = false;
  expect(() => validateWorld(state)).toThrow();
});

test("the shared traveller lighting the beam gets credit instead of another person at the station", () => {
  let state = atStation("mara");
  state.sharedVersion = 1;
  state.actors.mara.place = "station";
  state.actors.mara.visited.push("station");
  seatActors(state, ["vale", "mara"], ["vale", "mara"]);
  expect(read(state, "Repair lantern", "vale")).toBeUndefined();
  state = light(repair(state, "mara"), "mara");
  expect(state.actors.keeper.completedQuest.by).toBe("mara");
  expect(state.log.filter((e) => e.ownerId === "keeper" && e.verb === "want_met")
    .map((e) => e.actorId)).toEqual(["mara"]);
});

test("a save from before the station signal gains the items and keeps its old crossing open", () => {
  const state = createWorld();
  for (const id of [LANTERN, WICK]) {
    delete state.items[id];
    delete state.memories[id];
  }
  state.crossings[CROSSING] = { discovered: true };
  const restored = decodeSave(JSON.stringify(state));
  expect(restored.items[LANTERN]).toMatchObject({ holder: "station", repaired: false, lit: false });
  expect(restored.items[WICK].holder).toBe("pond");
  expect(restored.crossings[CROSSING]).toEqual({ discovered: true });
});

test("a disabled sea pack waits for reactivation before responding to a burning beam", () => {
  const switchSea = (state, enable) => {
    const result = play(state, { kind: "pack", pack: "sea", enable });
    expect(result.ok, result.error).toBe(true);
    return result.state;
  };
  const state = light(repair(switchSea(atStation(), false)));
  expect(state.items[LANTERN].lit).toBe(true);
  expect(state.crossings[CROSSING]).toEqual({ discovered: false });
  expect(switchSea(state, true).crossings[CROSSING]).toEqual({ discovered: true, method: LANTERN });
});

test("the existing pond signal retains priority if both signals are eligible", () => {
  let state = atStation("mara");
  state.sharedVersion = 1;
  state.actors.mara.place = "station";
  state.actors.mara.visited.push("station");
  seatActors(state, ["vale", "mara"], ["vale", "mara"]);
  state = repair(state, "mara");
  state.actors.vale.place = "pond";
  state.items.cloth.holder = "vale";
  state.actors.vale.heldItem = "cloth";
  state.items.lamp.holder = "pond";
  fillLampFuel(state);
  state.items.lamp.lit = true;
  state = light(state, "mara");
  expect(state.crossings[CROSSING]).toEqual({ discovered: true, method: "pond-lamp" });
  expect(state.actors.keeper.completedQuest.by).toBe("vale");
});
