import { afterEach, describe, expect, it } from "vitest";
import {
  decodeSave,
  encodeSave,
  legalActions,
} from "../v2/card-game/world.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { recitalPoem } from "../v2/card-game/pack-recital.mjs";
import {
  susaJourney,
  susaReady,
  susaChoice,
} from "./helpers/greek-book-three.mjs";

const pack = packDefinition("greek-drama");
afterEach(() => new Promise((resolve) => setImmediate(resolve)));

describe("The Broken Oar", { timeout: 60000 }, () => {
  it.each(["public", "private", "reckoning"])(
    "returns the historical %s account through actual court arrivals",
    (route) => {
      const world = susaJourney(route),
        saved = world.packs[pack.id];
      expect(saved.choices["greek-susa-frame"]).toBe(
        "historical-salamis-480-bce",
      );
      expect(saved.choices["greek-susa-ending"]).toBe(route);
      expect(saved.choices["greek-susa-return"]).toBe(route);
      expect(saved.flags["greek-susa-king-arrived"]).toBe(true);
      expect(world.actors["greek-susa-xerxes"].place).toBe("greek-susa");
      if (route === "private") {
        expect(world.actors["greek-susa-atossa"].place).toBe("greek-susa");
        expect(saved.flags["greek-susa-households-disclosure-due"]).toBe(true);
      }
      expect(world.items["greek-susa-broken-oar"].holder).toBe(
        "greek-susa-tomb",
      );
      expect(world.items["greek-susa-offering-water"].holder).toBe(
        "greek-susa-tomb",
      );
      expect(world.items["greek-susa-dead-names"].holder).toBe(
        "greek-courtyard",
      );
      expect(
        recitalPoem(world, pack)
          .stanzas.filter((v) => v.id.startsWith("greek-susa-"))
          .map((v) => v.id),
      ).toEqual([
        "greek-susa-set-oar",
        "greek-susa-pour-water",
        "greek-susa-receive-return",
        `greek-susa-return-${route}`,
      ]);
      expect(decodeSave(encodeSave(world))).toEqual(world);
    },
    30000,
  );

  it("opens the selected audience after the consenting king actually arrives", () => {
    const before = susaChoice(susaReady(), "choose-private");
    expect(before.actors["greek-susa-xerxes"].place).toBe(
      "greek-susa-threshold",
    );
    expect(before.packs[pack.id].choices["greek-susa-ending"]).toBeUndefined();
    expect(
      legalActions(before).some(
        (a) => a.choiceId === "greek-susa-record-private",
      ),
    ).toBe(false);
    expect(pack.places["greek-susa-road"].road).toEqual([
      "greek-troy",
      "greek-susa",
    ]);
  }, 30000);
});
