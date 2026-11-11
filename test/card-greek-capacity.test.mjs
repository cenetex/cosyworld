import { packDefinition as currentPackDefinition } from "../v2/card-game/pack-registry.mjs";
const willowsItems = Object.fromEntries(
  Object.entries(currentPackDefinition("willows").items).map(([id, item]) => [
    id,
    { holder: item.holder, history: [] },
  ]),
);
// Rules 95 brought figs, a wine skin and libation wine to Greek worlds.
const ajaxItems = Object.fromEntries(
  Object.entries(currentPackDefinition("greek-drama").items)
    .filter(
      ([id]) =>
        id.startsWith("greek-ajax-") ||
        ["greek-figs", "greek-wine-skin", "greek-libation"].includes(id),
    )
    .map(([id, item]) => [id, { holder: item.holder, history: [] }]),
);
// Greek revision 20: Creon holds his writ, and Dione her wheat, when an
// earlier world first gains them.
const decreeItems = Object.fromEntries(
  ["greek-creon-writ", "greek-wheat"].map((id) => [
    id,
    {
      holder: currentPackDefinition("greek-drama").items[id].holder,
      history: [],
    },
  ]),
);
import { greekTravelTargets } from "./helpers/greek-travel.mjs";
import { describe, expect, it } from "vitest";
import { decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import { availableCards } from "../v2/card-game/cards.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { openDoorStart, openDoorWalk } from "./helpers/open-door.mjs";
import {
  agoraVisitors,
  agoraView,
  crowdedAgoraWorld,
} from "./helpers/greek-capacity.mjs";
import { stowProvisions } from "./helpers/provisions.mjs";

// The countryside reaches the harbour only through the city, so only Piraeus
// reaches the harbor without passing through the Agora.
const paths = [["piraeus", "harbor"]];

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
        // Vale knows no lane from Piraeus, so she waits aboard until the idle
        // ship sails its first lane, to the Wine-Dark Harbor.
        for (
          let n = 0;
          n < 8 &&
          world.actors.vale.place === "greek-ship" &&
          !agoraView(world).actions.some(
            (a) => a.kind === "move" && a.target === next,
          );
          n++
        ) {
          const actions = agoraView(world).actions;
          const action =
            actions.find((a) => a.kind === "course" && a.target === next) ||
            actions.find((a) => a.kind === "wait");
          {
            world = dispatchShared({
              op: "play",
              world,
              actor: "vale",
              claimed: agoraVisitors,
              present: agoraVisitors,
              action,
            }).world;
          }
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
    world.actors.vale.place = "greek-road-athens-piraeus";
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
    expect(rejected.world.actors.vale.place).toBe("greek-road-athens-piraeus");
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
    let closed = openDoorStart();
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
    // Packed Travel Provisions ride on deck, which opens the Piraeus lane.
    stowProvisions(open, "greek-ship");
    open.transports["greek-ship"] = {
      version: 3,
      phase: "docked",
      dock: "greek-harbor",
      destination: null,
      riders: [],
      since: open.turn,
      recall: null,
    };
    expect(agoraView(decodeSave(encodeSave(open))).exits).toContain(
      "greek-piraeus",
    );
  });
});
