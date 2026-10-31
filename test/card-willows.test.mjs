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
  packReadings,
  packFacts,
  hub,
} from "../v2/card-game/pack-registry.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import {
  portrait,
  residentPose,
  sceneStaging,
} from "../v2/card-game/scene.mjs";
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
  expect(world.actors.vale.place).toBe("pond");
  world.crossings["pond-greek-harbor"].discovered = true;
  summonTransport(world, "greek-ship", "pond");
  world = move(world, "greek-ship");
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
    go("vale", "greek-ship");
    go("mara", "greek-ship");
    const voyage = structuredClone(world.transports["greek-ship"]);
    go("vale", "willows-landing");
    expect(world.transports["greek-ship"]).toEqual(voyage);
    expect(world.actors.mara.place).toBe("greek-ship");
    go("mara", "greek-harbor", "course");
    go("mara", null, "wait");
    go("mara", "greek-harbor");
    expect(world.transports["greek-ship"].dock).toBe("greek-harbor");
    go("vale", "greek-ship");
    expect(world.transports["greek-ship"].dock).toBe("greek-harbor");
    summonTransport(world, "greek-ship", "pond");
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

  it("records each discovery before it becomes a fact for the landscape or Swede", () => {
    let world = island();
    expect(packFacts(world, "willows-landing")).toEqual([]);
    world = move(move(world, "willows-camp"), "willows-thicket");
    world = move(world, "willows-bank");
    // The bank is a place that might show something, not a checklist.
    expect(
      find(world, { choiceId: "willows-look-beneath-roots" }),
    ).toBeDefined();
    expect(find(world, { choiceId: "willows-hear-humming" })).toBeDefined();
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
    expect(exits(world, "willows-landing", "vale")).toContain("greek-ship");
    expect(
      decodeSave(encodeSave(world)).packs.willows.choices["willows-response"],
    ).toBe("watch");
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
    world = choose(move(world, "willows-thicket"), "examine-hollows");
    world = choose(move(world, "willows-bank"), "hear-humming");
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
    world = choose(world, "choose-watch");
    expect(sprite(world)).toBe("./assets/willows/swede-listening.webp");
    expect(residentPose(world, "vale")).toBeNull();
    expect(portrait("willows-swede")).toBe("./assets/willows/swede.webp");

    const bad = structuredClone(pack);
    bad.avatars["willows-swede"].poses = [
      { portrait: "assets/willows/swede-seated.webp", at: "pond", scale: 2 },
    ];
    expect(packProblems(bad, hub).join(" ")).toContain("poses need");
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
    world = move(world, "greek-ship");
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

  it("paces the willows nearer by night and keeps night signs to the dark", () => {
    const night = (world) => {
      const dark = structuredClone(world);
      dark.turn = dark.revision = 24;
      return dark;
    };
    let world = move(island(), "willows-camp");
    expect(find(world, { choiceId: "willows-pace-again" })).toBeUndefined();
    expect(find(world, { choiceId: "willows-listen-tent" })).toBeUndefined();
    expect(
      find(night(world), { choiceId: "willows-pace-willows" }),
    ).toBeUndefined();
    world = choose(world, "pace-willows");
    expect(packFacts(world, "willows-camp").join(" ")).toContain(
      "eleven paces",
    );
    expect(find(world, { choiceId: "willows-pace-again" })).toBeUndefined();
    world = choose(decodeSave(encodeSave(night(world))), "pace-again");
    world = choose(world, "listen-tent");
    const facts = packFacts(world, "willows-camp").join(" ");
    expect(facts).toContain("nine paces");
    expect(facts).toContain("where by day there were eleven");
    expect(packReadings(world, "willows-swede").map((r) => r.id)).toEqual(
      expect.arrayContaining(["willows-paced-text", "willows-nearer-text"]),
    );
    world = move(world, "willows-thicket");
    world = choose(world, "look-up-willows");
    expect(world.packs.willows.flags["willows-shapes-seen"]).toBe(true);
    // The otter wants the low sun; the boatman passes at any hour.
    world = move(move(world, "willows-camp"), "willows-landing");
    expect(find(world, { choiceId: "willows-watch-otter" })).toBeUndefined();
    world = choose(world, "watch-boatman");
    const place = narrativeContext(world).entities.find(
      (e) => e.id === "willows-landing",
    );
    expect(place.facts).toContain("Discoveries recorded so far: 5.");
  });

  it("lets the places narrate, the willows count and the Swede hush", () => {
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
    for (const line of ["It's their sound.", "Hush!", "You fool."])
      expect(swede.voice).toContain(line);
    expect(["item", "place", "person", "connect"]).toContain(swede.want.kind);
    // The Swede carries at most eight newest passages into a scene.
    let world = discoveries();
    world.turn = world.revision = 24;
    world = choose(world, "listen-tent");
    world = choose(world, "choose-watch");
    world = move(world, "willows-thicket");
    world = choose(world, "look-up-willows");
    const readings = packReadings(world, "willows-swede");
    expect(readings).toHaveLength(8);
    expect(readings.map((r) => r.id)).not.toContain("willows-arrival-text");
    expect(readings.map((r) => r.id).at(-1)).toBe("willows-understanding-text");
  });
});
