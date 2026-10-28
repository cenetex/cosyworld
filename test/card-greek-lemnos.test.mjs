import { afterEach, describe, expect, it } from "vitest";
import {
  decodeSave,
  encodeSave,
  legalActions,
  accompanyDecision,
} from "../v2/card-game/world.mjs";
import {
  entityActive,
  packDefinition,
} from "../v2/card-game/pack-registry.mjs";
import { recitalPoem } from "../v2/card-game/pack-recital.mjs";
import { knowsFact } from "../v2/card-game/knowledge.mjs";
import {
  bookMove,
  bookPlay,
  lemnosStart,
  lemnosReturnedBow,
  lemnosAgreed,
  lemnosArrived,
  lemnosJourney,
} from "./helpers/greek-book-three.mjs";

const pack = packDefinition("greek-drama");
const ph = "greek-lemnos-philoctetes";
const saved = (world) => world.packs[pack.id];
const accompany = (world) =>
  legalActions(world).filter((a) => a.kind === "accompany" && a.target === ph);

afterEach(() => new Promise((resolve) => setImmediate(resolve)));

describe("The Offered Sail", { timeout: 60000 }, () => {
  it.each(["troy", "home", "repair"])(
    "completes the %s voyage with consent, actual arrival and a returned jug",
    (route) => {
      const world = lemnosJourney(route);
      expect(saved(world).choices).toMatchObject({
        "greek-lemnos-consent": route,
        "greek-lemnos-ending": route,
        "greek-lemnos-return": route,
      });
      expect(world.actors[ph].place).toBe(
        route === "home" ? "greek-trachis" : "greek-greek-camp",
      );
      expect(world.items["greek-lemnos-bow"].holder).toBe(ph);
      expect(world.items["greek-lemnos-water"].holder).toBe("greek-courtyard");
      if (route === "home") {
        for (const place of ["greek-delphi", "greek-trachis"])
          expect(entityActive(world, place), place).toBe(true);
        for (const other of [
          "greek-trachis-deianira",
          "greek-pythian-priestess",
        ])
          expect(entityActive(world, other), other).toBe(false);
      }
      expect(knowsFact(world, "vale", `greek-lemnos-arrival-${route}`)).toBe(
        true,
      );
      expect(
        recitalPoem(world, pack)
          .stanzas.filter((v) => v.id.startsWith("greek-lemnos-"))
          .map((v) => v.id),
      ).toEqual([
        "greek-lemnos-care",
        "greek-lemnos-return-bow",
        "greek-lemnos-check-manifest",
        `greek-lemnos-return-${route}`,
      ]);
      expect(decodeSave(encodeSave(world))).toEqual(world);
    },
  );

  it("keeps the resident’s bow and agreement separate", () => {
    let world = bookMove(lemnosStart(), "greek-lemnos");
    expect(accompany(world)).toEqual([]);
    world = lemnosReturnedBow();
    expect(world.items["greek-lemnos-bow"].holder).toBe(ph);
    expect(accompany(world)).toEqual([]);
    world = lemnosAgreed();
    expect(accompany(world).map((a) => a.destination)).toEqual([
      "greek-lemnos-landing",
    ]);
    expect(saved(world).choices["greek-lemnos-ending"]).toBeUndefined();
    expect(accompanyDecision(world, "vale", ph, "greek-athens").accepted).toBe(
      false,
    );
  });

  it("keeps a consenting passenger aboard through another human’s stop", () => {
    let world = lemnosAgreed();
    world = bookPlay(world, "accompany", {
      target: ph,
      destination: "greek-lemnos-landing",
    });
    world = bookPlay(world, "accompany", {
      target: ph,
      destination: "greek-ship",
    });
    expect(world.actors[ph].place).toBe("greek-ship");
    world = bookMove(world, "greek-athens-harbor");
    expect(world.actors[ph].place).toBe("greek-ship");
    expect(saved(world).flags["greek-lemnos-arrived"]).toBeUndefined();
    world = decodeSave(encodeSave(world));
    world = bookMove(world, "greek-ship");
    world = bookPlay(world, "accompany", {
      target: ph,
      destination: "greek-ajax-landing",
    });
    world = bookPlay(world, "accompany", {
      target: ph,
      destination: "greek-greek-camp",
    });
    expect(world.actors[ph].place).toBe("greek-greek-camp");
    expect(saved(world).choices["greek-lemnos-ending"]).toBeUndefined();
  });

  it("records arrival from the passenger’s own published account", () => {
    const world = lemnosArrived();
    expect(saved(world).flags["greek-lemnos-arrived"]).toBe(true);
    expect(knowsFact(world, "vale", "greek-lemnos-arrival-troy")).toBe(true);
    expect(world.transports["greek-ship"].dock).toBe("greek-ajax-landing");
  });
});
