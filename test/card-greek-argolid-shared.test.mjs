import { describe, expect, it } from "vitest";
import { decodeSave, encodeSave, exits } from "../v2/card-game/world.mjs";
import { entityActive } from "../v2/card-game/pack-registry.mjs";
import { ajaxStart } from "./helpers/greek-ajax.mjs";
import { houseGo, housePlay } from "./helpers/greek-house-of-blood.mjs";

const road = "greek-argolid-road";
const reload = (world) => decodeSave(encodeSave(world));
function invite(world, chapter) {
  world = houseGo(
    world,
    chapter === "danaid" ? "greek-courtyard" : "greek-harbor",
  );
  return housePlay(world, "choose", {
    choiceId:
      chapter === "danaid" ? "greek-danaid-invitation" : "greek-v-invitation",
  });
}

describe("the Argolid road shared by two invited chapters", () => {
  it.each(["danaid", "house"])(
    "opens through the %s invitation and preserves the other household gate",
    (chapter) => {
      let world = houseGo(ajaxStart(), "greek-harbor");
      expect(exits(world, "greek-harbor", "vale")).not.toContain(road);
      world = invite(world, chapter);
      world = houseGo(world, road);
      expect(world.actors.vale.place).toBe(road);
      expect(entityActive(world, "greek-argos-sanctuary")).toBe(
        chapter === "danaid",
      );
      expect(entityActive(world, "greek-argos-refuge")).toBe(
        chapter === "house",
      );
      expect(exits(world, road, "vale")).toContain("greek-harbor");
      expect(reload(world)).toEqual(world);
    },
  );
  it.each([
    ["danaid", "house"],
    ["house", "danaid"],
  ])("keeps both invitations in %s then %s order", (first, second) => {
    let world = invite(ajaxStart(), first);
    world = houseGo(world, road);
    world = invite(world, second);
    world = houseGo(world, road);
    for (const place of ["greek-argos-sanctuary", "greek-argos-refuge"])
      expect(entityActive(world, place), place).toBe(true);
    const state = world.packs["greek-drama"];
    expect(state.flags["greek-argolid-road-open"]).toBe(true);
    for (const id of ["greek-danaid-invitation", "greek-v-invitation"])
      expect(Object.hasOwn(state.receipts, id)).toBe(true);
    expect(reload(world)).toEqual(world);
  });
});
