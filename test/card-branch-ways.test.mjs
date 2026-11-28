import { describe, expect, it } from "vitest";
import { decodeSave, exits, legalActions, nameOf } from "../v2/card-game/world.mjs";
import { sawBranch } from "../v2/card-game/claims.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { perception } from "../v2/card-game/perception.mjs";
import { knowsPackChoice } from "../v2/card-game/speech-knowledge.mjs";
import { HELEN, act, committed, greek, wait, witnessed } from "./fixtures/card-branch-ways.mjs";
import { ajaxTalk } from "./helpers/greek-ajax.mjs";

const TOMB = "greek-egypt-tomb",
  BEACH = "greek-troy-beach";
const HARBOR = "greek-harbor",
  SHIPMASTER = "greek-shipmaster",
  PAGASAE = "greek-pagasae",
  PILOT = "greek-pagasae-pilot",
  SCYLLA = "greek-scylla",
  LEMNOS = "greek-lemnos",
  AJAX = "greek-ajax-landing";
const openWay = (place) => `The way to ${nameOf(place)} is open.`;
const said = (w, id) =>
  narrativeContext(w).entities.find((e) => e.id === id).facts.join("\n");
const named = (w, place) => JSON.stringify(narrativeContext(w)).includes(nameOf(place));
const pull = (w, to) =>
  perception(w, "vale", {
    speakers: ["vale"],
    entries: [],
    actor: "vale",
    present: [],
    desire: { location: to },
    location: w.actors.vale.place,
  }).pull;

describe("a way on one branch of the story is said only to who has settled it", () => {
  it("names neither branch's way while the world has not committed", () => {
    const w = wait(wait(greek()));
    expect(w.actors[SHIPMASTER].place).toBe(HARBOR);
    expect([named(w, TOMB), named(w, BEACH)]).toEqual([false, false]);
  });

  it("keeps the Homecoming Beach out of the context of travelers who did not hear the commitment", () => {
    const w = committed("troy");
    expect(exits(w, HARBOR, "vale")).not.toContain(BEACH);
    expect([named(w, TOMB), named(w, BEACH)]).toEqual([false, false]);
    expect(pull(w, BEACH)).toBeUndefined();
  });

  it("gives a witness of the Trojan account the Elder’s directions", () => {
    const later = witnessed("troy");
    expect(said(later, "vale")).toMatch(/Scylla at Pagasae.*Lemnos.*Homecoming Beach/);
    expect(pull(later, BEACH)).toBeUndefined();
    for (const id of ["vale", SHIPMASTER, HARBOR])
      expect(said(later, id)).not.toContain(nameOf(TOMB));
    expect(said(later, HARBOR)).not.toContain(openWay(BEACH));
  });

  it("records the Elder’s directions for a reader of the settled account", () => {
    let w = committed("troy");
    w.items[HELEN].holder = "vale";
    w = act(w, "read", (a) => a.item === HELEN);
    expect(said(w, "vale")).toMatch(/from Pagasae to Lemnos aboard the Scylla.*Homecoming Beach/);
    expect(said(w, "vale")).not.toContain(nameOf(TOMB));
    expect(said(w, SHIPMASTER)).not.toContain(openWay(BEACH));
  });

  it("preserves the directions for a traveler who heard the Elder before revision 47", () => {
    const pack = packDefinition("greek-drama");
    const choice = pack.choices.find((c) => c.id === "greek-helen-troy");
    const text = choice.text;
    let old;
    try {
      // Play the actual old Give, which used the ordinary action line.
      delete choice.text;
      old = witnessed("troy");
    } finally {
      choice.text = text;
    }
    const oldFact = Object.values(old.knowledge.facts).find((fact) =>
      fact.text === "Vale gives Helen’s Account Tablet to The Chorus Elder at Theban Market Well.");
    expect(oldFact).toBeDefined();
    old.packs[pack.id].revision = 46;
    const loaded = decodeSave(JSON.stringify(old));
    expect(loaded.knowledge.facts[oldFact.id]).toEqual(oldFact);
    expect(sawBranch(loaded, "vale", pack.id, "greek-helen-account")).toBe(true);
    expect(knowsPackChoice(loaded, "vale", pack, choice)).toBe(true);
    expect(said(loaded, "vale")).toMatch(/Scylla at Pagasae.*Lemnos.*Homecoming Beach/);
  });

  it("offers the Homecoming Beach course at Lemnos only after the Trojan account", () => {
    for (const [w, canSetCourse] of [[greek(), false], [witnessed("egypt"), false], [witnessed("troy"), true]]) {
      w.actors.vale.place = PAGASAE;
      const informed = ajaxTalk(w, `lane:${PAGASAE}>${LEMNOS}`, { target: PILOT });
      const aboard = act(informed, "move", (a) => a.target === SCYLLA);
      const courses = (world) => legalActions(world, "vale")
        .filter((a) => a.kind === "course").map((a) => a.target);
      expect(courses(aboard)).not.toContain(BEACH);
      const atLemnos = wait(act(aboard, "course", (a) => a.target === LEMNOS));
      expect(courses(atLemnos).includes(BEACH)).toBe(canSetCourse);
      expect(courses(atLemnos)).not.toContain(AJAX);
    }
  });

  it("directs travelers to the Scylla when the Egypt account is settled", () => {
    const heard = witnessed("egypt");
    for (const w of [committed("egypt"), heard]) {
      expect(exits(w, HARBOR, "vale")).not.toContain(TOMB);
      expect(pull(w, TOMB)).toBeUndefined();
      expect(JSON.stringify(narrativeContext(w))).not.toContain(openWay(TOMB));
    }
    expect(said(heard, "vale")).toMatch(/Pagasae, where the Scylla can take them/);
    for (const [w, canSetCourse] of [[greek(), false], [heard, true]]) {
      w.actors.vale.place = PAGASAE;
      const briefed = ajaxTalk(w, `lane:${PAGASAE}>greek-lemnos`, {
        target: PILOT,
      });
      const aboard = act(briefed, "move", (a) => a.target === SCYLLA);
      expect(aboard.actors.vale.place).toBe(SCYLLA);
      expect(
        legalActions(aboard, "vale").some((a) => a.kind === "course" && a.target === TOMB),
      ).toBe(canSetCourse);
    }
  });
});
