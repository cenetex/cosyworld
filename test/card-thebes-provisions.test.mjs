import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  exits,
  legalActions,
  nameOf,
  play,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { availableCards, sealedReason } from "../v2/card-game/cards.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { DAYLIGHT_TURNS } from "../v2/card-game/pack-rules.mjs";
import { wantFact } from "../v2/card-game/want-talk.mjs";
import { greekTravelTargets } from "./helpers/greek-travel.mjs";
import { openingFixture } from "./helpers/greek-opening.mjs";

// Thebes on rules 95: Myrto packs the provisions from Dione's bread, the
// sanctuary's figs and the gate's wine skin; the voyage out spends them, and
// each ingredient regrows at home at dawn. The burial rites use up the
// funeral cloth and oil, which regrow at Eleusis and Colonus. The guard lifts
// the bar for the Burial Decree or Creon's writ.
const pack = packDefinition("greek-drama");
const SET = ["greek-bread", "greek-figs", "greek-wine-skin"];
const reload = (s) => decodeSave(encodeSave(s));
function act(s, kind, fields = {}) {
  const action = legalActions(s).find(
    (a) =>
      a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  expect(action, `${kind} ${JSON.stringify(fields)}`).toBeTruthy();
  const result = play(s, action, s.revision);
  expect(result.ok, result.error).toBe(true);
  return result.state;
}
const walk = (s, ...ids) =>
  ids.reduce(
    (w, id) =>
      greekTravelTargets(w.actors.vale.place, `greek-${id}`).reduce(
        (x, target) => act(x, "move", { target }),
        w,
      ),
    s,
  );
const take = (s, item) => act(s, "take", { item });
// The next light change of a kind, reached by Waiting through it.
function until(s, light) {
  let t = (Math.floor(s.turn / DAYLIGHT_TURNS) + 1) * DAYLIGHT_TURNS;
  if ((t / DAYLIGHT_TURNS) % 2 !== (light === "dawn" ? 0 : 1))
    t += DAYLIGHT_TURNS;
  s.turn = t - 1;
  s.revision = Math.max(s.revision, s.turn);
  return act(reload(s), "wait", { sleep: undefined });
}
// A new world in the Theban courtyard with the water jar in hand.
function courtyard() {
  const s = enableMotives(createWorld());
  s.actors.vale.place = "greek-courtyard";
  s.crossings["pond-greek-harbor"].discovered = true;
  for (const id of ["lamp", "cloth"]) s.items[id].holder = "pond";
  s.items["greek-water-jar"].holder = "vale";
  return reload(s);
}
// Gather the set from its three quarters and give it to Myrto.
function provision(s) {
  s = walk(s, "courtyard");
  s = take(s, "greek-bread");
  s = take(walk(s, "palace", "sanctuary"), "greek-figs");
  s = take(walk(s, "palace", "courtyard", "gate"), "greek-wine-skin");
  s = walk(s, "courtyard", "harbor");
  return act(s, "give", { item: "greek-figs", target: "greek-shipmaster" });
}

describe("the Theban provisions loop", () => {
  it("packs, spends and regrows the provisions, one of each, twice over", () => {
    let s = act(courtyard(), "give", {
      item: "greek-water-jar",
      target: "greek-baker",
    });
    expect(s.usedUp).toEqual(["greek-provisions"]);
    expect(wantFact(s, "greek-shipmaster", nameOf)).toBe(
      "I want the Travel Provisions: the Courtyard Bread, the Dried Figs and the Wine Skin.",
    );
    for (let lap = 1; lap <= 2; lap++) {
      s = provision(s);
      expect(s.items["greek-provisions"].holder).toBe("greek-harbor");
      expect(s.usedUp).toEqual([...SET].sort());
      // Myrto leaves what she packs on the landing.
      s = take(s, "greek-provisions");
      s = act(s, "move", { target: "greek-ship" });
      s = act(s, "course", { target: "greek-piraeus" });
      s = act(s, "wait", { sleep: undefined });
      expect(s.usedUp).toEqual(["greek-provisions", ...SET].sort());
      expect(
        s.log.some(
          (e) => e.text === "The voyage uses up the Travel Provisions.",
        ),
      ).toBe(true);
      // The way home is free.
      s = act(s, "course", { target: "greek-harbor" });
      s = act(s, "wait", { sleep: undefined });
      s = act(s, "move", { target: "greek-harbor" });
      s = until(s, "dawn");
      expect(s.usedUp).toEqual(["greek-provisions"]);
      for (const id of SET)
        expect(s.items[id].holder).toBe(pack.items[id].home);
    }
  });

  it("takes wine only and keeps a lone ingredient an ordinary gift", () => {
    let s = act(courtyard(), "give", {
      item: "greek-water-jar",
      target: "greek-baker",
    });
    s = take(take(s, "greek-bread"), "greek-water-jar");
    s = act(walk(s, "harbor"), "give", {
      item: "greek-bread",
      target: "greek-shipmaster",
    });
    // Myrto declines a lone loaf, and water is no substitute for wine.
    expect(s.items["greek-bread"].holder).toBe("vale");
    expect(s.usedUp).toEqual(["greek-provisions"]);
    // Paying Myrto with the provisions no longer takes them off the ship's
    // way: she declines them.
    expect(pack.avatars["greek-shipmaster"].values["greek-provisions"]).toBe(1);
  });

  it("names the wine skin, not water, in the provisions", () => {
    expect(pack.items["greek-provisions"].text).toMatch(/wine skin/u);
    expect(pack.items["greek-provisions"].text).not.toMatch(/water/u);
    expect(pack.items["greek-libation"]).toMatchObject({
      home: "greek-cithaeron",
      regrow: "dawn",
    });
  });
});

describe("the burial supplies", () => {
  it("are used up by the defiant rite and regrow at Eleusis and Colonus", () => {
    let s = openingFixture("burial").closed;
    expect(s.usedUp).toEqual(
      expect.arrayContaining(["greek-funeral-cloth", "greek-oil-flask"]),
    );
    // The shovel is a tool: it stays where it was used.
    expect(s.items["greek-shovel"].holder).toBe("greek-battlefield");
    s = until(s, "dawn");
    expect(s.items["greek-funeral-cloth"].holder).toBe("greek-eleusis");
    expect(s.items["greek-oil-flask"].holder).toBe("greek-colonus");
  });

  it("are used up by the permitted rite too", () => {
    const s = openingFixture("concession").closed;
    expect(s.packs["greek-drama"].flags["greek-burial-performed"]).toBe(true);
    expect(s.usedUp).toEqual(
      expect.arrayContaining(["greek-funeral-cloth", "greek-oil-flask"]),
    );
  });

  it("stay on the grave through a dawn until the rite", () => {
    // Waiting on the battlefield would perform the rite, so wait at the gate.
    // The writ's road through the Open Door makes Eleusis and Colonus live.
    let s = walk(openingFixture("concession").beforeRite, "gate");
    expect(s.packs["greek-drama"].flags["greek-open-door-open"]).toBe(true);
    // The fixture's long errand already saw them there at one dawn; take
    // them as laid since the last dawn.
    expect(Object.keys(s.astray)).toContain("greek-funeral-cloth");
    delete s.astray;
    // Laid on the grave through a dawn, they are only noted, not swept home.
    s = until(s, "dawn");
    expect(s.items["greek-funeral-cloth"].holder).toBe("greek-battlefield");
    expect(s.items["greek-oil-flask"].holder).toBe("greek-battlefield");
    expect(s.astray).toMatchObject({
      "greek-funeral-cloth": "greek-battlefield",
      "greek-oil-flask": "greek-battlefield",
    });
    // Left there a whole day, they go home at the next dawn.
    s = until(s, "dawn");
    expect(s.items["greek-funeral-cloth"].holder).toBe("greek-eleusis");
    expect(s.items["greek-oil-flask"].holder).toBe("greek-colonus");
  });
});

describe("the City Gate", () => {
  it("shows a sealed card whose quest is the decree for the guard", () => {
    let s = openingFixture("burial").decree;
    expect(availableCards(s)).toContain("greek-battlefield");
    expect(sealedReason(s, "greek-battlefield")).toBe(
      "The guard lifts the bar for an order from the palace: the Burial Decree or Creon's writ.",
    );
    s = act(s, "gate", { target: "greek-battlefield" });
    expect(s.actors.vale.want).toMatchObject({
      kind: "item",
      target: "greek-decree",
      step: { verb: "give", to: "greek-guard" },
    });
    s = take(walk(s, "palace"), "greek-decree");
    s = act(walk(s, "gate"), "give", {
      item: "greek-decree",
      target: "greek-guard",
    });
    expect(sealedReason(s, "greek-battlefield")).toBe(null);
    expect(exits(s, "greek-gate", "vale")).toContain("greek-battlefield");
  });

  it("opens for Creon's writ under the same saved gate, and the guard gives it back", () => {
    let s = openingFixture("concession", { reportFirst: false }).permission;
    s = act(s, "drop", {
      item: "greek-household-token",
      target: "greek-palace",
    });
    s = take(s, "greek-creon-writ");
    s = walk(s, "courtyard", "gate");
    expect(exits(s, "greek-gate", "vale")).not.toContain("greek-battlefield");
    s = act(s, "give", { item: "greek-creon-writ", target: "greek-guard" });
    expect(s.items["greek-creon-writ"].holder).toBe("greek-guard");
    expect(s.openedRoutes).toContain("greek-gate>greek-battlefield");
    s = act(s, "ask", { item: "greek-creon-writ", target: "greek-guard" });
    expect(s.items["greek-creon-writ"].holder).toBe("vale");
    expect(exits(reload(s), "greek-gate", "vale")).toContain(
      "greek-battlefield",
    );
  });

  it("does not lock the world into the report for a shovel alone", () => {
    let s = openingFixture("burial").decree;
    s = act(take(s, "greek-shovel"), "give", {
      item: "greek-shovel",
      target: "greek-guard",
    });
    expect(s.packs["greek-drama"].choices["greek-theban-response"]).toBe(
      undefined,
    );
    expect(s.items["greek-shovel"].holder).toBe("vale");
  });
});
