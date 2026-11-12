import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createWorld, legalActions } from "../v2/card-game/world.mjs";
import { availableCards, sealedReason } from "../v2/card-game/cards.mjs";
import { lockText } from "./helpers/lock-text.mjs";
import { isLockedBox, lockedQuest } from "../v2/card-game/locked-box.mjs";
import { entityActive } from "../v2/card-game/pack-registry.mjs";

// Slice 4 of the wants design (#2605): every gated way and conditional
// resident that pack data can draw is drawn as a locked box with a truthful
// want read from its conditions, and opens exactly when its old condition
// holds. The rest are named here with the reason pack data cannot draw them.
const table = JSON.parse(
  readFileSync(
    new URL("../v2/worlds/card-table.json", import.meta.url),
    "utf8",
  ),
);
const source = (pack) =>
  JSON.parse(
    readFileSync(
      new URL(`../v2/content/${pack}/card-world.json`, import.meta.url),
      "utf8",
    ),
  );

// A gated route or conditional resident that is not drawn as a locked box.
const LEFT_HIDDEN = {
  // The guard already draws his way (rules 100); not a seal.
  "greek-drama": {
    "greek-gate>greek-battlefield": "guarded way, drawn by its guard",
  },
  // The owner paused this pack (hoppycat-paused): its boxes stay as they are.
  "hoppycat-archive": {
    "hoppycat-penny-vellum": "pack paused by the owner",
    "hoppycat-rill-current": "pack paused by the owner",
    "hoppycat-arc": "pack paused by the owner",
    "hoppycat-ledger-opus": "pack paused by the owner",
    "hoppycat-ledger-sonnet": "pack paused by the owner",
  },
  // Present until a flag turns, then gone: a departure, not a locked box.
  willows: { "willows-swede": "present until the flag turns, then leaves" },
  // Left as #2615 built it: RATi wakes on arrival at his own station.
  ratiradio: { "ratiradio-rati": "left as the RatiRadio room was built" },
};

describe("every gated way and conditional resident in a mounted pack", () => {
  for (const pack of table.packs) {
    it(`${pack}: is drawn locked with no sentence of its own, or named as left hidden`, () => {
      const world = source(pack);
      const hidden = LEFT_HIDDEN[pack] || {};
      const seen = new Set();
      const note = (key, sealed) => {
        seen.add(key);
        if (sealed) {
          expect(
            hidden[key],
            `${key} is sealed and listed hidden`,
          ).toBeUndefined();
          expect(
            sealed.reason,
            `${key} carries no authored text`,
          ).toBeUndefined();
        } else expect(hidden[key], `${key} needs a seal`).toBeTruthy();
      };
      for (const r of world.routes || [])
        if (r.requires?.length || r.travelerRequires?.length)
          note(`${r.from}>${r.to}`, r.sealed);
      for (const [id, a] of Object.entries(world.avatars || {}))
        if (a.requires?.length) note(id, a.sealed);
      // Nothing listed as hidden has gone missing from the pack.
      for (const key of Object.keys(hidden))
        expect(seen.has(key), `${key} is still gated`).toBe(true);
    });
  }
});

const world = () => createWorld({ opening: false, seed: 17 });
const greek = (s) => s.packs["greek-drama"].flags;
const forest = (s) => s.packs["lonely-forest"].flags;
const at = (s, place) => {
  s.actors.vale.place = place;
  s.actors.vale.visited.push(place);
  return s;
};
const canMove = (s, to) =>
  legalActions(s).some((a) => a.kind === "move" && a.target === to && !a.item);
const drawn = (s, card) => ({
  shown: availableCards(s).includes(card),
  locked: isLockedBox(s, card),
  reason: lockText(s, card),
});
const lockedBox = (s, card, reason) => {
  expect(drawn(s, card), card).toMatchObject({ shown: true, locked: true });
  expect(drawn(s, card).reason, card).toMatch(reason);
  expect(canMove(s, card), `${card} cannot be entered`).toBe(false);
  const before = JSON.stringify(s);
  for (const known of [false, true])
    expect(lockedQuest(s, card, () => known)).toEqual({
      text: sealedReason(s, card, () => known),
      cards: [],
    });
  expect(JSON.stringify(s)).toBe(before);
};
const openBox = (s, card) => {
  expect(drawn(s, card), card).toMatchObject({ shown: true, locked: false });
  expect(canMove(s, card), `${card} can be entered`).toBe(true);
  expect(lockedQuest(s, card)).toBeNull();
};
// Nothing in the hand can act on a sealed resident.
const untouchable = (s, who) => {
  expect(entityActive(s, who), who).toBe(false);
  expect(
    legalActions(s).filter((a) => JSON.stringify(a).includes(who)),
    who,
  ).toEqual([]);
};

