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
} from "../v2/card-game/pack-registry.mjs";
import { travelCard } from "../v2/card-game/scene.mjs";
import { openDoorStart } from "./helpers/open-door.mjs";

const docks = ["pond", "greek-harbor", "greek-athens-harbor", "greek-piraeus"];
const players = ["vale", "mara"];
const pack = packDefinition("greek-drama");
function shared(dock) {
  const world = dispatchShared({
    op: "create",
    save: encodeSave(createWorld({ packScopes: { "greek-drama": "full" } })),
  }).world;
  world.crossings["pond-greek-harbor"].discovered = true;
  world.transports["greek-ship"].dock = docks.includes(dock)
    ? dock
    : "greek-harbor";
  for (const id of players) world.actors[id].place = dock;
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
      let w = shared(from);
      w.items.lamp.holder = "vale";
      w = move(w, "vale", "greek-ship");
      w = move(w, "mara", "greek-ship");
      expect(ask(w, "vale").exits).toEqual([
        "willows-landing",
        ...docks.filter((d) => d !== from),
      ]);
      const stale = ask(w, "mara").actions.find(
        (a) =>
          a.kind === "move" &&
          a.target === docks.find((d) => d !== from && d !== to),
      );
      w = move(w, "vale", to);
      expect(ask(w, "mara").exits).toEqual(["willows-landing", to]);
      expect(ask(w, "mara", { op: "play", action: stale }).ok).toBe(false);
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
    const before = createWorld({ opening: true });
    before.actors.vale.place = "greek-ship";
    before.transports["greek-ship"].destination = "pond";
    expect(exits(before, "greek-ship", "vale")).toEqual([
      "willows-landing",
      "pond",
    ]);
    const after = openDoorStart();
    expect(entityActive(after, "greek-athens-harbor")).toBe(true);
    expect(entityActive(after, "greek-road-athens-harbor")).toBe(true);
    expect(exits(after, "greek-harbor", "vale")).toContain("greek-road-thebes");
    expect(exits(after, "greek-harbor", "vale")).not.toContain("greek-athens");
    expect(exits(after, "greek-harbor", "vale")).not.toContain("greek-piraeus");
  });

  it.each(Object.entries(pack.places).filter(([, p]) => p.road))(
    "keeps the two ends of %s in the same order from either direction",
    (id, road) => {
      for (const from of road.road) {
        let w = shared(from);
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

  it.each(docks)("brings an empty ship to a traveler waiting at %s", (port) => {
    let w = shared(docks.find((p) => p !== port));
    w.actors.vale.place = port;
    for (
      let n = 0;
      n < docks.length && w.transports["greek-ship"].dock !== port;
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
    w.transports["greek-ship"].destination = "pond";
    w = move(w, "vale", "greek-ship");
    expect(
      legalActions(ask(w, "vale").world, "moth").filter(
        (a) => a.kind === "move",
      ),
    ).toEqual([]);
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
      for (const [id, actor] of Object.entries(old.actors))
        expect(current.actors[id]).toEqual({
          ...actor,
          trust: {
            ...actor.trust,
            ...Object.fromEntries(
              Object.keys(current.actors)
                .filter((added) => !old.actors[added])
                .map((added) => [added, 0]),
            ),
          },
        });
      expect(current.items).toMatchObject(old.items);
      expect(current.transports).toEqual(old.transports);
      expect(current.packs["greek-drama"].revision).toBe(5);
      for (const [id, memory] of Object.entries(old.memories)) {
        const { seen, ...retained } = current.memories[id];
        expect(retained).toEqual(memory);
        if (seen) expect(typeof seen).toBe("object");
      }
      expect(decodeSave(encodeSave(current))).toEqual(current);
    },
  );
});
