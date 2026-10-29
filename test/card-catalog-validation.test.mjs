import { beforeAll, describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  validateWorld,
} from "../v2/card-game/world.mjs";
import {
  entityActive,
  packDefinition,
  packDefinitions,
  validatePackStates,
} from "../v2/card-game/pack-registry.mjs";
import {
  indexSections,
  sectionAllows,
} from "../v2/card-game/pack-sections.mjs";

const definition = () => ({
  id: "island",
  places: { quay: {}, court: {} },
  avatars: { host: { place: "court" } },
  items: { letter: { holder: "host" }, cup: { holder: "court" } },
  fixtures: { bell: { at: "court" } },
  sections: [{ places: ["court"], requires: [{ open: true }] }],
});

describe("authored section indexes", () => {
  it("ties people, belongings and fixtures to the same authored section", () => {
    const pack = definition(),
      index = indexSections(pack);
    const world = { packs: { island: { scope: "opening" } }, open: false };
    const conditions = (state, id, requires) =>
      id === "island" && state.open === requires[0].open;
    for (const open of [false, true, false]) {
      world.open = open;
      for (const id of ["court", "host", "letter", "cup", "bell"])
        expect(sectionAllows(world, pack, id, conditions, index)).toBe(open);
      expect(sectionAllows(world, pack, "quay", conditions, index)).toBe(true);
    }
    world.packs.island.scope = "full";
    expect(sectionAllows(world, pack, "host", () => false, index)).toBe(true);
  });

  it("keeps current and historical world requirements separate", () => {
    const pack = definition(),
      index = indexSections(pack);
    const current = { packs: { island: { scope: "opening" } }, open: true };
    const prior = { ...current, open: false };
    const conditions = (world) => world.open;
    expect(sectionAllows(current, pack, "host", conditions, index)).toBe(true);
    expect(sectionAllows(prior, pack, "host", conditions, index)).toBe(false);
    expect(sectionAllows(current, pack, "host", conditions, index)).toBe(true);
  });

  it("takes a fresh catalog membership index for each validation pass", () => {
    const pack = definition();
    const world = { packs: { island: { scope: "opening" } } };
    expect(
      sectionAllows(world, pack, "host", () => false, indexSections(pack)),
    ).toBe(false);
    pack.sections[0].places[0] = "quay";
    expect(
      sectionAllows(world, pack, "host", () => false, indexSections(pack)),
    ).toBe(true);
    expect(
      sectionAllows(world, pack, "quay", () => false, indexSections(pack)),
    ).toBe(false);
  });

  it("retains the first section match and live authored requirements", () => {
    const pack = definition();
    pack.sections.push({ places: ["court"], requires: [{ open: false }] });
    const index = indexSections(pack);
    const world = { packs: { island: { scope: "opening" } } };
    const conditions = (_, __, requires) => requires[0].open;
    expect(sectionAllows(world, pack, "host", conditions, index)).toBe(true);
    pack.sections[0].requires = [{ open: false }];
    expect(sectionAllows(world, pack, "host", conditions, index)).toBe(false);
  });
});

describe("catalog validation keeps saved-state guards", () => {
  let opening, inactive;
  const pack = packDefinition("greek-drama");
  beforeAll(() => {
    opening = createWorld({ opening: true });
    inactive = Object.keys(pack.items).find(
      (id) => pack.items[id].requires?.length && !entityActive(opening, id),
    );
    expect(inactive).toBeTruthy();
  });

  it("keeps pack lookup identity and unknown IDs", () => {
    for (const pack of packDefinitions)
      expect(packDefinition(pack.id)).toBe(pack);
    for (const id of ["missing", "__proto__", undefined])
      expect(packDefinition(id)).toBeNull();
  });

  it("retains opening and full saves exactly through validation and reload", () => {
    for (const world of [
      opening,
      createWorld({ packScopes: { "greek-drama": "full" } }),
    ]) {
      const original = structuredClone(world);
      expect(validateWorld(world)).toBe(world);
      expect(decodeSave(encodeSave(world))).toEqual(original);
      expect(world).toEqual(original);
    }
  });

  it.each(["holder", "history", "missing"])(
    "rejects a locked item's forged %s",
    (field) => {
      const forged = structuredClone(opening);
      if (field === "holder") forged.items[inactive].holder = "vale";
      if (field === "history")
        forged.items[inactive].history = ["An invented transfer."];
      if (field === "missing") delete forged.items[inactive];
      expect(validatePackStates(forged)).toBe(false);
      expect(() => validateWorld(forged)).toThrow();
    },
  );

  it("checks malformed history even when the authored holder stays the same", () => {
    const forged = structuredClone(opening);
    forged.items[inactive].history = "";
    expect(() => validateWorld(forged)).toThrow();
  });

  it.each(["receipt", "flag", "meeting", "archive", "publicView"])(
    "rejects forged %s state after a valid pass",
    (kind) => {
      const forged = structuredClone(opening);
      expect(validatePackStates(forged)).toBe(true);
      const saved = forged.packs[pack.id];
      if (kind === "receipt") saved.receipts["invented-choice"] = 1;
      if (kind === "flag") saved.flags["invented-flag"] = true;
      if (kind === "meeting") saved.met["greek-baker"] = forged.turn + 1;
      if (kind === "archive") saved.poemReadings.stanzas.push(["invented"]);
      if (kind === "publicView")
        forged.readingView = { actor: "vale", packs: {} };
      expect(() => validateWorld(forged)).toThrow();
    },
  );
});