describe("Greek ways between the districts are plain roads", () => {
  const road = "greek-road-athens-eleusis",
    walls = "greek-road-athens-piraeus";

  it("draws the Sacred Way and the Long Walls open from every end with nothing carried", () => {
    for (const [way, end] of [
      [road, "greek-eleusis"],
      [road, "greek-athens"],
      [walls, "greek-athens"],
      [walls, "greek-piraeus"],
    ]) {
      const s = at(world(), end);
      expect(Object.keys(greek(s)), end).toEqual([]);
      openBox(s, way);
    }
  });
});

describe("Greek residents are locked boxes on their own present things", () => {
  // Each opens while its thing is at its post, nothing else (open-door-rework).
  const rows = [
    ["greek-aethra", "greek-eleusis", "greek-funeral-cloth", /^Bring Funeral Cloth home to Eleusinian Sanctuary$/u],
    ["greek-theseus", "greek-athens", "greek-burial-petition", /^Bring The Mothers’ Petition to Athenian Agora$/u],
    ["greek-quay-host", "greek-piraeus", "greek-wheat", /^Bring Sack of Wheat home to Piraeus Quays$/u],
    ["greek-colonus-keeper", "greek-colonus", "greek-oil-flask", /^Bring Funeral Oil home to Colonus Grove$/u],
    ["greek-argive-mother", "greek-eleusis", "greek-ash-urn", /^Bring The Funeral Urn home to Eleusinian Sanctuary$/u],
    ["greek-iphis", "greek-eleusis", "greek-ash-urn", /^Bring The Funeral Urn home to Eleusinian Sanctuary$/u],
    ["greek-household-witness", "greek-eleusis", "greek-ash-urn", /^Bring The Funeral Urn home to Eleusinian Sanctuary$/u],
  ];
  for (const [who, place, thing, reason] of rows)
    it(`${who} lies sealed at ${place} until ${thing} is there`, () => {
      const s = at(world(), place);
      // The place is on the table before the box can be met in it.
      expect(entityActive(s, place)).toBe(true);
      expect(drawn(s, who)).toMatchObject({ shown: true, locked: true });
      expect(drawn(s, who).reason).toMatch(reason);
      expect(lockedQuest(s, who, () => true).text).toMatch(reason);
      untouchable(s, who);
      // Its thing, and nothing else, turns the card over.
      s.usedUp = s.usedUp.filter((id) => id !== thing);
      s.items[thing].holder = place;
      expect(entityActive(s, who)).toBe(true);
      expect(drawn(s, who)).toMatchObject({ shown: true, locked: false });
    });

  it("holds the Eleusis locks apart: each waits on its own thing", () => {
    const s = at(world(), "greek-eleusis");
    s.items["greek-funeral-cloth"].holder = "greek-eleusis";
    expect(entityActive(s, "greek-aethra")).toBe(true);
    for (const who of [
      "greek-adrastus",
      "greek-argive-mother",
      "greek-iphis",
      "greek-household-witness",
    ])
      expect(drawn(s, who), who).toMatchObject({ shown: true, locked: true });
  });
});

describe("Lonely Forest ways are drawn locked", () => {
  const trail = "forest-trail";

  it("keeps the garden path latched and the oak path live, each with its want", () => {
    const route = (from) =>
      source("lonely-forest").routes.find((r) => r.from === from);
    expect(route("forest-oak").live).toBe(true);
    expect(route("forest-garden").live).toBeUndefined();

    let s = at(world(), "forest-garden");
    lockedBox(s, trail, /^Talk with RATi$/u);
    forest(s)["forest-path-cleared"] = true;
    openBox(s, trail);

    // The oak path follows the charm: open while it lies at the Oak, shut
    // again when it is carried away.
    s = at(world(), "forest-oak");
    lockedBox(s, trail, /^Bring Wolfprint Charm to Old Oak/u);
    s.items["forest-wolfprint-charm"].holder = "forest-oak";
    openBox(s, trail);
    s.items["forest-wolfprint-charm"].holder = "forest-trail";
    lockedBox(s, trail, /^Bring Wolfprint Charm to Old Oak/u);
  });
});
