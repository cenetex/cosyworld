import { atticOpening } from "./fixtures/card-attic-opening.mjs";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, it, expect } from "vitest";
import {
  createWorld,
  plan,
  decodeSave,
  encodeSave,
  exits,
  legalActions,
} from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import {
  packDefinition,
  entityActive,
  localRoadEnds,
  transports,
} from "../v2/card-game/pack-registry.mjs";
import { travelCard } from "../v2/card-game/scene.mjs";
import {
  lanePath,
  lanesFrom,
  laneGated,
  learnLane,
} from "../v2/card-game/pack-transport.mjs";
import { openDoorStart, openSeas } from "./helpers/open-door.mjs";
import { upgradedActor, upgradedItems } from "./fixtures/card-upgraded-items.mjs";

const docks = ["pond", "greek-harbor", "greek-piraeus"];
const players = ["vale", "mara"];
const pack = packDefinition("greek-drama");
function shared(dock, seas = false) {
  // After the plea at the Agora the petition and the olive branch rest
  // there, so both Athenian gates stand open.
  const world = dispatchShared({
    op: "create",
    save: encodeSave(
      seas
        ? openSeas()
        : createWorld({ packScopes: { "greek-drama": "full" } }),
    ),
  }).world;
  world.crossings["pond-greek-harbor"].discovered = true;
  // The ship lies empty at the dock, whatever errand it was on.
  Object.assign(world.transports["greek-ship"], {
    phase: "docked",
    dock: docks.includes(dock) ? dock : "greek-harbor",
    destination: null,
    riders: [],
    since: world.turn,
    recall: null,
  });
  for (const actor of Object.values(world.actors))
    if (actor.place === "greek-ship")
      actor.place = world.transports["greek-ship"].dock;
  for (const id of players) world.actors[id].place = dock;
  // Residents' errands (BoardyAI's introductions, a rhapsode bound for
  // Athens Harbor) are tested on their own; here nobody calls the ship.
  for (const [id, actor] of Object.entries(world.actors))
    if (!players.includes(id)) actor.want = null;
  // These travellers have heard every lane from Myrto.
  const ship = transports["greek-ship"];
  for (const id of players)
    for (const from of ship.docks)
      for (const to of lanesFrom(ship, from)) learnLane(world, id, from, to);
  // The Travel Provisions ride on deck, which opens the Wine-Dark Harbor's
  // lane to Piraeus.
  world.items["greek-provisions"].holder = "greek-ship";
  return world;
}
const ask = (world, actor, extra = {}) =>
  dispatchShared({
    world,
    actor,
    op: "view",
    claimed: players,
    present: players,
    ...extra,
  });
