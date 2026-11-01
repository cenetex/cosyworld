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
import {
  packDefinitions,
  packProfiles,
  packFacts,
  hub,
  validatePackDefinition,
  entityActive,
} from "../v2/card-game/pack-registry.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import {
  backdrop,
  portrait,
  residentPose,
  sceneStaging,
} from "../v2/card-game/scene.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { darkMist, isNight } from "../v2/card-game/daylight.mjs";
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
const drop = (world, item) =>
  act(world, { kind: "drop", item: `willows-${item}` });
const seen = (world, id) =>
  Object.hasOwn(world.packs.willows.receipts, `willows-${id}`);
// Wait until this place's sign turns up. Each Wait
// notices at most one sign, in the run's seeded order.
function observe(world, id) {
  for (let i = 0; i < 16 && !seen(world, id); i++)
    world = act(world, { kind: "wait" });
  expect(seen(world, id), id).toBe(true);
  return world;
}
const take = (world, item) =>
  act(world, { kind: "take", item: `willows-${item}` });
// Wait out the saved world clock until night and mist beside the ship's rail.
// The jump skips the rounds between, so the ship counts its idle rounds from
// here (a resident aboard would otherwise sail it off on the next round).
function mist(world) {
  while (!darkMist(world)) world.turn += 1;
  world.revision = Math.max(world.revision, world.turn);
  world.transports["greek-ship"].since = world.turn;
  return world;
}
// Run the saved clock forward to the next day or night block.
function clock(world, night) {
  while (isNight(world) !== night) world.turn += 1;
  world.revision = Math.max(world.revision, world.turn);
  return world;
}
function island() {
  let world = enableMotives(createWorld({ opening: true }), {
    questPrograms: true,
    personalQuests: true,
  });
  world = act(world, { kind: "snuff", item: "lamp" });
  world = move(world, "pond");
  expect(world.actors.vale.place).toBe("pond");
  world.crossings["pond-greek-harbor"].discovered = true;
  summonTransport(world, "greek-ship", "pond");
  world = move(world, "greek-ship");
  world = move(mist(world), "willows-landing");
  return world;
}
function discoveries() {
  let world = take(observe(island(), "examine-hull"), "provisions");
  world = drop(move(world, "willows-camp"), "provisions");
  world = observe(world, "count-stores");
  world = act(world, { kind: "talk", target: "willows-swede" });
  world = move(world, "willows-thicket");
  world = observe(world, "examine-hollows");
  world = move(world, "willows-bank");
  world = observe(world, "hear-humming");
  world = observe(world, "look-beneath-roots");
  world = move(move(world, "willows-thicket"), "willows-camp");
  return observe(world, "compare-signs");
}
function kitHome(world) {
  world.actors.vale.place = "willows-landing";
  world = take(take(world, "sheet"), "provisions");
  world = drop(drop(move(world, "willows-camp"), "sheet"), "provisions");
  world = move(move(world, "willows-thicket"), "willows-bank");
  world = take(take(world, "paddle"), "rope");
  world = move(move(world, "willows-thicket"), "willows-camp");
  return drop(drop(world, "paddle"), "rope");
}

