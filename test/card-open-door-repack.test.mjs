import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it } from "vitest";
import {
  decodeSave,
  encodeSave,
  legalActions,
} from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";

const base = "521c76cb39df10c2e552a9e2d88dc4a8d02d6fe9";
const dir = "v2/orchestrator-rust/src/card_shared/";
const prior = (name) =>
  execFileSync("git", ["show", `${base}:${dir}${name}`], {
    encoding: "utf8",
    maxBuffer: 64 << 20,
  });
const oldBundle = prior("engine-v137.js");
const oldContent = JSON.parse(prior("content.json"));
const now = (name) =>
  readFileSync(new URL(`../${dir}${name}`, import.meta.url), "utf8");
const version = /const VERSION: &str = "full-card-world\/(\d+)"/.exec(
  now("engine.rs"),
)[1];
const target = vm.createContext({
  structuredClone,
  cardContent: JSON.parse(now("content.json")),
});
vm.runInContext(now(`engine-v${version}.js`), target);
const hosted = (request) =>
  JSON.parse(target.cardShared(JSON.stringify(request)));

function source(place = "greek-eleusis", roaming = false) {
  const context = vm.createContext({
    structuredClone,
    cardContent: oldContent,
  });
  vm.runInContext(
    oldBundle.replace(
      "globalThis.cardShared = (json) => {",
      "globalThis.fixture = {createWorld, legalActions, play, validateWorld, worldLife}; globalThis.cardShared = (json) => {",
    ),
    context,
  );
  const rules = context.fixture;
  rules.worldLife.on = roaming;
  let world = rules.createWorld({
    seed: 7,
    packScopes: { "greek-drama": "full" },
  });
  world.actors.vale.place = place;
  world.actors.vale.visited.push(place);
  world.crossings["pond-greek-harbor"].discovered = true;
  world.items.lamp.lit = false;
  return {
    get world() {
      return world;
    },
    act(kind, fields = {}) {
      const action = rules
        .legalActions(world)
        .find(
          (a) =>
            a.kind === kind &&
            Object.entries(fields).every(([key, value]) => a[key] === value),
        );
      expect(action, `${kind} ${JSON.stringify(fields)}`).toBeTruthy();
      const result = rules.play(world, action, world.revision);
      expect(result.error).toBeUndefined();
      world = result.state;
      return world;
    },
    check() {
      rules.validateWorld(world);
      const loaded = decodeSave(JSON.stringify(world));
      const text = encodeSave(loaded);
      expect(encodeSave(decodeSave(text))).toBe(text);
      for (const field of ["receipts", "choices", "flags", "recitals"])
        expect(loaded.packs["greek-drama"][field]).toEqual(
          world.packs["greek-drama"][field],
        );
      expect(loaded.packs["greek-drama"].revision).toBe(
        packDefinition("greek-drama").revision,
      );
      const shared = JSON.parse(
        context.cardShared(
          JSON.stringify({ op: "create", save: world, seed: 7 }),
        ),
      );
      expect(shared.error).toBeUndefined();
      const request = {
        op: "upgrade",
        world: shared.world,
        from: "full-card-world/137",
        to: `full-card-world/${version}`,
      };
      const result = hosted(request);
      expect(result.error).toBeUndefined();
      expect(result).toEqual(dispatchShared(request));
      expect(
        hosted({ op: "validate", world: result.world }).error,
      ).toBeUndefined();
      return loaded;
    },
  };
}

