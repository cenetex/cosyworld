import { packDefinition as currentPackDefinition } from "../v2/card-game/pack-registry.mjs";
const willowsItems = Object.fromEntries(
  Object.entries(currentPackDefinition("willows").items).map(([id, item]) => [
    id,
    { holder: item.holder, history: [] },
  ]),
);
const ajaxItems = Object.fromEntries(
  Object.entries(currentPackDefinition("greek-drama").items)
    .filter(([id]) => id.startsWith("greek-ajax-"))
    .map(([id, item]) => [id, { holder: item.holder, history: [] }]),
);
const bookTwoItems = Object.fromEntries(
  Object.entries(currentPackDefinition("greek-drama").items)
    .filter(([id]) =>
      [
        "greek-danaid-",
        "greek-alcestis-",
        "greek-heracles-",
        "greek-trachis-",
      ].some((prefix) => id.startsWith(prefix)),
    )
    .map(([id, item]) => [id, { holder: item.holder, history: [] }]),
);
import { entityActive } from "../v2/card-game/pack-registry.mjs";
import { greekTravelTargets } from "./helpers/greek-travel.mjs";
import hoppycat from "../v2/content/hoppycat-archive/card-world.json" with { type: "json" };
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import { availableCards } from "../v2/card-game/cards.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { openingFixture } from "./helpers/greek-opening.mjs";
import { playOpenDoor, openDoorWalk } from "./helpers/open-door.mjs";
import {
  agoraVisitors,
  agoraView,
  crowdedAgoraWorld,
} from "./helpers/greek-capacity.mjs";

const paths = [
  ["eleusis", "piraeus", "harbor"],
  ["piraeus", "harbor"],
  ["colonus", "eleusis", "piraeus", "harbor"],
  ["marathon", "colonus", "eleusis", "piraeus", "harbor"],
];

