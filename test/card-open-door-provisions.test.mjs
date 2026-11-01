import { describe, expect, it } from "vitest";
import { decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import {
  openDoorJourney,
  openDoorWalk,
  playOpenDoor,
} from "./helpers/open-door.mjs";

const reload = (world) => decodeSave(encodeSave(world));
const berth = "greek-open-door-family-berth";
const giveList = (world) =>
  playOpenDoor(world, "give", {
    item: "greek-return-list",
    target: "greek-quay-host",
  });

describe("the Piraeus stores", () => {
  it("requires the basket at the quay when giving Thaleia the list", () => {
    let world = openDoorJourney().before[berth];
    world = playOpenDoor(world, "take", { item: "greek-provision-basket" });
    world = openDoorWalk(world, "athens", "piraeus");
    world = reload(giveList(reload(world)));
    expect(world.packs["greek-drama"].receipts[berth]).toBeUndefined();
    expect(
      world.packs["greek-drama"].flags["greek-open-door-piraeus-done"],
    ).toBeUndefined();
    world.items["greek-return-list"].holder = "vale";

    world = playOpenDoor(world, "drop", {
      item: "greek-provision-basket",
      target: "greek-piraeus",
    });
    world = reload(giveList(world));
    expect(
      world.packs["greek-drama"].flags["greek-open-door-piraeus-done"],
    ).toBe(true);
    expect(world.packs["greek-drama"].choices["greek-open-door-berth"]).toBe(
      "family",
    );
    expect(world.items["greek-provision-basket"].holder).toBe("greek-piraeus");
    expect(world.items["greek-return-list"].holder).toBe("greek-piraeus");
  });
});