it("keeps played Open Door receipts, knowledge and earned verses through Myrine's return", () => {
  const t = source();
  const act = (kind, fields) => t.act(kind, fields);
  const move = (...ids) =>
    ids.forEach((id) => act("move", { target: `greek-${id}` }));
  act("talk", { target: "greek-aethra" });
  expect(t.world.knowledge.facts["greek-open-door-hear-mothers"]).toBeTruthy();
  t.check();
  act("wait");
  act("take", { item: "greek-burial-petition" });
  move("road-athens-eleusis", "athens");
  act("give", { item: "greek-burial-petition", target: "greek-theseus" });
  act("talk", { target: "greek-theseus" });
  expect(
    t.world.packs["greek-drama"].recitals["greek-open-door-hear-truce-report"]
      .visit,
  ).toBeNull();
  expect(
    t.check().knowledge.facts["greek-open-door-hear-truce-report"],
  ).toBeUndefined();
  move("road-athens-piraeus", "piraeus");
  act("wait");
  act("take", { item: "greek-return-cloths" });
  t.check();
  move("road-athens-piraeus", "athens", "road-athens-eleusis", "eleusis");
  act("drop", { item: "greek-return-cloths", target: "greek-eleusis" });
  act("wait");
  act("take", { item: "greek-ash-urn" });
  act("give", { item: "greek-ash-urn", target: "greek-argive-mother" });
  act("take", { item: "greek-return-list" });
  act("take", { item: "greek-pyre-account" });
  move("road-athens-eleusis", "athens", "road-athens-piraeus", "piraeus");
  act("give", { item: "greek-return-list", target: "greek-quay-host" });
  move("road-athens-piraeus", "athens", "road-athens-eleusis", "eleusis");
  for (const destination of [
    "greek-road-athens-eleusis",
    "greek-athens",
    "greek-road-athens-piraeus",
    "greek-piraeus",
  ])
    act("accompany", { target: "greek-household-witness", destination });
  act("take", { item: "greek-provision-basket" });
  act("give", {
    item: "greek-provision-basket",
    target: "greek-household-witness",
  });
  act("take", { item: "greek-return-list" });
  expect(t.world.journeyProgress["greek-household-witness"].step).toBe(4);
  expect(
    t.world.packs["greek-drama"].recitals["greek-open-door-hear-truce-report"]
      .visit,
  ).not.toBeNull();
  const loaded = t.check();
  expect(loaded.journeyProgress["greek-household-witness"]).toBeUndefined();
  expect(loaded.actors["greek-household-witness"].place).toBe("greek-piraeus");
  expect(loaded.items["greek-return-list"]).toBeUndefined();
  expect(loaded.items["greek-pyre-account"]).toBeUndefined();
});

it.each([
  ["greek-return-cloths", "greek-piraeus"],
  ["greek-provision-basket", "greek-piraeus"],
  ["greek-grove-cup", "greek-colonus"],
  ["greek-grove-honey", "greek-colonus"],
])("releases a held retired thing after a real Take: %s", (item, place) => {
  const t = source(place);
  t.act("take", { item });
  expect(t.world.actors.vale.heldItem).toBe(item);
  const loaded = t.check();
  expect(loaded.items[item]).toBeUndefined();
  expect(loaded.actors.vale.heldItem).toBeNull();
});

it("reconciles new locks after unmet residents have wandered", () => {
  const t = source("attic", true);
  for (let turn = 0; turn < 60; turn++) t.act("wait");
  const pack = packDefinition("greek-drama");
  const moved = [
    "greek-aethra",
    "greek-theseus",
    "greek-adrastus",
    "greek-quay-host",
    "greek-colonus-keeper",
  ].filter((id) => t.world.actors[id].place !== pack.avatars[id].place);
  expect(moved.length).toBeGreaterThan(0);
  const loaded = t.check();
  for (const id of moved) {
    expect(loaded.actors[id].place).toBe(pack.avatars[id].place);
    expect(loaded.packs[pack.id].met[id]).toBeUndefined();
  }
});

it("keeps archived choices unavailable and rejects malformed or future revisions", () => {
  const t = source();
  t.act("talk", { target: "greek-aethra" });
  const loaded = t.check();
  const archived = new Set(
    packDefinition("greek-drama")
      .choices.filter((c) => c.archived)
      .map((c) => c.id),
  );
  expect(legalActions(loaded).some((a) => archived.has(a.choiceId))).toBe(
    false,
  );
  const future = packDefinition("greek-drama").revision + 1;
  for (const revision of [0, -1, 24.5, "24", future]) {
    const bad = structuredClone(loaded);
    bad.packs["greek-drama"].revision = revision;
    expect(() => decodeSave(JSON.stringify(bad))).toThrow(/fresh start/);
  }
  const badJourney = structuredClone(loaded);
  badJourney.journeyProgress["greek-household-witness"] = {
    agreement: "greek-homecoming-agree-journey",
    step: 4,
  };
  expect(() => decodeSave(JSON.stringify(badJourney))).toThrow(/fresh start/);
  const badHeld = structuredClone(loaded);
  badHeld.actors.vale.heldItem = "greek-return-cloths";
  expect(() => decodeSave(JSON.stringify(badHeld))).toThrow(
    "The held item is invalid.",
  );
});
