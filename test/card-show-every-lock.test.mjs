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
          expect(sealed.reason, `${key} carries no authored text`).toBeUndefined();
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

describe("Greek gated ways are drawn locked and open on their old condition", () => {
  const road = "greek-road-athens-eleusis",
    walls = "greek-road-athens-piraeus";

  it("shows the Sacred Way from Eleusis until the request is heard and the petition is near", () => {
    const s = at(world(), "greek-eleusis");
    greek(s)["greek-open-door-open"] = true;
    lockedBox(s, road, /^Talk with Aethra$/u);
    // Either condition alone opens nothing.
    greek(s)["greek-open-door-mothers-heard"] = true;
    s.items["greek-burial-petition"].holder = "greek-piraeus";
    lockedBox(s, road, /Petition/u);
    s.items["greek-burial-petition"].holder = "greek-eleusis";
    greek(s)["greek-open-door-mothers-heard"] = false;
    lockedBox(s, road, /^Talk with Aethra$/u);
    greek(s)["greek-open-door-mothers-heard"] = true;
    openBox(s, road);
  });

  it("shows the Long Walls from both ends until Theseus has the plea and the truce is in the Agora", () => {
    for (const end of ["greek-athens", "greek-piraeus"]) {
      const s = at(world(), end);
      greek(s)["greek-open-door-open"] = true;
      lockedBox(s, walls, /^Talk with /u);
      greek(s)["greek-open-door-plea-registered"] = true;
      s.items["greek-olive-branch"].holder = "greek-piraeus";
      lockedBox(s, walls, /Herald’s Truce/u);
      s.items["greek-olive-branch"].holder = "greek-athens";
      greek(s)["greek-open-door-plea-registered"] = false;
      lockedBox(s, walls, /^Talk with /u);
      greek(s)["greek-open-door-plea-registered"] = true;
      openBox(s, walls);
    }
  });
});

describe("Greek conditional residents are locked boxes that cannot be played", () => {
  const rows = [
    ["greek-quay-host", "greek-piraeus", [], /^Bring .+ to /u],
    [
      "greek-argive-mother",
      "greek-eleusis",
      ["greek-open-door-open", "greek-open-door-bodies-returned"],
      /^Talk with Aethra$/u,
    ],
    [
      "greek-iphis",
      "greek-eleusis",
      ["greek-open-door-open", "greek-open-door-pyre-heard"],
      /^Talk with Theseus$/u,
    ],
    [
      "greek-household-witness",
      "greek-eleusis",
      ["greek-open-door-open", "greek-open-door-eleusis-done"],
      /^Give .+ to Theseus$/u,
    ],
  ];
  for (const [who, place, flags, reason] of rows)
    it(`${who} lies sealed at ${place} until ${flags.at(-1) ?? "the Open Door opens"}`, () => {
      const s = at(world(), place);
      // The place is on the table before the box can be met in it.
      if (place === "greek-eleusis") greek(s)["greek-open-door-open"] = true;
      expect(entityActive(s, place)).toBe(true);
      expect(drawn(s, who)).toMatchObject({ shown: true, locked: true });
      expect(drawn(s, who).reason).toMatch(reason);
      expect(lockedQuest(s, who, () => true).text).toMatch(reason);
      untouchable(s, who);
      // The old condition, and nothing else, turns the card over.
      for (const flag of flags.length ? flags : ["greek-open-door-open"])
        greek(s)[flag] = true;
      expect(entityActive(s, who)).toBe(true);
      expect(drawn(s, who)).toMatchObject({ shown: true, locked: false });
    });

  it("holds the other flags apart: the open flag alone leaves each Eleusis resident sealed", () => {
    const s = at(world(), "greek-eleusis");
    greek(s)["greek-open-door-open"] = true;
    for (const who of [
      "greek-argive-mother",
      "greek-iphis",
      "greek-household-witness",
    ])
      expect(drawn(s, who), who).toMatchObject({ shown: true, locked: true });
    // Aethra, whose only condition is the section's flag, is simply there.
    expect(entityActive(s, "greek-aethra")).toBe(true);
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
