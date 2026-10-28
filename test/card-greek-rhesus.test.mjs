import { describe, expect, it } from "vitest";
import {
  decodeSave,
  encodeSave,
  legalActions,
} from "../v2/card-game/world.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { recitalPoem } from "../v2/card-game/pack-recital.mjs";
import { knowsFact } from "../v2/card-game/knowledge.mjs";
import {
  bookMove,
  rhesusWatch,
  rhesusJourney,
} from "./helpers/greek-book-three.mjs";

const pack = packDefinition("greek-drama");

describe("The Watchword in the Dark", () => {
  it.each(["warning", "raid"])(
    "brings the %s account home with four earned stanzas",
    (route) => {
      const world = rhesusJourney(route);
      expect(world.packs[pack.id].choices["greek-rhesus-return"]).toBe(route);
      expect(world.packs[pack.id].flags["greek-rhesus-fate-settled"]).toBe(
        true,
      );
      expect(world.packs[pack.id].choices["greek-rhesus-later-fate"]).toBe(
        route === "warning" ? "protected-aid-steward" : "dead-after-raid",
      );
      expect(world.items["greek-rhesus-testimony"].holder).toBe(
        "greek-courtyard",
      );
      expect(world.items["greek-rhesus-bandage"].holder).toBe(
        "greek-rhesus-aid-tent",
      );
      expect(knowsFact(world, "vale", `greek-rhesus-account-${route}`)).toBe(
        true,
      );
      expect(
        recitalPoem(world, pack)
          .stanzas.filter((v) => v.id.startsWith("greek-rhesus-"))
          .map((v) => v.id),
      ).toEqual([
        "greek-rhesus-set-lamp",
        "greek-rhesus-compare-word",
        `greek-rhesus-complete-${route}`,
        `greek-rhesus-return-${route}`,
      ]);
      if (route === "warning")
        expect(world.actors["greek-rhesus-rhesus"].place).toBe(
          "greek-rhesus-aid-tent",
        );
      expect(decodeSave(encodeSave(world))).toEqual(world);
    },
  );

  it("keeps a promised withdrawal separate from a protected arrival", () => {
    const world = bookMove(rhesusWatch(), "greek-rhesus-aid-tent");
    expect(
      legalActions(world).some(
        (a) => a.choiceId === "greek-rhesus-complete-warning",
      ),
    ).toBe(false);
    expect(
      world.packs[pack.id].flags["greek-rhesus-fate-settled"],
    ).toBeUndefined();
  });
});
