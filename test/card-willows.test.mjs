import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { summonTransport } from "../v2/card-game/pack-transport.mjs";
import {
  createWorld,
  legalActions,
  play,
  encodeSave,
  decodeSave,
  exits,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import {
  hub,
  packDefinitions,
  packProfiles,
  packReadings,
  packFacts,
} from "../v2/card-game/pack-registry.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { isNight } from "../v2/card-game/daylight.mjs";
import { locationWeather } from "../v2/card-game/weather.mjs";
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
// Night, and mist on the ship's deck.
const darkMist = (world) =>
  isNight(world) && locationWeather(world, "greek-ship")?.condition === "mist";
// Wait out the saved world clock until night and mist beside the ship's rail.
function mist(world) {
  while (!darkMist(world)) world.turn += 1;
  world.revision = Math.max(world.revision, world.turn);
  return world;
}
// The River Map starts in the Willows camp; these journeys lay it on the deck.
function chart(world) {
  world.items["willows-map"].holder = "greek-ship";
  return world;
}
function island() {
  let world = enableMotives(createWorld({ opening: true }), {
    questPrograms: true,
    personalQuests: true,
  });
  world = act(world, { kind: "light", item: "lamp" });
  world = move(world, "pond");
  expect(world.actors.vale.place).toBe("pond");
  world.crossings["pond-greek-harbor"].discovered = true;
  summonTransport(world, "greek-ship", "pond");
  world = move(chart(world), "greek-ship");
  world = move(mist(world), "willows-landing");
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
  it("reveals exact source passages to the Swede through the recorded story", () => {
    const normalize = (s) => s.replace(/\s+/g, " ").trim();
    const original = normalize(
      readFileSync(
        new URL("../v2/content/willows/source-text.txt", import.meta.url),
        "utf8",
      ),
    );
    for (const reading of pack.readings)
      expect(original).toContain(normalize(reading.text));
    const fresh = createWorld();
    expect(packReadings(fresh, "willows-swede")).toEqual([]);
    let world = island();
    expect(packReadings(world, "willows-swede").map((r) => r.id)).toEqual([
      "willows-arrival-text",
    ]);
    world = choose(world, "examine-hull");
    expect(packReadings(world, "willows-swede").map((r) => r.id)).toEqual([
      "willows-arrival-text",
      "willows-hull-text",
    ]);
    world = discoveries();
    const revealed = packReadings(world, "willows-swede");
    expect(revealed).toHaveLength(7);
    expect(
      packReadings(decodeSave(encodeSave(world)), "willows-swede"),
    ).toEqual(revealed);
    expect(
      narrativeContext(world).entities.find((e) => e.id === "willows-swede")
        .readings,
    ).toEqual(revealed);
    expect(packReadings(world, "vale")).toEqual([]);
  });

  it("shares the ship side passage while preserving riders, dock and pending recall", () => {
    let world = dispatchShared({
      op: "create",
      save: encodeSave(createWorld()),
    }).world;
    world.actors.vale.place = world.actors.mara.place = "pond";
    // BoardyAI's introductions are tested on their own; here he stays home.
    world.actors.boardyai.want = null;
    world.crossings["pond-greek-harbor"].discovered = true;
    summonTransport(world, "greek-ship", "pond");
    chart(world);
    const request = { claimed: ["vale", "mara"], present: ["vale", "mara"] };
    const go = (actor, target, kind = "move") => {
      const view = dispatchShared({ op: "view", world, ...request, actor });
      const action = view.actions.find(
        (a) => a.kind === kind && (target === null || a.target === target),
      );
      expect(action, `${actor} to ${target}`).toBeDefined();
      const result = dispatchShared({
        op: "play",
        world,
        ...request,
        actor,
        action,
      });
      expect(result.ok, result.error).toBe(true);
      world = decodeSave(encodeSave(result.world));
    };
    mist(world);
    go("vale", "greek-ship");
    go("mara", "greek-ship");
    // Residents who follow aboard may restamp the berth; the voyage holds.
    const { since: _since, ...voyage } = world.transports["greek-ship"];
    go("vale", "willows-landing");
    expect(world.transports["greek-ship"]).toMatchObject(voyage);
    expect(world.actors.mara.place).toBe("greek-ship");
    go("mara", "greek-harbor", "course");
    go("mara", null, "wait");
    go("mara", "greek-harbor");
    expect(world.transports["greek-ship"].dock).toBe("greek-harbor");
    // The map sails with the ship, so the way back holds at any port.
    const back = (w) =>
      dispatchShared({
        op: "view",
        world: w,
        ...request,
        actor: "vale",
      }).actions.some((a) => a.kind === "move" && a.target === "greek-ship");
    expect(back(world)).toBe(true);
    // Mara takes the map ashore at the harbor: Vale waits on the island.
    const ashore = structuredClone(world);
    ashore.items["willows-map"].holder = "greek-harbor";
    expect(back(ashore)).toBe(false);
    // When the dark mist lifts, Vale waits too, until the next misty night.
    world.turn = world.revision = world.turn + 12;
    while (darkMist(world)) world.turn = world.revision += 1;
    expect(back(world)).toBe(false);
    summonTransport(world, "greek-ship", "pond");
    mist(world);
    go("vale", "greek-ship");
    expect(world.transports["greek-ship"].dock).toBe("pond");
    go("vale", "willows-landing");
    expect(world.transports["greek-ship"]).toMatchObject({
      dock: "pond",
      destination: null,
      recall: null,
    });
    expect(packReadings(world, "willows-swede").map((r) => r.id)).toEqual([
      "willows-arrival-text",
    ]);
  });

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
    ).toContain("greek-ship");
    expect(move(world, "greek-ship").actors.vale.place).toBe("greek-ship");
  });

  it("rises beside the rail only with the River Map aboard, on a misty night or all of 31 October", () => {
    let world = enableMotives(createWorld({ opening: true }), {
      questPrograms: true,
      personalQuests: true,
    });
    world = move(act(world, { kind: "light", item: "lamp" }), "pond");
    world.crossings["pond-greek-harbor"].discovered = true;
    summonTransport(world, "greek-ship", "pond");
    world = move(world, "greek-ship");
    // The map starts in the Willows camp, so a fresh deck shows no way.
    expect(world.items["willows-map"].holder).toBe("willows-camp");
    expect(
      exits(mist(structuredClone(world)), "greek-ship", "vale"),
    ).not.toContain("willows-landing");
    chart(world);
    const at = (turn, date = "2026-10-30") =>
      Object.assign(structuredClone(world), { turn, revision: turn, date });
    const deck = (w) => exits(w, "greek-ship", "vale");
    // Night is every other block of 24 turns; the deck's mist is Boeotian.
    const day = at(96);
    expect(isNight(day)).toBe(false);
    expect(deck(day)).not.toContain("willows-landing");
    expect(availableCards(day)).not.toContain("willows-landing");
    let clearNight = at(24);
    while (locationWeather(clearNight, "greek-ship").condition === "mist")
      clearNight.turn = clearNight.revision += 1;
    expect(isNight(clearNight)).toBe(true);
    expect(deck(clearNight)).not.toContain("willows-landing");
    expect(availableCards(clearNight)).not.toContain("willows-landing");
    const mistyDay = at(48);
    expect(locationWeather(mistyDay, "greek-ship").condition).toBe("mist");
    expect(isNight(mistyDay)).toBe(false);
    expect(deck(mistyDay)).not.toContain("willows-landing");
    const night = mist(at(96));
    expect(night.turn).toBe(120);
    expect(deck(night)).toContain("willows-landing");
    expect(availableCards(night)).toContain("willows-landing");
    // Carried aboard counts as aboard; anywhere else it raises nothing.
    const carried = structuredClone(night);
    carried.items["willows-map"].holder = "vale";
    expect(deck(carried)).toContain("willows-landing");
    for (const holder of ["willows-camp", "greek-harbor", "pond"]) {
      const away = structuredClone(night);
      away.items["willows-map"].holder = holder;
      expect(deck(away)).not.toContain("willows-landing");
      expect(availableCards(away)).not.toContain("willows-landing");
    }
    // The map is the ship's way: any port, or at sea, serves.
    for (const ship of [
      { dock: "greek-harbor", phase: "docked" },
      { dock: "pond", phase: "sea" },
    ]) {
      const elsewhere = structuredClone(night);
      Object.assign(elsewhere.transports["greek-ship"], ship);
      expect(deck(elsewhere)).toContain("willows-landing");
    }
    // On 31 October (UTC) the mist rises all day, in any weather, map aboard.
    const halloweenDay = at(96, "2026-10-31");
    expect(isNight(halloweenDay)).toBe(false);
    expect(locationWeather(halloweenDay, "greek-ship").condition).not.toBe(
      "mist",
    );
    expect(deck(halloweenDay)).toContain("willows-landing");
    expect(availableCards(halloweenDay)).toContain("willows-landing");
    for (const clock of [clearNight, mistyDay])
      expect(deck({ ...clock, date: "2027-10-31" })).toContain(
        "willows-landing",
      );
    const noMap = at(96, "2026-10-31");
    noMap.items["willows-map"].holder = "willows-camp";
    expect(deck(noMap)).not.toContain("willows-landing");
    expect(deck(at(96, "2026-11-01"))).not.toContain("willows-landing");
    // The same recorded day decides it after a reload.
    expect(deck(decodeSave(encodeSave(at(72, "2026-10-31"))))).toContain(
      "willows-landing",
    );
    expect(() =>
      decodeSave(JSON.stringify({ ...night, date: "31/10" })),
    ).toThrow();
    // A play commits the day it was made on, before its cards are checked.
    const committed = play(
      day,
      find(day, { kind: "wait" }),
      day.revision,
      "vale",
      "2026-10-31",
    );
    expect(committed.ok, committed.error).toBe(true);
    expect(committed.state.date).toBe("2026-10-31");
    expect(deck(committed.state)).toContain("willows-landing");
    const action = find(at(96, "2026-10-31"), {
      kind: "move",
      target: "willows-landing",
    });
    expect(play(day, action, day.revision, "vale", "2026-10-31").ok).toBe(true);
    expect(play(day, action, day.revision, "vale", "2026-11-01").ok).toBe(
      false,
    );
    // Ashore when the mist lifts: no way back until the next misty night.
    let ashore = move(night, "willows-landing");
    ashore.turn = ashore.revision = 132;
    expect(exits(ashore, "willows-landing", "vale")).not.toContain(
      "greek-ship",
    );
    expect(mist(ashore).turn).toBe(264);
    expect(exits(ashore, "willows-landing", "vale")).toContain("greek-ship");
    // The traveller who carried the map ashore still finds the way back.
    const mapAshore = structuredClone(ashore);
    mapAshore.items["willows-map"].holder = "vale";
    expect(exits(mapAshore, "willows-landing", "vale")).toContain("greek-ship");
    mapAshore.items["willows-map"].holder = "willows-camp";
    expect(exits(mapAshore, "willows-landing", "vale")).not.toContain(
      "greek-ship",
    );
  });

  it("accepts the authored map, night, mist and 31 October gate and rejects malformed ones", () => {
    const mounted = packDefinitions.flatMap((p) => Object.keys(p.places));
    const problems = (edit) => {
      const willows = structuredClone(pack);
      edit(willows.crossings[0].requires);
      return packProblems(willows, hub, mounted).join(" ");
    };
    expect(problems(() => {})).toBe("");
    for (const bad of [
      { kind: "date", month: 13, day: 31 },
      { kind: "date", month: 10 },
      { kind: "any", conditions: [{ kind: "night" }] },
      { kind: "all", conditions: [{ kind: "night" }, { kind: "nope" }] },
      {
        kind: "any",
        conditions: [
          { kind: "night" },
          {
            kind: "all",
            conditions: [
              { kind: "night" },
              {
                kind: "any",
                conditions: [{ kind: "night" }, { kind: "night" }],
              },
            ],
          },
        ],
      },
    ])
      expect(
        problems((r) => r.push(bad)),
        JSON.stringify(bad),
      ).toMatch(/condition/);
  });

  it("replays the committed day through a shared world", () => {
    let world = dispatchShared({
      op: "create",
      save: encodeSave(createWorld()),
    }).world;
    world.actors.vale.place = "greek-ship";
    world.actors.boardyai.want = null;
    chart(world);
    const request = { claimed: ["vale"], present: ["vale"], actor: "vale" };
    const view = (w) => dispatchShared({ op: "view", world: w, ...request });
    const wait = view(world).actions.find((a) => a.kind === "wait");
    const run = (date) => {
      const r = dispatchShared({
        op: "play",
        world,
        ...request,
        action: wait,
        date,
      });
      expect(r.ok, r.error).toBe(true);
      return r.world;
    };
    const halloween = run("2026-10-31");
    expect(halloween.date).toBe("2026-10-31");
    expect(
      view(halloween).actions.some(
        (a) => a.kind === "move" && a.target === "willows-landing",
      ),
    ).toBe(true);
    // Replaying the same command gives the same world; another day differs.
    expect(run("2026-10-31")).toEqual(halloween);
    const after = run("2026-11-01");
    expect(after.date).toBe("2026-11-01");
    expect(
      view(after).actions.some(
        (a) => a.kind === "move" && a.target === "willows-landing",
      ),
    ).toBe(darkMist(after));
    // A play without a day keeps the world's last recorded one.
    const r = dispatchShared({
      op: "play",
      world: halloween,
      ...request,
      action: view(halloween).actions.find((a) => a.kind === "wait"),
    });
    expect(r.ok, r.error).toBe(true);
    expect(r.world.date).toBe("2026-10-31");
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
    expect(exits(mist(world), "willows-landing", "vale")).toContain(
      "greek-ship",
    );
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
    world = move(mist(world), "greek-ship");
    world = move(move(mist(world), "willows-landing"), "willows-camp");
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
