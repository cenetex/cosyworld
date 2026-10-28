import { afterEach, describe, expect, it } from "vitest";
import {
  decodeSave,
  encodeSave,
  legalActions,
  willingToGive,
} from "../v2/card-game/world.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { recitalPoem } from "../v2/card-game/pack-recital.mjs";
import {
  thraceJourney,
  thraceEvidence,
  thraceChoice,
  bookPlay,
} from "./helpers/greek-book-three.mjs";

const pack = packDefinition("greek-drama");
afterEach(() => new Promise((resolve) => setImmediate(resolve)));

describe("The Gold Beneath the Tide", { timeout: 60000 }, () => {
  it.each(["revenge", "hearing", "two-burials"])(
    "brings the %s case home after two actual burials",
    (route) => {
      const world = thraceJourney(route),
        saved = world.packs[pack.id];
      expect(saved.choices["greek-thrace-ending"]).toBe(route);
      expect(saved.choices["greek-thrace-return"]).toBe(route);
      expect(saved.flags["greek-thrace-both-buried"]).toBe(true);
      expect(saved.flags["greek-thrace-case-signed"]).toBe(true);
      expect(world.actors["greek-thrace-hecuba"].place).toBe(
        "greek-thrace-burial-ground",
      );
      for (const item of ["polyxena-cloth", "polydorus-shroud"])
        expect(world.items[`greek-thrace-${item}`].holder).toBe(
          "greek-thrace-burial-ground",
        );
      expect(world.items["greek-thrace-case-papers"].holder).toBe(
        "greek-courtyard",
      );
      expect(world.items["greek-thrace-entrusted-gold"].holder).toBe(
        route === "hearing" ? "greek-thrace-hecuba" : "greek-thrace-polymestor",
      );
      expect(
        recitalPoem(world, pack)
          .stanzas.filter((v) => v.id.startsWith("greek-thrace-"))
          .map((v) => v.id),
      ).toEqual([
        "greek-thrace-lay-cloth",
        "greek-thrace-compare-record",
        `greek-thrace-bury-${route}`,
        `greek-thrace-return-${route}`,
      ]);
      expect(decodeSave(encodeSave(world))).toEqual(world);
    },
    30000,
  );

  it("keeps Hecuba’s agreed papers through the actual burial", () => {
    const world = thraceChoice(thraceEvidence(), "choose-two-burials");
    expect(
      willingToGive(
        world,
        "greek-thrace-hecuba",
        "greek-thrace-case-papers",
        "vale",
      ),
    ).toBe(false);
    expect(
      world.packs[pack.id].flags["greek-thrace-both-buried"],
    ).toBeUndefined();
    expect(
      legalActions(world).some((a) => a.choiceId === "greek-thrace-seal-case"),
    ).toBe(false);
    const requested = bookPlay(world, "ask", {
      item: "greek-thrace-case-papers",
    });
    expect(requested.items["greek-thrace-case-papers"].holder).toBe(
      "greek-thrace-hecuba",
    );
  }, 30000);
});
