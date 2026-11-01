import { describe, expect, it } from "vitest";
import { encodeSave, decodeSave } from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { learnLane } from "../v2/card-game/pack-transport.mjs";
import { openDoorAction, playOpenDoor } from "./helpers/open-door.mjs";
import { homecomingJourney, myrineSteps } from "./helpers/greek-homecoming.mjs";

const flag = (world, key) =>
  world.packs["greek-drama"].flags[`greek-homecoming-${key}`];
const shared = (
  world,
  actor = "vale",
  present = ["vale", "mara"],
  extra = {},
) =>
  dispatchShared({
    op: "view",
    world,
    actor,
    claimed: ["vale", "mara"],
    present,
    ...extra,
  });

const receive = "greek-homecoming-receive-family";
const receipt = (world, id) => world.packs["greek-drama"].receipts[id];

describe("the household reaches its berth", () => {
  it("plays the household's care with real travel and custody", () => {
    const { world, before, after } = homecomingJourney();
    const receiving = before[receive];
    expect(receiving.actors.vale.place).toBe("greek-piraeus");
    expect(receiving.actors["greek-household-witness"].place).toBe(
      "greek-piraeus",
    );
    expect(receiving.items["greek-return-list"].holder).toBe("greek-piraeus");
    expect(after[receive].items["greek-provision-basket"].holder).toBe(
      "greek-household-witness",
    );
    const travel = receiving.log.filter(
      (entry) =>
        entry.verb === "accompany" &&
        entry.targetId === "greek-household-witness",
    );
    expect(travel).toHaveLength(myrineSteps.length);
    expect(travel.every((entry) => entry.accepted)).toBe(true);
    expect(flag(world, "arrived")).toBe(true);
    expect(flag(world, "witness-heard")).toBe(true);
    expect(world.items["greek-return-list"].holder).toBe("greek-courtyard");
    expect(decodeSave(encodeSave(world))).toEqual(world);
  });

  it("waits for the list at the quay before Myrine's arrival counts", () => {
    let world = homecomingJourney().before[receive];
    // The witness has just met a want, so it rests and leaves the basket be.
    const witness = world.actors["greek-household-witness"];
    witness.want = null;
    witness.metTurn = world.turn;
    world = playOpenDoor(world, "take", { item: "greek-return-list" });
    world = playOpenDoor(world, "give", {
      item: "greek-provision-basket",
      target: "greek-household-witness",
    });
    expect(receipt(world, receive)).toBeUndefined();
    world = playOpenDoor(world, "drop", {
      item: "greek-return-list",
      target: "greek-piraeus",
    });
    expect(receipt(world, receive)).toBe(world.turn);
    expect(flag(world, "arrived")).toBe(true);
  });

  it("lets a later human finish the agreed journey across a leave and reload", () => {
    const agreed = homecomingJourney().after["greek-homecoming-agree-journey"];
    let world = dispatchShared({
      op: "create",
      save: encodeSave(agreed),
    }).world;
    world.actors.mara.place = "greek-eleusis";
    world = decodeSave(encodeSave(world));
    const later = shared(world, "mara", ["mara"]);
    let result;
    for (const destination of myrineSteps) {
      const view = shared(world, "mara", ["mara"]);
      const next = openDoorAction(view.world, "accompany", {
        target: "greek-household-witness",
        destination,
      });
      result = shared(world, "mara", ["mara"], { op: "play", action: next });
      expect(result.ok).toBe(true);
      world = decodeSave(encodeSave(result.world));
    }
    expect(result.world.actors.mara.place).toBe("greek-piraeus");
    expect(result.world.actors.vale.place).toBe("greek-eleusis");
    expect(result.world.actors["greek-household-witness"].place).toBe(
      "greek-piraeus",
    );
    expect(
      shared(result.world).world.actors["greek-household-witness"].place,
    ).toBe("greek-piraeus");
  });

  it("credits the traveler who brings the signed account without changing the earlier author's verses", () => {
    const prior = homecomingJourney().after[receive];
    let world = dispatchShared({ op: "create", save: encodeSave(prior) }).world;
    world.actors.mara.place = "greek-piraeus";
    // Mara has heard the lane home from Piraeus.
    learnLane(world, "mara", "greek-piraeus", "greek-harbor");
    for (const [kind, fields] of [
      ["take", { item: "greek-return-list" }],
      ["board", {}],
      ["course", { target: "greek-harbor" }],
      ["wait", {}],
      ["move", { target: "greek-harbor" }],
      ["move", { target: "greek-road-thebes" }],
      ["move", { target: "greek-courtyard" }],
      ["give", { item: "greek-return-list", target: "greek-baker" }],
    ]) {
      if (kind === "board") {
        // Wait at Piraeus until the ship calls, then go aboard.
        for (let turn = 0; turn < 12; turn += 1) {
          const view = shared(world, "mara", ["mara"]);
          let board = null;
          try {
            board = openDoorAction(view.world, "move", {
              target: "greek-ship",
            });
          } catch {
            board = null;
          }
          const next = board || openDoorAction(view.world, "wait", {});
          const result = shared(world, "mara", ["mara"], {
            op: "play",
            action: next,
          });
          expect(result.ok).toBe(true);
          world = result.world;
          if (board) break;
        }
        expect(world.actors.mara.place).toBe("greek-ship");
        continue;
      }
      const view = shared(world, "mara", ["mara"]);
      const action = openDoorAction(view.world, kind, fields);
      const result = shared(world, "mara", ["mara"], { op: "play", action });
      expect(result.ok).toBe(true);
      world = result.world;
    }
    const recital = world.packs["greek-drama"].recitals;
    expect(recital["greek-homecoming-report-piraeus-family"].actor).toBe(
      "mara",
    );
    expect(recital["greek-homecoming-receive-family"].actor).toBe("vale");
    // The Bard may have sung it since; its author stays the same.
    expect(recital["greek-open-door-family-berth"].actor).toBe(
      prior.packs["greek-drama"].recitals["greek-open-door-family-berth"].actor,
    );
    expect(world.items["greek-return-list"].holder).toBe("greek-courtyard");
    expect(
      shared(decodeSave(encodeSave(world)), "mara").actions.some(
        (a) => a.kind === "give" && a.item === "greek-return-list",
      ),
    ).toBe(false);
  });
});