describe("roads around a full Agora", () => {
  it.each(paths.map((path) => [path[0], path]))(
    "reaches the harbor from %s with four people in Agora",
    (_place, path) => {
      let world = crowdedAgoraWorld();
      world.actors.vale.place = `greek-${path[0]}`;
      const expanded = [];
      let from = world.actors.vale.place;
      for (const next of path.slice(1)) {
        const to = `greek-${next}`;
        expanded.push(...greekTravelTargets(from, to));
        from = to;
      }
      for (const next of expanded) {
        for (
          let n = 0;
          n < 32 &&
          next === "greek-ship" &&
          !agoraView(world).actions.some(
            (a) => a.kind === "move" && a.target === next,
          );
          n++
        ) {
          const waiting = agoraView(world);
          const action = waiting.actions.find((a) => a.kind === "wait");
          const result = dispatchShared({
            op: "play",
            world,
            actor: "vale",
            claimed: agoraVisitors,
            present: agoraVisitors,
            action,
          });
          expect(result.ok).toBe(true);
          world = result.world;
        }
        const view = agoraView(decodeSave(encodeSave(world)));
        expect(view.world.presentActors).toHaveLength(5);
        expect(view.exits).not.toContain("greek-athens");
        expect(availableCards(view.world)).not.toContain("greek-athens");
        const action = view.actions.find(
          (a) => a.kind === "move" && a.target === next,
        );
        expect(action).toBeDefined();
        const moved = dispatchShared({
          op: "play",
          world,
          actor: "vale",
          claimed: agoraVisitors,
          present: agoraVisitors,
          action,
        });
        expect(moved.ok).toBe(true);
        world = moved.world;
      }
      expect(world.actors.vale.place).toBe("greek-harbor");
      for (const actor of agoraVisitors.slice(1))
        expect(world.actors[actor].place).toBe("greek-athens");
    },
  );

  it("rejects a stale Agora move and restores the road when someone leaves", () => {
    const world = crowdedAgoraWorld();
    world.actors.vale.place = "greek-road-athens-eleusis";
    const alone = agoraView(world, ["vale"]);
    const action = alone.actions.find(
      (a) => a.kind === "move" && a.target === "greek-athens",
    );
    const rejected = dispatchShared({
      op: "play",
      world,
      actor: "vale",
      claimed: agoraVisitors,
      present: agoraVisitors,
      action,
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.world.actors.vale.place).toBe("greek-road-athens-eleusis");
    expect(rejected.world.turn).toBe(world.turn);
    const present = agoraVisitors.filter((id) => id !== "tavi");
    const reopened = agoraView(world, present);
    expect(reopened.exits).toContain("greek-athens");
    const moved = dispatchShared({
      op: "play",
      world,
      actor: "vale",
      claimed: agoraVisitors,
      present,
      action,
    });
    expect(moved.ok).toBe(true);
    expect(moved.world.actors.vale.place).toBe("greek-athens");
  });

  it("keeps the new harbor road behind Dione's accepted invitation", () => {
    let closed = openingFixture("refusal").closed;
    closed = openDoorWalk(closed, "harbor");
    const hosted = dispatchShared({
      op: "create",
      save: encodeSave(closed),
    }).world;
    expect(
      agoraView(decodeSave(encodeSave(hosted)), ["vale"]).exits,
    ).not.toContain("greek-piraeus");
    const open = crowdedAgoraWorld();
    open.actors.vale.place = "greek-ship";
    open.transports["greek-ship"] = {
      version: 2,
      dock: "greek-harbor",
      destination: "pond",
      recall: null,
    };
    expect(agoraView(decodeSave(encodeSave(open))).exits).toContain(
      "greek-piraeus",
    );
  });
});

describe("the side roads in earlier saved worlds", () => {
  it.each([false, true])(
    "preserves the invitation in a version-11 world (open=%s)",
    (open) => {
      const context = vm.createContext({});
      vm.runInContext(
        readFileSync(
          new URL(
            "../v2/orchestrator-rust/src/card_shared/engine-v11.js",
            import.meta.url,
          ),
          "utf8",
        ),
        context,
      );
      const released = (request) => {
        const result = JSON.parse(context.cardShared(JSON.stringify(request)));
        expect(result.ok, result.error).toBe(true);
        return result;
      };
      let world = released({ op: "create" }).world;
      delete world.opening;
      world.actors.vale.place = "greek-courtyard";
      const steps = [
        ["move", "greek-gate"],
        ["choose", "greek-hear-decree"],
        ["choose", "greek-decline-burial"],
        ["move", "greek-courtyard"],
        ["choose", "greek-courtyard-refusal"],
        ...(open ? [["choose", "greek-open-door-invite-refusal"]] : []),
        ["move", "greek-harbor"],
      ];
      for (const [kind, id] of steps) {
        const req = {
          world,
          actor: "vale",
          claimed: ["vale"],
          present: ["vale"],
        };
        const action = released({ ...req, op: "view" }).actions.find(
          (a) =>
            a.kind === kind &&
            (kind === "move" ? a.target === id : a.choiceId === id),
        );
        expect(action).toBeDefined();
        world = released({ ...req, op: "play", action }).world;
      }
      expect(world.packs["greek-drama"].revision).toBe(3);
      const restored = decodeSave(JSON.stringify(world));
      expect(restored.packs["greek-drama"].revision).toBe(8);
      for (const key of ["choices", "flags", "receipts", "recitals"])
        expect(restored.packs["greek-drama"][key]).toEqual(
          world.packs["greek-drama"][key],
        );
      expect(restored.items).toEqual({
        ...world.items,
        ...willowsItems,
        ...ajaxItems,
        ...bookTwoItems,
        "boardyai-calling-card": { holder: "pond", history: [] },
        ...Object.fromEntries(
          Object.entries(hoppycat.items).map(([id, item]) => [
            id,
            { holder: item.holder, history: [] },
          ]),
        ),
        "forest-story-button": { holder: "forest-cottage", history: [] },
        "forest-dewbright-button": { holder: "forest-garden", history: [] },
        "forest-watch-bell": { holder: "forest-garden", history: [] },
        "forest-wolfprint-charm": { holder: "forest-trail", history: [] },
      });
      expect(restored.log).toEqual(world.log);
      expect(restored.actors["greek-household-witness"].place).toBe(
        "greek-eleusis",
      );
      const view = agoraView(restored, ["vale"]);
      expect(entityActive(restored, "greek-piraeus")).toBe(open);
      expect(decodeSave(encodeSave(restored))).toEqual(restored);
    },
  );
});
