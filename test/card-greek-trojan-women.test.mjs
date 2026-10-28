import { afterEach, describe, expect, it } from "vitest";
import {
  decodeSave,
  encodeSave,
  legalActions,
  itemPlace,
  willingToGive,
} from "../v2/card-game/world.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { recitalPoem } from "../v2/card-game/pack-recital.mjs";
import {
  troyStart,
  troyArrivals,
  troyReturn,
} from "./helpers/greek-book-three.mjs";

const pack = packDefinition("greek-drama");
afterEach(() => new Promise((resolve) => setImmediate(resolve)));

describe("What the Ships Will Carry", { timeout: 60000 }, () => {
  it.each(["witness", "child-refuge", "family-together"])(
    "completes %s through both physical letter carriers",
    (route) => {
      const arrived = troyArrivals(route);
      for (const [actor, item] of [
        ["greek-troy-hecuba", "greek-troy-message-a"],
        ["greek-troy-andromache", "greek-troy-message-b"],
      ]) {
        expect(arrived.items[item].holder).toBe(actor);
        expect(willingToGive(arrived, actor, item, "greek-shipmaster")).toBe(
          false,
        );
      }
      const world = troyReturn(arrived, route),
        saved = world.packs[pack.id];
      expect(saved.choices["greek-troy-ending"]).toBe(route);
      expect(saved.choices["greek-troy-return"]).toBe(route);
      expect(saved.choices["greek-troy-andromache-assignment"]).toBe(
        "neoptolemus",
      );
      expect(saved.choices["greek-troy-astyanax-fate"]).toBe(
        route === "witness" ? "dead" : "refuge",
      );
      expect(saved.flags["greek-troy-andromache-arrived"]).toBe(true);
      for (const [actor, item] of [
        ["greek-troy-hecuba", "greek-troy-message-a"],
        ["greek-troy-andromache", "greek-troy-message-b"],
      ]) {
        expect(world.actors[actor].place).toBe("greek-harbor");
        expect(itemPlace(world, item)).toBe("greek-harbor");
      }
      expect(world.items["greek-troy-names"].holder).toBe("greek-courtyard");
      expect(world.items["greek-troy-hector-shield"]).not.toBe(
        world.items["greek-ajax-shield"],
      );
      expect(
        recitalPoem(world, pack)
          .stanzas.filter((v) => v.id.startsWith("greek-troy-"))
          .map((v) => v.id),
      ).toEqual([
        "greek-troy-write-names",
        route === "witness"
          ? "greek-troy-dress-shield"
          : "greek-troy-prepare-refuge",
        "greek-troy-last-song",
        `greek-troy-return-${route}`,
      ]);
      expect(decodeSave(encodeSave(world))).toEqual(world);
    },
    20000,
  );

  it("keeps the paid family’s actual voyage separate from the giver’s later crossing", () => {
    const world = troyArrivals("family-together");
    expect(world.actors.vale.place).toBe("greek-ajax-landing");
    expect(world.actors["greek-troy-andromache"].place).toBe("greek-harbor");
    expect(world.packs[pack.id].choices["greek-troy-cargo-cost"]).toBe(
      "player-berth",
    );
    expect(world.packs[pack.id].choices["greek-troy-ending"]).toBeUndefined();
    expect(world.items["greek-troy-berth-token"].holder).toBe(
      "greek-ajax-landing",
    );
  }, 20000);

  it("keeps the source child report behind the mother’s actual departure", () => {
    const world = troyStart();
    expect(
      world.packs[pack.id].choices["greek-troy-astyanax-fate"],
    ).toBeUndefined();
    expect(
      legalActions(world).some((a) => a.choiceId === "greek-troy-hear-body"),
    ).toBe(false);
  });
});