function play(world, actor, kind, fields) {
  // A standoff locks the room; the walkthrough talks its way out first.
  const fight = world.standoffs.find(
    (c) => c.location === world.actors[actor].place,
  );
  const party =
    fight &&
    players.find((id) => [fight.challenger, fight.defender].includes(id));
  if (party && kind !== "talk")
    world = play(world, party, "talk", {
      target: fight.challenger === party ? fight.defender : fight.challenger,
    });
  const action = ask(world, actor).actions.find(
    (a) =>
      a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  expect(action, `${actor}: ${kind} ${JSON.stringify(fields)}`).toBeDefined();
  const result = ask(world, actor, { op: "play", action });
  expect(result.ok, result.error).toBe(true);
  return decodeSave(encodeSave(result.world));
}
const move = (w, actor, target) => play(w, actor, "move", { target });

describe("Greek ports and fixed roads", () => {
  it.each(
    docks.flatMap((from) =>
      docks.filter((to) => to !== from).map((to) => [from, to]),
    ),
  )(
    "carries two travelers from %s to %s through the shared ship",
    (from, to) => {
      let w = shared(from, true);
      w.items.lamp.holder = "vale";
      w = move(w, "vale", "greek-ship");
      w = move(w, "mara", "greek-ship");
      // Course cards are the boarding port's lanes, never the port itself.
      // By day the Willows mist does not rise beside the rail.
      expect(ask(w, "vale").exits).toEqual([
        // The Signal Jetty waits for a Hoppy Cat thing aboard; the
        // provisions on deck open the Wine-Dark Harbor to Piraeus lane.
        ...lanesFrom(transports["greek-ship"], from).filter(
          (d) =>
            entityActive(w, d) &&
            (!laneGated(from, d) || d !== "hoppycat-signal-jetty"),
        ),
      ]);
      const path = lanePath(w, "greek-ship", from, to);
      for (const lane of path.slice(1)) {
        const stale = ask(w, "mara").actions.find(
          (a) => a.kind === "course" && a.target !== lane,
        );
        w = play(w, "vale", "course", { target: lane });
        if (stale)
          expect(ask(w, "mara", { op: "play", action: stale }).ok).toBe(false);
        expect(ask(w, "mara").exits).toEqual([]);
        w = play(w, "mara", "wait", {});
        expect(w.transports["greek-ship"]).toMatchObject({
          phase: "arrived",
          dock: lane,
        });
      }
      expect(ask(w, "mara").exits).toContain(to);
      w = move(w, "vale", to);
      expect(ask(w, "mara").exits).toContain(to);
      w = move(w, "mara", to);
      expect(w.transports["greek-ship"]).toMatchObject({
        dock: to,
        destination: null,
        recall: null,
      });
      expect(w.items.lamp.holder).toBe("vale");
      expect(w.actors.vale.place).toBe(to);
      expect(w.actors.mara.place).toBe(to);
    },
  );

  it("opens both new port stops with Dione's invitation", () => {
    const before = atticOpening();
    before.actors.vale.place = "greek-ship";
    before.transports["greek-ship"].destination = "pond";
    expect(exits(before, "greek-ship", "vale")).toEqual(["pond"]);
    const after = openDoorStart();
    // Athens Harbor has joined Piraeus, whose Long Walls lead to the city.
    expect(entityActive(after, "greek-athens-harbor")).toBe(false);
    expect(entityActive(after, "greek-road-athens-piraeus")).toBe(true);
    expect(exits(after, "greek-piraeus", "vale")).toEqual([
      "greek-road-athens-piraeus",
    ]);
    expect(exits(after, "greek-harbor", "vale")).toContain("greek-road-thebes");
    expect(exits(after, "greek-harbor", "vale")).not.toContain(
      "greek-courtyard",
    );
    expect(exits(after, "greek-harbor", "vale")).not.toContain("greek-athens");
    expect(exits(after, "greek-harbor", "vale")).not.toContain("greek-piraeus");
  });

  it.each(
    Object.entries(pack.places).filter(
      ([id, p]) => p.road && !localRoadEnds(id),
    ),
  )(
    "keeps the two ends of %s in the same order from either direction",
    (id, road) => {
      for (const from of road.road) {
        // A gated road opens from its end once a story has opened it.
        let w = shared(
          from,
          pack.routes.some((r) => r.to === id),
        );
        const other = road.road.find((end) => end !== from);
        expect(travelCard(ask(w, "vale").world, id).name).toBe(
          `Road to ${pack.places[other].name}`,
        );
        w = move(w, "vale", id);
        expect(ask(w, "vale").exits).toEqual(road.road);
        w = move(w, "mara", id);
        expect(w.actors.mara.place).toBe(w.actors.vale.place);
        w = move(w, "vale", other);
        w = move(w, "mara", from);
        expect(w.actors.vale.place).toBe(other);
        expect(w.actors.mara.place).toBe(from);
      }
    },
  );

  const near = docks;
  it.each(near)("brings an empty ship to a traveler waiting at %s", (port) => {
    let w = shared(near.find((p) => p !== port));
    w.actors.vale.place = port;
    for (
      let n = 0;
      n < near.length && w.transports["greek-ship"].dock !== port;
      n++
    )
      w = play(w, "vale", "wait", {});
    expect(w.transports["greek-ship"].dock).toBe(port);
    w = move(w, "vale", "greek-ship");
    expect(w.actors.boardyai.place).toBe("boardyai-parlour");
    expect(w.actors.vale.place).toBe("greek-ship");
  });

  it("gives a human aboard the first choice of port ahead of resident passengers", () => {
    let w = shared("greek-harbor");
    w.actors.moth.place = "greek-ship";
    w = move(w, "vale", "greek-ship");
    expect(
      legalActions(ask(w, "vale").world, "moth").filter(
        (a) =>
          ["move", "course"].includes(a.kind) && a.target !== "willows-landing",
      ),
    ).toEqual([]);
    w = play(w, "vale", "course", { target: "greek-piraeus" });
    w = play(w, "vale", "wait", {});
    w = move(w, "vale", "greek-piraeus");
    expect(w.actors.moth.place).toBe("greek-piraeus");
    expect(w.actors.boardyai.place).toBe("boardyai-parlour");
    expect(w.transports["greek-ship"].destination).toBe(null);
  });

  it.each([13, 14, 15])(
    "upgrades a version %s voyage while preserving deeds, belongings and old memories",
    (version) => {
      const ctx = vm.createContext({});
      vm.runInContext(
        readFileSync(
          new URL(
            `../v2/orchestrator-rust/src/card_shared/engine-v${version}.js`,
            import.meta.url,
          ),
          "utf8",
        ),
        ctx,
      );
      const old = JSON.parse(
        ctx.cardShared(JSON.stringify({ op: "create" })),
      ).world;
      delete old.opening;
      old.actors.vale.place = "greek-ship";
      old.transports["greek-ship"] = {
        version: 2,
        dock: "pond",
        destination: "greek-harbor",
        recall: null,
      };
      const current = decodeSave(JSON.stringify(old));
      // Quest progress is dropped; each avatar gains its want record.
      const lived = ({ want, xp, visited, talked, metTurn, gaveUp, ...a }) => a;
      for (const [id, { progress, ...actor }] of Object.entries(old.actors))
        expect(lived(current.actors[id])).toEqual({
          ...upgradedActor(actor),
          trust: {
            ...actor.trust,
            ...Object.fromEntries(
              Object.keys(current.actors)
                .filter((added) => !old.actors[added])
                .map((added) => [added, 0]),
            ),
          },
        });
      expect(current.items).toMatchObject(upgradedItems(old.items));
      // The version 2 leg becomes a docked ship waiting for its course.
      expect(current.transports["greek-ship"]).toEqual({
        version: 3,
        phase: "docked",
        dock: "pond",
        destination: null,
        riders: [],
        since: current.turn,
        recall: null,
      });
      expect(current.packs["greek-drama"].revision).toBe(
        packDefinition("greek-drama").revision,
      );
      for (const [id, memory] of Object.entries(old.memories)) {
        const { seen, ...retained } = current.memories[id];
        expect(retained).toEqual(memory);
        if (seen) expect(typeof seen).toBe("object");
      }
      expect(decodeSave(encodeSave(current))).toEqual(current);
    },
  );
});
