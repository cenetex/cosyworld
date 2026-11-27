// The 2026-11-11 audit fixes, on the real Greek pack in a new world:
// nothing opens the Open Door, and a Hoppy Cat thing does not open the harbor
// lane to Piraeus. (Finishing the Open Door without Marathon is checked in
// card-open-door.test.mjs.)
import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  exits,
  legalActions,
} from "../v2/card-game/world.mjs";
import { conditionMet } from "../v2/card-game/pack-rules.mjs";
import {
  entityActive,
  entityShown,
  packDefinition,
} from "../v2/card-game/pack-registry.mjs";
import { seaRoad, traveler } from "./helpers/open-door.mjs";

const marathon = "greek-marathon";
const blanket = "greek-shelter-blanket";
const progress = "greek-open-door-marathon";

describe("Attica is simply there", () => {
  it("shows Attica, its residents and its things with Polynices unburied", () => {
    const world = createWorld();
    const flags = world.packs["greek-drama"].flags;
    expect(flags["greek-burial-performed"]).toBeFalsy();
    expect(flags["greek-open-door-open"]).toBeUndefined();
    // Its people are on the table from the first turn, each a locked card
    // waiting for its own thing (open-door-rework), never for the burial.
    for (const id of [
      "greek-aethra",
      "greek-adrastus",
      "greek-theseus",
      "greek-quay-host",
      "greek-colonus-keeper",
    ]) {
      expect(entityShown(world, id), id).toBe(true);
      expect(entityActive(world, id), id).toBe(false);
    }
    for (const id of [
      "greek-colonus",
      "greek-eleusis",
      "greek-cithaeron",
      "greek-road-athens-eleusis",
      marathon,
      "greek-marathon-keeper",
    ])
      expect(entityActive(world, id), id).toBe(true);
    for (const id of ["greek-burial-petition", "greek-oil-flask", blanket])
      expect(entityActive(world, id), id).toBe(true);
  });

  it("takes the shelter blanket from Piraeus to shelter the children at Marathon", () => {
    let t = seaRoad();
    const pack = () => t.s.packs["greek-drama"];
    expect(pack().scope).toBe("opening");
    expect(t.s.actors.vale.place).toBe("greek-piraeus");
    t.take(blanket).move("athens", "eleusis", marathon);
    expect(exits(t.s, marathon, "vale")).toContain("greek-eleusis");
    t.talk("marathon-keeper").talk("marathon-keeper");
    expect(pack().flags[`${progress}-entered`]).toBe(true);
    expect(pack().flags[`${progress}-daughter-heard`]).toBeUndefined();
    t.give(blanket, "marathon-keeper");
    expect(t.s.items[blanket].holder).toBe(marathon);
    t = traveler(decodeSave(encodeSave(t.s)));
    for (const step of ["daughter", "battle", "captive"]) {
      t.talk("marathon-keeper");
      expect(pack().receipts[`${progress}-${step}`]).toBe(t.s.turn);
    }
    expect(pack().flags[`${progress}-done`]).toBe(true);
    t.take("marathon-captive-bond").give(
      "marathon-captive-bond",
      "marathon-alcmene",
    );
    expect(pack().choices["greek-marathon-captive-disposition"]).toBe(
      "household",
    );
    expect(t.s.items["greek-marathon-captive-bond"].holder).toBe(marathon);
    expect(decodeSave(encodeSave(t.s))).toEqual(t.s);
    t.move("eleusis", "athens", "piraeus");
    expect(t.s.actors.vale.place).toBe("greek-piraeus");
  });

  it("helps Oedipus’s family find refuge at Colonus", () => {
    let t = seaRoad();
    const story = "greek-open-door-colonus";
    const receipts = () => t.s.packs["greek-drama"].receipts;
    t.move("athens", "eleusis", "colonus");
    t.talk("colonus-keeper").talk("colonus-keeper");
    expect(receipts()[`${story}-enter`]).toBeDefined();
    expect(receipts()[`${story}-water`]).toBeUndefined();
    t.drop("oil-flask");
    t = traveler(decodeSave(encodeSave(t.s)));
    for (const step of ["water", "daughters", "farewell", "custom"]) {
      t.talk(
        ["water", "daughters"].includes(step)
          ? "colonus-keeper"
          : "colonus-theseus",
      );
      expect(receipts()[`${story}-${step}`]).toBeDefined();
    }
    expect(t.s.items["greek-oil-flask"].holder).toBe("greek-colonus");
    expect(t.s.packs["greek-drama"].flags[`${story}-done`]).toBe(true);
    t.talk("colonus-theseus");
    expect(receipts()["greek-colonus-welcome-at-watch"]).toBe(t.s.turn);
    expect(t.s.actors["greek-colonus-theseus"].trust.vale).toBe(2);
    expect(t.s.items["greek-colonus-public-welcome-cup"]).toBeUndefined();
    expect(decodeSave(encodeSave(t.s))).toEqual(t.s);
  });

  it("no pack data reads or writes the burial's old flag", () => {
    const text = JSON.stringify(packDefinition("greek-drama"));
    expect(text).not.toContain("greek-open-door-open");
  });
});

describe("harbor to Piraeus needs the provisions on deck", () => {
  it("is not opened by a Hoppy Cat thing aboard", () => {
    const lane = packDefinition("greek-drama").transports[
      "greek-ship"
    ].lanes.find((l) => l.from === "greek-harbor" && l.to === "greek-piraeus");
    expect(JSON.stringify(lane.opensWith)).not.toContain("hoppycat");
    const world = createWorld();
    world.items["hoppycat-halfway-cup"].holder = "greek-ship";
    world.actors.vale.place = "greek-ship";
    world.transports["greek-ship"].dock = "greek-harbor";
    expect(
      conditionMet(world, {
        kind: "pack_item_present",
        pack: "hoppycat-archive",
        place: "greek-ship",
      }),
    ).toBe(true);
    const courses = legalActions(world, "vale")
      .filter((a) => a.kind === "course")
      .map((a) => a.target);
    expect(courses).not.toContain("greek-piraeus");
    // Provisions lying on deck do open it.
    world.items["greek-provisions"].holder = "greek-ship";
    world.usedUp = [];
    expect(
      legalActions(world, "vale")
        .filter((a) => a.kind === "course")
        .map((a) => a.target),
    ).toContain("greek-piraeus");
  });
});
