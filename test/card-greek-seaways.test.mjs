import { readFileSync } from "node:fs";
import vm from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import {
  decodeSave,
  encodeSave,
  exits,
  legalActions,
  play,
  plan,
} from "../v2/card-game/world.mjs";
import { packDefinition, transports } from "../v2/card-game/pack-registry.mjs";
import { legacyGreekSeaPaths } from "../v2/card-game/legacy-greek-seaways.mjs";
import { passengers } from "../v2/card-game/pack-transport.mjs";
import { authoredRouteEdges } from "../v2/card-game/roaming-routes.mjs";

const pack = packDefinition("greek-drama");
const interpreter = vm.createContext({});
vm.runInContext(
  readFileSync(
    new URL(
      "../v2/orchestrator-rust/src/card_shared/engine-v20.js",
      import.meta.url,
    ),
    "utf8",
  ),
  interpreter,
);
function old(request) {
  const result = JSON.parse(interpreter.cardShared(JSON.stringify(request)));
  expect(result.ok, result.error).toBe(true);
  return result;
}
function oldPlay(world, fields, actor = "vale") {
  const options = old({
    op: "view",
    world,
    actor,
    claimed: ["vale", ...(actor === "vale" ? [] : [actor])],
  }).actions;
  const action = options.find((a) =>
    Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  expect(action, JSON.stringify(fields)).toBeTruthy();
  return old({
    op: "play",
    world,
    actor,
    claimed: ["vale", ...(actor === "vale" ? [] : [actor])],
    action,
  }).world;
}
function releasedVisit(from, to, account, actor = "vale") {
  let world = old({ op: "create" }).world;
  delete world.opening;
  world.packs[pack.id].scope = "full";
  world.actors.vale.place = "greek-harbor";
  world = old({ op: "validate", world }).world;
  if (account) world = oldPlay(world, { choiceId: `greek-helen-${account}` });
  world.actors[actor].place = from;
  world = old({
    op: "validate",
    world,
    actor,
    claimed: ["vale", ...(actor === "vale" ? [] : [actor])],
  }).world;
  world = oldPlay(world, { kind: "move", target: to }, actor);
  expect(world.actors[actor].place).toBe(to);
  return old({
    op: "validate",
    world,
    actor,
    claimed: ["vale", ...(actor === "vale" ? [] : [actor])],
  }).world;
}
function step(world, kind, target, actor = "vale") {
  const action = legalActions(world, actor).find(
    (a) => a.kind === kind && (!target || a.target === target),
  );
  expect(action, `${actor}: ${kind} ${target || ""}`).toBeTruthy();
  const result = play(world, action, world.revision, actor);
  expect(result.ok, result.error).toBe(true);
  return decodeSave(encodeSave(result.state));
}
function board(world, actor = "vale") {
  for (
    let n = 0;
    n < 24 &&
    !legalActions(world, actor).some(
      (a) => a.kind === "move" && a.target === "greek-ship",
    );
    n++
  )
    world = step(world, "wait", null, actor);
  return step(world, "move", "greek-ship", actor);
}
function twoShoreVoyage() {
  let world = decodeSave(
    JSON.stringify(releasedVisit("greek-harbor", "greek-egypt-tomb", "egypt")),
  );
  world.controlledActors = ["vale", "mara"];
  world.presentActors = ["vale", "mara"];
  world.actors.mara.place = "greek-book-iv-helen-landing";
  world = decodeSave(encodeSave(world));
  world = step(world, "move", "greek-book-iv-helen-landing");
  world = board(world);
  world = board(world, "mara");
  for (const actor of ["vale", "mara"])
    world = step(world, "move", "greek-sicily-shore", actor);
  world = board(world, "mara");
  world = step(world, "move", "pond", "mara");
  return world;
}
function savedSoloLeg() {
  let world = step(twoShoreVoyage(), "wait");
  // A saved leg from the earlier planner can leave its goal's owner ashore.
  world.actors.moth.place = "greek-ship";
  world.transports["greek-ship"].destination = "pond";
  return decodeSave(encodeSave(world));
}

afterEach(() => new Promise((resolve) => setImmediate(resolve)));

const visits = [
  ["Aulis", "greek-gate", "greek-aulis", "greek-aulis"],
  ["Lemnos", "greek-greek-camp", "greek-lemnos", "greek-lemnos-landing"],
  ["Thrace", "greek-troy", "greek-thrace", "greek-thrace"],
  [
    "Egypt",
    "greek-harbor",
    "greek-egypt-tomb",
    "greek-book-iv-helen-landing",
    "egypt",
  ],
  [
    "Troy beach",
    "greek-harbor",
    "greek-troy-beach",
    "greek-ajax-landing",
    "troy",
  ],
  ["Tauris", "greek-piraeus", "greek-tauris", "greek-tauris-shore"],
  ["Sicily", "greek-piraeus", "greek-sicily", "greek-sicily-shore"],
  ["Trojan camp", "greek-aulis", "greek-greek-camp", "greek-ajax-landing"],
];
describe("the eleven-port Greek seaways", { timeout: 60000 }, () => {
  it("keeps the original five ports and puts every remaining landing on the same ship", () => {
    expect(transports["greek-ship"].docks).toHaveLength(11);
    expect(transports["greek-ship"].docks.slice(0, 5)).toEqual([
      "pond",
      "greek-harbor",
      "greek-athens-harbor",
      "greek-piraeus",
      "greek-ajax-landing",
    ]);
    for (const id of [
      "greek-aulis",
      "greek-lemnos-landing",
      "greek-thrace",
      "greek-book-iv-helen-landing",
      "greek-tauris-shore",
      "greek-sicily-shore",
    ])
      expect(transports["greek-ship"].docks).toContain(id);
    for (const path of legacyGreekSeaPaths) {
      const edges = new Set(
        authoredRouteEdges().map((edge) => JSON.stringify(edge)),
      );
      for (let index = 1; index < path.length; index++) {
        expect(edges.has(JSON.stringify([path[index - 1], path[index]]))).toBe(
          true,
        );
        expect(edges.has(JSON.stringify([path[index], path[index - 1]]))).toBe(
          true,
        );
      }
      const [a, b] = [path[0], path.at(-1)];
      expect(pack.places[a].exits).not.toContain(b);
      expect(pack.places[b].exits).not.toContain(a);
      expect(
        pack.routes.some(
          (r) => (r.from === a && r.to === b) || (r.from === b && r.to === a),
        ),
      ).toBe(false);
    }
  });
  it.each(visits)(
    "continues a validated rules-20 %s visit through a real voyage and reload",
    (_name, from, shore, landing, account) => {
      const before = releasedVisit(from, shore, account);
      let world = decodeSave(JSON.stringify(before));
      expect(world.actors.vale.place).toBe(shore);
      expect(world.log).toEqual(before.log);
      expect(world.transports).toEqual(before.transports);
      expect(world.knowledge).toEqual(before.knowledge);
      for (const [id, item] of Object.entries(before.items))
        expect(world.items[id]).toEqual(item);
      expect(world.crossings["pond-greek-harbor"].discovered).toBe(true);
      expect(exits(world, shore, "vale")).not.toContain(from);
      const retired = new Set(
        legacyGreekSeaPaths.flatMap((p) => [
          JSON.stringify([p[0], p.at(-1)]),
          JSON.stringify([p.at(-1), p[0]]),
        ]),
      );
      expect(
        Object.values(world.routeKnowledge)
          .flat()
          .some((edge) => retired.has(JSON.stringify(edge))),
      ).toBe(false);
      if (shore !== landing) world = step(world, "move", landing);
      world = board(world);
      expect(world.actors.vale.place).toBe("greek-ship");
      world = step(world, "move", "greek-harbor");
      world = step(world, "move", "greek-courtyard");
      expect(world.actors.vale.place).toBe("greek-courtyard");
      expect(decodeSave(encodeSave(world))).toEqual(world);
    },
  );
  it("restores the second human’s earlier Taurian visit without moving the ship", () => {
    const before = releasedVisit("greek-piraeus", "greek-tauris", null, "mara");
    let world = decodeSave(
      JSON.stringify({
        ...before,
        playerActorId: "mara",
        controlledActors: ["vale", "mara"],
        presentActors: ["mara"],
      }),
    );
    expect(world.transports).toEqual(before.transports);
    world = step(world, "move", "greek-tauris-shore", "mara");
    world = board(world, "mara");
    world = step(world, "move", "greek-harbor", "mara");
    expect(world.actors.mara.place).toBe("greek-harbor");
  });

  it("keeps Pip beside a shared quest item until its owner travels or gives custody", () => {
    let world = step(twoShoreVoyage(), "wait");
    expect(world.actors.moth.place).toBe("greek-sicily-shore");
    expect(world.items.lamp.holder).toBe("vale");
    for (let turn = 0; turn < 12; turn++) {
      expect(plan(world, "moth").action.target).not.toBe("greek-ship");
      world = step(world, "wait");
      expect(world.actors.moth.place).toBe("greek-sicily-shore");
      expect(world.actors.vale.place).toBe("greek-sicily-shore");
      expect(world.items.lamp.holder).toBe("vale");
      expect(passengers(world, "greek-ship")).toHaveLength(0);
    }
  });

  it("finishes a saved resident leg at its legal dock while its larger goal waits ashore", () => {
    let world = savedSoloLeg();
    const progress = structuredClone(world.actors.moth.progress);
    expect(plan(world, "moth").action).toMatchObject({
      kind: "move",
      target: "pond",
    });
    world = step(world, "talk", "greek-rhapsode");
    expect(world.actors.moth.place).toBe("pond");
    expect(world.actors.moth.progress).toEqual(progress);
    expect(world.actors.vale.place).toBe("greek-sicily-shore");
    expect(world.actors.mara.place).toBe("pond");
    expect(world.items.lamp.holder).toBe("vale");
    expect(world.transports["greek-ship"].dock).toBe("pond");
    expect(passengers(world, "greek-ship")).toHaveLength(0);
    expect(
      world.log.some(
        (e) =>
          e.actorId === "moth" && e.verb === "move" && e.targetId === "pond",
      ),
    ).toBe(true);
  });

  it("keeps the human’s port choice ahead of a resident’s saved leg", () => {
    let world = savedSoloLeg();
    const stale = plan(world, "moth").action;
    world = step(world, "move", "greek-ship");
    expect(world.actors.moth.place).toBe("greek-ship");
    expect(legalActions(world, "moth").some((a) => a.kind === "move")).toBe(
      false,
    );
    expect(play(world, stale, world.revision, "moth").ok).toBe(false);
    const ship = structuredClone(world.transports["greek-ship"]);
    world = step(world, "wait", null, "mara");
    expect(world.transports["greek-ship"]).toEqual(ship);
    expect(world.actors.moth.place).toBe("greek-ship");
    expect(world.actors.vale.place).toBe("greek-ship");
    world = step(world, "move", "greek-athens-harbor");
    expect(world.actors.vale.place).toBe("greek-athens-harbor");
    expect(world.actors.moth.place).toBe("greek-athens-harbor");
    expect(world.actors.mara.place).toBe("pond");
    expect(world.transports["greek-ship"].dock).toBe("greek-athens-harbor");
  });

  it("lets Pip sail alone after an actual gift puts the needed lamp in his custody", () => {
    let world = step(twoShoreVoyage(), "wait");
    const gift = legalActions(world, "vale").find(
      (a) => a.kind === "give" && a.item === "lamp" && a.target === "moth",
    );
    expect(gift).toBeDefined();
    const given = play(world, gift, world.revision, "vale");
    expect(given.ok, given.error).toBe(true);
    world = decodeSave(encodeSave(given.state));
    for (let turn = 0; turn < 12 && world.actors.moth.place !== "pond"; turn++)
      world = step(world, "wait");
    expect(world.items.lamp.holder).toBe("moth");
    expect(world.actors.moth.place).toBe("pond");
    expect(world.actors.vale.place).toBe("greek-sicily-shore");
    expect(world.actors.mara.place).toBe("pond");
    expect(passengers(world, "greek-ship")).toHaveLength(0);
    expect(
      world.log
        .filter((e) => e.actorId === "moth" && e.verb === "move")
        .map((e) => e.targetId),
    ).toEqual(expect.arrayContaining(["greek-ship", "pond"]));
  });

  it("makes the actual eleven-stop empty circuit through committed waits and reloads", () => {
    let world = twoShoreVoyage();
    expect(passengers(world, "greek-ship").length).toBeGreaterThan(0);
    for (
      let turn = 0;
      turn < 24 && passengers(world, "greek-ship").length;
      turn++
    )
      world = step(world, "wait");
    expect(world.actors.moth.place).toBe("greek-sicily-shore");
    expect(passengers(world, "greek-ship")).toHaveLength(0);
    world = step(world, "wait", null, "mara");
    expect(world.transports["greek-ship"].dock).toBe("pond");
    expect(passengers(world, "greek-ship")).toHaveLength(0);
    const visited = [world.transports["greek-ship"].dock];
    for (
      let index = 1;
      index < transports["greek-ship"].docks.length;
      index++
    ) {
      expect(passengers(world, "greek-ship")).toHaveLength(0);
      world = step(world, "wait");
      expect(passengers(world, "greek-ship")).toHaveLength(0);
      visited.push(world.transports["greek-ship"].dock);
      expect(world.actors.vale.place).toBe("greek-sicily-shore");
      expect(world.actors.mara.place).toBe("pond");
    }
    expect(visited).toEqual(transports["greek-ship"].docks);
    const arrived = structuredClone(world.transports["greek-ship"]);
    world = step(world, "wait");
    expect(world.transports["greek-ship"]).toEqual(arrived);
    world = step(world, "wait", null, "mara");
    expect(world.transports["greek-ship"].dock).toBe("pond");
    expect(decodeSave(encodeSave(world))).toEqual(world);
  });
});
