import { describe, it, expect } from "vitest";
import {
  encodeSave,
  decodeSave,
  legalActions,
} from "../v2/card-game/world.mjs";
import {
  packDefinition,
  entityActive,
} from "../v2/card-game/pack-registry.mjs";
import { recitalPoem } from "../v2/card-game/pack-recital.mjs";
import {
  helenJourney,
  helenPrepared,
  ivStart,
  ivId,
} from "./helpers/book-iv.mjs";
const pack = packDefinition("greek-drama");
describe("The Faces of Home: Helen", () => {
  it.each(["hearing", "sanctuary", "escape"])(
    "brings the %s account home through actual deeds and published words",
    (route) => {
      const world = helenJourney(route);
      const state = world.packs["greek-drama"];
      expect(state.choices[ivId("helen", "ending")]).toBe(route);
      expect(state.choices[ivId("helen", "return")]).toBe(route);
      expect(world.items[ivId("helen", "account")].holder).toBe(
        "greek-courtyard",
      );
      const stanzas = recitalPoem(world, pack).stanzas.filter((v) =>
        v.id.startsWith(ivId("helen", "")),
      );
      expect(stanzas.map((v) => v.id)).toEqual([
        ivId("helen", "confirm-witness"),
        ivId("helen", "hear-theonoe"),
        ivId("helen", `finish-${route}`),
        ivId("helen", `return-${route}`),
      ]);
      expect(decodeSave(encodeSave(world))).toEqual(world);
      if (route === "escape")
        for (const person of ["greek-helen-egypt", "greek-menelaus-egypt"])
          expect(world.actors[person].place).toBe(ivId("helen", "boat"));
    },
  );
  it("keeps the Trojan body and evidence in its chosen account", () => {
    const world = ivStart("troy");
    expect(entityActive(world, "greek-helen-troy")).toBe(true);
    expect(entityActive(world, "greek-helen-egypt")).toBe(false);
    expect(entityActive(world, ivId("helen", "theonoe"))).toBe(false);
    expect(
      world.packs["greek-drama"].flags[ivId("helen", "done")],
    ).toBeUndefined();
  });
  it("keeps a prepared escape open until the travellers actually arrive", () => {
    const world = helenPrepared();
    expect(
      world.packs["greek-drama"].choices[ivId("helen", "ending")],
    ).toBeUndefined();
    expect(
      legalActions(world).some(
        (a) => a.choiceId === ivId("helen", "finish-escape"),
      ),
    ).toBe(false);
  });
});
