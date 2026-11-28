import { execFile } from "node:child_process";
import { promisify } from "node:util";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { createWorld, decodeSave, encodeSave, legalActions, play } from "../v2/card-game/world.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { knowsLane } from "../v2/card-game/pack-transport.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { gainTrust } from "../v2/card-game/world/company.mjs";
import { act, witnessed } from "./fixtures/card-branch-ways.mjs";
import { funeralJourney } from "./helpers/greek-funeral.mjs";

const greek = "greek-drama";
const rhapsode = "greek-rhapsode";
const retiredReturn = ["greek-lemnos", "greek-piraeus"];
const survivingRoad = ["greek-harbor", "greek-road-thebes"];

async function releasedRules() {
  const revision = "a5f722f147e2d6cd8ff7381c96c138a77f15eb73";
  const git = promisify(execFile);
  const prior = (name) =>
    git(
      "git",
      ["show", `${revision}:v2/orchestrator-rust/src/card_shared/${name}`],
      { encoding: "utf8", maxBuffer: 64 << 20 },
    ).then(({ stdout }) => stdout);
  const [content, source] = await Promise.all([
    prior("content.json"),
    prior("engine-v229.js"),
  ]);
  const runtime = vm.createContext({
    cardContent: JSON.parse(content),
  });
  vm.runInContext(
    source.replace(
      "globalThis.cardShared = (json) => {",
      "globalThis.local = { createWorld, validateWorld }; globalThis.cardShared = (json) => {",
    ),
    runtime,
  );
  return {
    ...runtime.local,
    shared: (request) =>
      JSON.parse(runtime.cardShared(JSON.stringify(request))),
  };
}

function expectCurrentRoutes(world) {
  expect(world.packs[greek].revision).toBe(packDefinition(greek).revision);
  expect(world.routeKnowledge[rhapsode]).not.toContainEqual(retiredReturn);
  expect(world.routeKnowledge[rhapsode]).toContainEqual(survivingRoad);
  expect(world.routeKnowledge[rhapsode]).not.toContainEqual([
    "greek-lemnos",
    "greek-scylla",
  ]);
}

describe("Greek routes retired after revision 34", () => {
  it("loads genuine old solo saves and imports one to a shared world", async () => {
    const prior = await releasedRules();
    for (const opening of [false, true]) {
      const world = prior.createWorld({ opening });
      prior.validateWorld(world);
      expect(world.packs[greek].revision).toBe(34);
      expect(world.routeKnowledge[rhapsode]).toContainEqual(retiredReturn);
      const save = JSON.stringify(world);
      expectCurrentRoutes(decodeSave(save));
      expectCurrentRoutes(
        dispatchShared({ op: "create", seed: 4141, save }).world,
      );
    }
  });

  it("upgrades a genuine shared world", async () => {
    const prior = await releasedRules();
    const { ok, world } = prior.shared({ op: "create", seed: 4141 });
    expect(ok).toBe(true);
    expect(prior.shared({ op: "validate", world }).ok).toBe(true);
    expect(world.packs[greek].revision).toBe(34);
    expect(world.routeKnowledge[rhapsode]).toContainEqual(retiredReturn);
    const upgraded = dispatchShared({
      op: "upgrade",
      world,
      from: "full-card-world/229",
    });
    expect(upgraded.ok).toBe(true);
    expectCurrentRoutes(upgraded.world);
  });

  it("rejects a removed edge in a current save", () => {
    const world = createWorld();
    world.routeKnowledge[rhapsode].push(retiredReturn);
    expect(() => decodeSave(JSON.stringify(world))).toThrow(
      expect.objectContaining({ check: "routes" }),
    );
  });
});

it("gives travelers saved at Aulis a way home on the Scylla", () => {
  const aulis = "greek-aulis", gate = "greek-gate", pagasae = "greek-pagasae";
  const old = createWorld();
  old.packs[greek].revision = 45;
  old.actors.vale.place = aulis;
  old.routeKnowledge[rhapsode].push([aulis, gate], [gate, aulis]);
  const save = JSON.stringify(old);
  const world = decodeSave(save);
  const shared = dispatchShared({ op: "create", save });
  expect(shared.ok, shared.error).toBe(true);
  for (const loaded of [world, shared.world]) {
    expect(loaded.actors.vale.place).toBe(aulis);
    expect(loaded.items["greek-aulis-waiting-tent-water"].holder).toBe(aulis);
    expect(loaded.routeKnowledge[rhapsode]).not.toContainEqual([aulis, gate]);
    expect(loaded.routeKnowledge[rhapsode]).not.toContainEqual([gate, aulis]);
    expect(knowsLane(loaded, "vale", aulis, pagasae)).toBe(true);
  }
  const wait = legalActions(world).find((action) => action.label === "Wait for Scylla");
  expect(wait).toBeDefined();
  const arrival = play(world, wait, world.revision);
  expect(arrival.ok, arrival.error).toBe(true);
  expect(legalActions(arrival.state).some((action) =>
    action.kind === "move" && action.target === "greek-scylla",
  )).toBe(true);
});