describe("The Willows", () => {
  it("keeps the source passages as world lore, out of every speech prompt", () => {
    const normalize = (s) => s.replace(/\s+/g, " ").trim();
    const original = normalize(
      readFileSync(
        new URL("../v2/content/willows/source-text.txt", import.meta.url),
        "utf8",
      ),
    );
    const lore = JSON.parse(
      readFileSync(
        new URL("../v2/content/willows/lore/readings.json", import.meta.url),
        "utf8",
      ),
    );
    expect(lore.source.author).toBe("Algernon Blackwood");
    expect(lore.readings).toHaveLength(13);
    for (const reading of lore.readings)
      expect(original).toContain(normalize(reading.text));
    expect(pack.readings).toBeUndefined();
    // Characters speak from world state; the passages never reach dialogue.
    const context = JSON.stringify(narrativeContext(discoveries()));
    expect(context).not.toContain('"readings"');
    for (const reading of lore.readings)
      expect(context).not.toContain(reading.text.slice(0, 60));
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
    const { since: _since, ...voyage } = structuredClone(
      world.transports["greek-ship"],
    );
    go("vale", "willows-landing");
    expect(world.transports["greek-ship"]).toMatchObject(voyage);
    expect(world.actors.mara.place).toBe("greek-ship");
    go("mara", "greek-harbor", "course");
    go("mara", null, "wait");
    go("mara", "greek-harbor");
    expect(world.transports["greek-ship"].dock).toBe("greek-harbor");
    // The ship has left Black Pond: Vale waits on the island, mist or not.
    expect(
      dispatchShared({
        op: "view",
        world,
        ...request,
        actor: "vale",
      }).actions.some((a) => a.kind === "move" && a.target === "greek-ship"),
    ).toBe(false);
    // The lamp calls the empty ship home; the next dark mist reopens the way.
    summonTransport(world, "greek-ship", "pond");
    mist(world);
    go("vale", "greek-ship");
    expect(world.transports["greek-ship"].dock).toBe("pond");
    go("vale", "willows-landing");
    // The call is spent. Residents left aboard may set the next course once
    // the last human steps off (the sea mist now comes round every 48 turns,
    // so the moth and the keeper are on deck at this hour).
    expect(world.transports["greek-ship"]).toMatchObject({
      dock: "pond",
      recall: null,
    });
  });

  it("gives the four locations their voices and the Swede the one resident role", () => {
    expect(Object.keys(pack.avatars)).toEqual(["willows-swede"]);
    expect(Object.keys(pack.places)).toHaveLength(4);
    const thicket = pack.places["willows-thicket"];
    expect(thicket.road).toEqual(["willows-camp", "willows-bank"]);
    expect(thicket.retired).toBeUndefined();
    expect(pack.places["willows-camp"].exits).not.toContain("willows-bank");
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

  it("accepts a bounded any of two to four conditions and the @sea dock", () => {
    expect(validatePackDefinition(structuredClone(pack))).toBeTruthy();
    const requires = (bad) => {
      const copy = structuredClone(pack);
      copy.crossings[0].requires = [bad];
      return () => validatePackDefinition(copy);
    };
    const sea = { kind: "ship_at", transport: "greek-ship", dock: "@sea" };
    expect(requires({ kind: "any", conditions: [sea] })).toThrow();
    expect(requires({ ...sea, dock: "@land" })).toThrow();
    expect(requires({ kind: "any", conditions: [sea, sea] })).not.toThrow();
  });

  it("rises beside the rail only on a misty night, and keeps a traveller there until the next", () => {
    let world = enableMotives(createWorld({ opening: true }), {
      questPrograms: true,
      personalQuests: true,
    });
    world = move(act(world, { kind: "snuff", item: "lamp" }), "pond");
    world.crossings["pond-greek-harbor"].discovered = true;
    summonTransport(world, "greek-ship", "pond");
    world = move(world, "greek-ship");
    const at = (turn) =>
      Object.assign(structuredClone(world), { turn, revision: turn });
    const deck = (w) => exits(w, "greek-ship", "vale");
    // Night is every other block of 24 turns; the deck has its own sea
    // weather (weather.json "sea": mist, rain, mist, rain, mist, clear).
    const day = at(0);
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
    const night = mist(at(0));
    expect(night.turn).toBe(24);
    expect(deck(night)).toContain("willows-landing");
    expect(availableCards(night)).toContain("willows-landing");
    // At Black Pond or at sea between ports (#1589); the same dark mist at
    // the Wine-Dark Harbor raises nothing.
    const harbor = structuredClone(night);
    Object.assign(harbor.transports["greek-ship"], {
      dock: "greek-harbor",
      phase: "docked",
    });
    expect(deck(harbor)).not.toContain("willows-landing");
    expect(availableCards(harbor)).not.toContain("willows-landing");
    const sea = structuredClone(night);
    Object.assign(sea.transports["greek-ship"], {
      dock: "greek-harbor",
      destination: "pond",
      phase: "sea",
    });
    expect(deck(sea)).toContain("willows-landing");
    expect(availableCards(sea)).toContain("willows-landing");
    // At sea by day, or on a rainy night at sea, the card stays away.
    for (const turn of [0, 36]) {
      const off = Object.assign(structuredClone(sea), { turn, revision: turn });
      expect(deck(off)).not.toContain("willows-landing");
    }
    // Stepping off at sea leaves the empty ship to finish its voyage; the
    // island keeps a way back only while it sails or lies at the pond.
    const fromSea = move(sea, "willows-landing");
    expect(fromSea.actors.vale.place).toBe("willows-landing");
    expect(exits(fromSea, "willows-landing", "vale")).toContain("greek-ship");
    Object.assign(fromSea.transports["greek-ship"], {
      dock: "pond",
      destination: null,
      phase: "docked",
    });
    expect(exits(fromSea, "willows-landing", "vale")).toContain("greek-ship");
    fromSea.transports["greek-ship"].dock = "greek-harbor";
    expect(exits(fromSea, "willows-landing", "vale")).not.toContain(
      "greek-ship",
    );
    // The same clock decides it after a reload and in a shared view.
    expect(deck(decodeSave(encodeSave(night)))).toContain("willows-landing");
    // Ashore when the mist lifts: no way back until the next misty night.
    let ashore = move(night, "willows-landing");
    ashore.turn = ashore.revision = 36;
    expect(exits(ashore, "willows-landing", "vale")).not.toContain(
      "greek-ship",
    );
    expect(mist(ashore).turn).toBe(72);
    expect(exits(ashore, "willows-landing", "vale")).toContain("greek-ship");
  });

  it("records each discovery before it becomes a fact for the landscape or Swede", () => {
    let world = island();
    expect(packFacts(world, "willows-landing")).toEqual([]);
    world = move(move(world, "willows-camp"), "willows-thicket");
    world = move(world, "willows-bank");
    // Wait finds signs; no observation is a story button.
    expect(legalActions(world).some((a) => a.kind === "choose")).toBe(false);
    world = act(world, { kind: "wait" });
    expect(
      ["hear-humming", "look-beneath-roots"].some((id) => seen(world, id)),
    ).toBe(true);
    expect(world.log.findLast((e) => e.verb === "wait").text).toMatch(
      /humming|drowned man/,
    );
    world = discoveries();
    expect(packFacts(world, "willows-swede").join(" ")).toContain(
      "compared the canoe damage",
    );
    const saved = decodeSave(encodeSave(world));
    expect(saved.packs.willows).toEqual(world.packs.willows);
    expect(pack.choices.every((c) => c.on)).toBe(true);
  });

  it("frees the Swede and the canoe only while the whole kit is at camp", () => {
    let world = kitHome(island());
    const canoe = (w) => exits(w, "willows-landing", "vale").includes("pond");
    const gone = structuredClone(world);
    gone.items["willows-rope"].holder = "willows-bank";
    expect(canoe(gone)).toBe(false);
    world = move(world, "willows-landing");
    expect(canoe(world)).toBe(true);
    expect(exits(world, "willows-landing", "willows-swede")).toContain("pond");
    const painting = (w) => backdrop("willows-landing", w);
    const mended = "./assets/willows/landing-mended.webp";
    const day = clock(structuredClone(world), false);
    expect(painting(day)).toBe(mended);
    expect(painting(decodeSave(encodeSave(day)))).toBe(mended);
    expect(painting(clock(gone, false))).not.toBe(mended);
    const departed = structuredClone(day);
    departed.packs.willows.flags["willows-swede-gone"] = true;
    expect(painting(departed)).not.toBe(mended);
    const night = clock(structuredClone(day), true);
    while (darkMist(night)) night.turn += 1;
    expect(painting(night)).toBe("./assets/willows/landing-night.webp");
    const misty = mist(structuredClone(day));
    misty.transports["greek-ship"].dock = "pond";
    expect(painting(misty)).toBe("./assets/willows/landing-ship-night.webp");
    expect(move(world, "pond").actors.vale.place).toBe("pond");
  });

  it("poses the Swede from saved discoveries in local and shared play", () => {
    const sprite = (world) => portrait("willows-swede", null, world);
    const swedeScale = (world) =>
      sceneStaging(world, { locationId: "willows-camp" }).actors.find(
        (a) => a.id === "willows-swede",
      )?.scale;
    let world = move(island(), "willows-camp");
    expect(sprite(world)).toBe("./assets/willows/swede-seated.webp");
    const seated = swedeScale(world);
    const away = structuredClone(world);
    away.actors["willows-swede"].place = "willows-landing";
    expect(sprite(away)).toBe("./assets/willows/swede.webp");
    away.actors["willows-swede"].place = "willows-bank";
    expect(sprite(away)).toBe("./assets/willows/swede-listening.webp");
    world = observe(move(world, "willows-thicket"), "examine-hollows");
    world = observe(move(world, "willows-bank"), "hear-humming");
    expect(sprite(world)).toBe("./assets/willows/swede-listening.webp");
    world = discoveries();
    expect(sprite(world)).toBe("./assets/willows/swede-worried.webp");
    expect(swedeScale(world)).toBeCloseTo(seated / 0.62);
    const shared = dispatchShared({
      op: "view",
      world: dispatchShared({ op: "create", save: encodeSave(world) }).world,
      actor: "vale",
      claimed: ["vale"],
      present: ["vale"],
    }).world;
    expect(sprite(shared)).toBe(sprite(world));
    expect(sprite(decodeSave(encodeSave(world)))).toBe(sprite(world));
    expect(residentPose(world, "vale")).toBeNull();
    expect(portrait("willows-swede")).toBe("./assets/willows/swede.webp");

    const bad = structuredClone(pack);
    bad.avatars["willows-swede"].poses = [
      { portrait: "assets/willows/swede-seated.webp", at: "pond", scale: 2 },
    ];
    expect(packProblems(bad, hub).join(" ")).toContain("poses need");
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
    expect(mounted.packs.willows.revision).toBe(2);
    for (const [id, item] of Object.entries(priorItems))
      expect(mounted.items[id]).toEqual(item);
    for (const [id, state] of Object.entries(priorPacks))
      expect(mounted.packs[id]).toEqual(state);
  });

  it("lets the Swede leave the world with the canoe, for good", () => {
    let world = move(kitHome(island()), "willows-landing");
    let swede = world.actors["willows-swede"];
    swede.place = "willows-landing";
    swede.want = {
      kind: "place",
      target: "pond",
      since: world.turn,
      refusals: 0,
    };
    for (
      let i = 0;
      i < 8 && !world.packs.willows.flags["willows-swede-gone"];
      i++
    )
      world = act(world, { kind: "wait" });
    expect(world.packs.willows.flags["willows-swede-gone"]).toBe(true);
    expect(entityActive(world, "willows-swede")).toBe(false);
    expect(exits(world, "pond", "vale")).not.toContain("willows-landing");
    const saved = decodeSave(encodeSave(world));
    expect(saved.packs.willows).toEqual(world.packs.willows);
    const shared = dispatchShared({
      op: "create",
      save: encodeSave(world),
    }).world;
    const view = dispatchShared({
      op: "view",
      world: shared,
      actor: "vale",
      claimed: ["vale"],
      present: ["vale"],
    });
    expect(view.actions.some((a) => a.target === "willows-swede")).toBe(false);
    for (let i = 0; i < 6; i++) world = act(world, { kind: "wait" });
    expect(world.actors["willows-swede"].place).toBe("pond");
  });

  it("upgrades a revision 1 save: the ending and gear chain leave, the kit scatters", () => {
    const old = discoveries();
    const saved = old.packs.willows;
    saved.revision = 1;
    saved.receipts["willows-choose-watch"] = old.turn;
    saved.choices["willows-response"] = "watch";
    saved.flags["willows-gear-laid"] = true;
    old.items["willows-rope"].holder = "willows-camp";
    old.actors.vale.place = "willows-thicket";
    const world = decodeSave(JSON.stringify(old));
    expect(world.packs.willows.revision).toBe(2);
    expect(world.packs.willows.choices).toEqual({});
    expect(world.packs.willows.flags["willows-gear-laid"]).toBeUndefined();
    expect(world.items["willows-rope"].holder).toBe("willows-bank");
    expect(world.actors.vale.place).toBe("willows-thicket");
  });

  it("paces the willows nearer by night and keeps night signs to the dark", () => {
    const night = (world) => {
      return clock(structuredClone(world), true);
    };
    // The mist lands the player at night; the pacing starts by day.
    let world = move(clock(island(), false), "willows-camp");
    world = observe(world, "pace-willows");
    expect(seen(world, "pace-again") || seen(world, "listen-tent")).toBe(false);
    expect(packFacts(world, "willows-camp").join(" ")).toContain(
      "eleven paces",
    );
    world = observe(decodeSave(encodeSave(night(world))), "pace-again");
    world = observe(world, "listen-tent");
    const facts = packFacts(world, "willows-camp").join(" ");
    expect(facts).toContain("nine paces");
    expect(facts).toContain("where by day there were eleven");
    world = move(world, "willows-thicket");
    world = observe(world, "look-up-willows");
    expect(world.packs.willows.flags["willows-shapes-seen"]).toBe(true);
    world = move(move(world, "willows-camp"), "willows-landing");
    const place = narrativeContext(world).entities.find(
      (e) => e.id === "willows-landing",
    );
    expect(place.facts.join(" ")).toMatch(/Discoveries recorded so far: \d/);
  });

  it("lets the places narrate and the willows count, with the Swede only a seed", () => {
    for (const id of ["willows-landing", "willows-camp", "willows-bank"]) {
      expect(pack.places[id].voice).toContain("first person");
      expect(pack.places[id].voice).toContain("Discoveries recorded so far");
    }
    expect(pack.places["willows-thicket"].voice).toContain("we, us and our");
    expect(pack.places["willows-thicket"].voice).toContain(
      "never give a reason",
    );
    expect(pack.places["willows-bank"].persona).not.toContain(
      "authored places",
    );
    const swede = pack.avatars["willows-swede"];
    expect(swede.seed).toBe("The Swede, a traveller on the river.");
    expect(swede.voice).toBeUndefined();
    expect(["item", "place", "person", "connect"]).toContain(swede.want.kind);
  });
});
