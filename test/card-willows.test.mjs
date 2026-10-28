import { describe, expect, it } from "vitest";
import {
  createWorld,
  legalActions,
  play,
  encodeSave,
  decodeSave,
  exits,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import {
  packDefinitions,
  packProfiles,
  packFacts,
} from "../v2/card-game/pack-registry.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { cardChoices, availableCards } from "../v2/card-game/cards.mjs";

const pack = packDefinitions.find((p) => p.id === "willows");
const find = (world, fields) =>
  legalActions(world).find((a) =>
    Object.entries(fields).every(([key, value]) => a[key] === value),
  );
function act(world, fields) {
  const action = find(world, fields);
  expect(action, JSON.stringify(fields)).toBeDefined();
  if (action.choiceId)
    expect(cardChoices(world, action.target).map((a) => a.choiceId)).toContain(
      action.choiceId,
    );
  const result = play(world, action);
  expect(result.ok, result.error).toBe(true);
  return result.state;
}
const move = (world, target) => act(world, { kind: "move", target });
const choose = (world, id) => act(world, { choiceId: `willows-${id}` });
const take = (world, item) =>
  act(world, { kind: "take", item: `willows-${item}` });
function island() {
  let world = enableMotives(createWorld({ opening: true }), {
    questPrograms: true,
    personalQuests: true,
  });
  world = act(world, { kind: "light", item: "lamp" });
  world = move(world, "pond");
  world = move(world, "willows-landing");
  return world;
}
function discoveries() {
  let world = choose(island(), "examine-hull");
  world = move(world, "willows-camp");
  world = choose(world, "count-stores");
  world = act(world, { kind: "talk", target: "willows-swede" });
  world = move(world, "willows-thicket");
  world = choose(world, "examine-hollows");
  world = move(world, "willows-bank");
  world = choose(world, "hear-humming");
  world = choose(world, "look-beneath-roots");
  world = move(move(world, "willows-thicket"), "willows-camp");
  return choose(world, "compare-signs");
}

describe("The Willows", () => {
  it("gives the four locations their voices and the Swede the one resident role", () => {
    expect(Object.keys(pack.avatars)).toEqual(["willows-swede"]);
    expect(Object.keys(pack.places)).toHaveLength(4);
    for (const id of Object.keys(pack.places)) {
      expect(packProfiles[id].kind).toBe("location");
      expect(packProfiles[id].persona).toContain("first person");
    }
    const world = island();
    for (const place of Object.keys(pack.places)) {
      const view = structuredClone(world);
      view.actors.vale.place = place;
      expect(exits(view, place, "vale").length).toBeGreaterThan(0);
    }
    expect(
      exits(decodeSave(encodeSave(world)), "willows-landing", "vale"),
    ).toContain("pond");
    expect(move(world, "pond").actors.vale.place).toBe("pond");
  });

  it("records each discovery before it becomes a fact for the landscape or Swede", () => {
    let world = island();
    expect(packFacts(world, "willows-landing")).toEqual([]);
    world = move(move(world, "willows-camp"), "willows-thicket");
    world = move(world, "willows-bank");
    expect(find(world, { choiceId: "willows-hear-humming" })).toBeUndefined();
    expect(
      find(world, { choiceId: "willows-look-beneath-roots" }),
    ).toBeUndefined();
    world = discoveries();
    expect(packFacts(world, "willows-swede").join(" ")).toContain(
      "compared the canoe damage",
    );
    const saved = decodeSave(encodeSave(world));
    expect(saved.packs.willows).toEqual(world.packs.willows);
    expect(find(saved, { choiceId: "willows-compare-signs" })).toBeUndefined();
    world = choose(saved, "choose-watch");
    expect(world.packs.willows.choices["willows-response"]).toBe("watch");
    expect(world.actors["willows-swede"].place).toBe("willows-camp");
    world = move(world, "willows-landing");
    expect(exits(world, "willows-landing", "vale")).toContain("pond");
    expect(
      decodeSave(encodeSave(world)).packs.willows.choices["willows-response"],
    ).toBe("watch");
  });

  it("requires carried gear for preparation and saves a choice to return", () => {
    let world = discoveries();
    world = take(take(world, "rope"), "sheet");
    world = move(world, "willows-landing");
    world = choose(world, "prepare-canoe");
    for (const item of ["rope", "sheet"])
      expect(world.items[`willows-${item}`].holder).toBe("willows-landing");
    expect(
      find(world, { choiceId: "willows-choose-departure" }),
    ).toBeUndefined();
    world = take(world, "paddle");
    world = choose(world, "set-paddle");
    const ready = decodeSave(encodeSave(world));
    const stolen = structuredClone(ready);
    stolen.items["willows-rope"].holder = "willows-swede";
    expect(
      find(stolen, { choiceId: "willows-choose-departure" }),
    ).toBeUndefined();
    world = choose(ready, "choose-departure");
    expect(world.packs.willows.choices["willows-response"]).toBe("depart");
    world = move(world, "pond");
    world = move(move(world, "willows-landing"), "willows-camp");
    expect(find(world, { choiceId: "willows-choose-watch" })).toBeUndefined();
    expect(decodeSave(encodeSave(world)).packs.willows).toEqual(
      world.packs.willows,
    );
  });

  it("mounts into an older save while preserving its items, places and discoveries", () => {
    const old = createWorld();
    const priorItems = Object.fromEntries(
      Object.entries(old.items).filter(([id]) => !pack.items[id]),
    );
    const priorPacks = Object.fromEntries(
      Object.entries(old.packs).filter(([id]) => id !== "willows"),
    );
    delete old.packs.willows;
    for (const id of Object.keys(pack.places)) {
      delete old.locations[id];
      delete old.memories[id];
    }
    for (const id of Object.keys(pack.items)) {
      delete old.items[id];
      delete old.memories[id];
    }
    for (const id of Object.keys(pack.avatars)) {
      delete old.actors[id];
      delete old.memories[id];
      delete old.peaceUntil[id];
      for (const actor of Object.values(old.actors)) delete actor.trust[id];
    }
    for (const c of pack.crossings) delete old.crossings[c.id];
    const mounted = decodeSave(JSON.stringify(old));
    expect(mounted.packs.willows.revision).toBe(1);
    for (const [id, item] of Object.entries(priorItems))
      expect(mounted.items[id]).toEqual(item);
    for (const [id, state] of Object.entries(priorPacks))
      expect(mounted.packs[id]).toEqual(state);
  });

  it("shares discoveries and rejects a stale preparation when another human holds the rope", () => {
    let world = dispatchShared({
      op: "create",
      save: encodeSave(discoveries()),
    }).world;
    const request = {
      actor: "vale",
      claimed: ["vale", "mara"],
      present: ["vale", "mara"],
    };
    const sharedAct = (fields) => {
      const view = dispatchShared({ op: "view", world, ...request });
      const action = view.actions.find((a) =>
        Object.entries(fields).every(([k, v]) => a[k] === v),
      );
      expect(action, JSON.stringify(fields)).toBeDefined();
      const result = dispatchShared({ op: "play", world, ...request, action });
      expect(result.ok).toBe(true);
      world = result.world;
      return action;
    };
    sharedAct({ kind: "take", item: "willows-rope" });
    sharedAct({ kind: "take", item: "willows-sheet" });
    sharedAct({ kind: "move", target: "willows-landing" });
    const action = dispatchShared({
      op: "view",
      world,
      ...request,
    }).actions.find((a) => a.choiceId === "willows-prepare-canoe");
    expect(action).toBeDefined();
    const changed = structuredClone(world);
    changed.items["willows-rope"].holder = "mara";
    expect(
      dispatchShared({ op: "play", world: changed, ...request, action }).ok,
    ).toBe(false);
    sharedAct({ choiceId: "willows-prepare-canoe" });
    const mara = dispatchShared({
      op: "view",
      world,
      ...request,
      actor: "mara",
    });
    expect(mara.world.packs.willows).toEqual(world.packs.willows);
    expect(decodeSave(encodeSave(world)).packs.willows).toEqual(
      world.packs.willows,
    );
    expect(
      availableCards(dispatchShared({ op: "view", world, ...request }).world),
    ).toContain("willows-landing");
  });
});
