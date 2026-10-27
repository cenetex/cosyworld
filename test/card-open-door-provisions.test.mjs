import { describe, expect, it } from "vitest";
import {
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import {
  openDoorJourney,
  openDoorWalk,
  playOpenDoor,
} from "./helpers/open-door.mjs";

const offered = (world, id) =>
  legalActions(world).find((action) => action.choiceId === id);
const reload = (world) => decodeSave(encodeSave(world));

describe("the Piraeus stores", () => {
  it.each(["family", "open"])(
    "requires the basket at the quay when committing the %s berth",
    (branch) => {
      const choiceId = `greek-open-door-${branch}-berth`;
      let world = openDoorJourney().before["greek-open-door-family-berth"];
      const earlierOffer = offered(world, choiceId);
      expect(earlierOffer).toBeTruthy();

      world = playOpenDoor(world, "take", { item: "greek-provision-basket" });
      world = openDoorWalk(world, "athens", "piraeus");
      world = reload(world);
      for (const ending of ["family", "open"])
        expect(
          offered(world, `greek-open-door-${ending}-berth`),
        ).toBeUndefined();
      expect(play(world, earlierOffer).ok).toBe(false);
      expect(
        world.packs["greek-drama"].flags["greek-open-door-piraeus-done"],
      ).toBeUndefined();
      expect(world.items["greek-return-list"].holder).toBe("vale");

      world = playOpenDoor(world, "drop", {
        item: "greek-provision-basket",
        target: "greek-piraeus",
      });
      for (const ending of ["family", "open"])
        expect(offered(world, `greek-open-door-${ending}-berth`)).toBeTruthy();
      world = playOpenDoor(world, "choose", { choiceId });
      world = reload(world);
      expect(
        world.packs["greek-drama"].flags["greek-open-door-piraeus-done"],
      ).toBe(true);
      expect(world.packs["greek-drama"].choices["greek-open-door-berth"]).toBe(
        branch,
      );
      expect(world.items["greek-provision-basket"].holder).toBe(
        "greek-piraeus",
      );
      expect(world.items["greek-return-list"].holder).toBe("greek-piraeus");
    },
  );
});
