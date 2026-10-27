import { describe, expect, it } from "vitest";
import { decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import { availableCards } from "../v2/card-game/cards.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import {
  agoraVisitors,
  agoraView,
  crowdedAgoraWorld,
} from "./helpers/greek-capacity.mjs";

describe("the Agora shared crowd", () => {
  it("admits five humans across two places and waits at the full Agora", () => {
    const world = crowdedAgoraWorld();
    const alone = agoraView(world, ["vale"]);
    const crowded = agoraView(world);
    expect(crowded.world.presentActors).toHaveLength(5);
    expect(alone.exits).toContain("greek-athens");
    expect(crowded.exits).toEqual([]);
    expect(availableCards(crowded.world)).not.toContain("greek-athens");
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
    expect(rejected.world.actors.vale.place).toBe("greek-eleusis");
    expect(rejected.world.turn).toBe(world.turn);
  });

  it("restores the road when someone leaves and preserves it across reload", () => {
    const world = crowdedAgoraWorld();
    const present = agoraVisitors.filter((id) => id !== "tavi");
    const reopened = agoraView(decodeSave(encodeSave(world)), present);
    expect(reopened.exits).toContain("greek-athens");
    const action = reopened.actions.find(
      (a) => a.kind === "move" && a.target === "greek-athens",
    );
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
    expect(agoraView(moved.world, present).world.presentActors).toHaveLength(4);
  });
});