it("keeps the Trojan account and gives travelers saved at Homecoming Beach a way back to Pagasae", () => {
  const beach = "greek-troy-beach", harbor = "greek-harbor", lemnos = "greek-lemnos";
  const scylla = "greek-scylla", pagasae = "greek-pagasae";
  const oldEdges = [[harbor, beach], [beach, harbor]];
  const old = witnessed("troy");
  old.packs[greek].revision = 46;
  old.actors.vale.place = beach;
  old.items.bell.holder = "vale";
  old.routeKnowledge.vale = [...(old.routeKnowledge.vale || []), ...oldEdges];
  const save = JSON.stringify(old);
  const shared = dispatchShared({ op: "create", save });
  expect(shared.ok, shared.error).toBe(true);

  for (const loaded of [decodeSave(save), shared.world]) {
    expect(loaded.actors.vale.place).toBe(beach);
    expect(loaded.items.bell.holder).toBe("vale");
    expect(loaded.items["greek-helen-accounts"].holder).toBe("greek-well");
    expect(loaded.packs[greek].receipts["greek-helen-troy"]).toBe(
      old.packs[greek].receipts["greek-helen-troy"],
    );
    for (const edge of oldEdges) expect(loaded.routeKnowledge.vale).not.toContainEqual(edge);
    expect(loaded.routeKnowledge[rhapsode]).toContainEqual(survivingRoad);
    expect(legalActions(loaded).some((a) => a.kind === "move" && a.target === harbor)).toBe(false);
    expect(knowsLane(loaded, "vale", beach, lemnos)).toBe(true);
  }
  let world = decodeSave(save);
  world = act(world, "wait", (a) => a.label === "Wait for Scylla");
  world = act(world, "wait", (a) => a.label === "Wait for Scylla");
  world = act(world, "move", (a) => a.target === scylla);
  world = act(world, "course", (a) => a.target === lemnos);
  world = act(world, "wait");
  world = act(world, "move", (a) => a.target === lemnos);
  expect(world.actors.vale.place).toBe(lemnos);
  expect(knowsLane(world, "vale", lemnos, pagasae)).toBe(false);
  world = act(world, "talk", (a) => a.target === "greek-story-sophocles-philoctetes-first");
  expect(knowsLane(world, "vale", lemnos, pagasae)).toBe(true);
  world = act(world, "move", (a) => a.target === scylla);
  world = act(world, "course", (a) => a.target === pagasae);
  world = act(world, "wait");
  world = act(world, "move", (a) => a.target === pagasae);
  expect(world.actors.vale.place).toBe(pagasae);
  expect(world.items.bell.holder).toBe("vale");
});

it("stores resident trust when it is earned and compacts old zero entries", () => {
  const creon = "greek-creon";
  const guard = "greek-guard";
  const world = createWorld();
  expect(world.actors[creon].trust[guard]).toBeUndefined();
  expect(world.actors[guard].trust.vale).toBe(0);
  gainTrust(world, guard, creon);
  expect(world.actors[guard].trust[creon]).toBe(1);

  world.packs[greek].revision = 43;
  world.actors[creon].trust[guard] = 0;
  const loaded = decodeSave(JSON.stringify(world));
  expect(loaded.actors[creon].trust[guard]).toBeUndefined();
  expect(loaded.actors[guard].trust[creon]).toBe(1);
  expect(decodeSave(encodeSave(loaded))).toEqual(loaded);
});

describe("retired Greek place cards", () => {
  const court = "greek-areopagus";
  const formerOffering = "greek-areopagus-first-offering";
  const currentCard = "greek-story-aeschylus-eumenides-object";
  const wayfinder = "elysium-wayfinder";
  const formerSave = (holder) => {
    const world = createWorld();
    world.packs[greek].revision = 42;
    world.items[formerOffering] = { holder, history: [] };
    return world;
  };

  it("removes a place's active card while another place retains its own", () => {
    const world = formerSave("greek-acropolis");
    world.placeCard = { [court]: formerOffering, station: wayfinder };
    const loaded = decodeSave(JSON.stringify(world));
    expect(loaded.items[formerOffering]).toBeUndefined();
    expect(loaded.placeCard).toEqual({ station: wayfinder });
    expect(decodeSave(encodeSave(loaded)).placeCard).toEqual(loaded.placeCard);
  });

  it("keeps a place's other completed cards, omitting an empty record", () => {
    for (const [cards, expected] of [
      [[formerOffering, currentCard], { [court]: [currentCard] }],
      [[formerOffering], undefined],
    ]) {
      const world = formerSave(court);
      world.placeMet = { [court]: cards };
      const loaded = decodeSave(JSON.stringify(world));
      expect(loaded.items[formerOffering]).toBeUndefined();
      expect(loaded.placeMet).toEqual(expected);
      expect(decodeSave(encodeSave(loaded)).placeMet).toEqual(expected);
    }
  });

  it("keeps old grave Honey and its history when retiring the grave's card", () => {
    const honey = "greek-antigone-grave-honey";
    const grave = "greek-polynices-hollow";
    const buried = funeralJourney().buried;
    for (const completed of [false, true]) {
      const world = structuredClone(buried);
      const holder = completed ? grave : "greek-battlefield";
      const savedHoney = {
        holder,
        history: ["Vale leaves Honey as an offering."],
      };
      world.packs[greek].revision = 42;
      world.usedUp = world.usedUp.filter((id) => id !== honey);
      world.items[honey] = savedHoney;
      if (completed) world.placeMet = { [grave]: [honey] };
      else world.placeCard = { [grave]: honey };
      const loaded = decodeSave(JSON.stringify(world));
      expect(loaded.items[honey]).toEqual(savedHoney);
      expect(loaded.placeCard?.[grave]).toBeUndefined();
      expect(loaded.placeMet?.[grave]).toBeUndefined();
      expect(loaded.packs[greek].receipts).toEqual(world.packs[greek].receipts);
      expect(decodeSave(encodeSave(loaded)).items[honey]).toEqual(savedHoney);
    }
  });
});
