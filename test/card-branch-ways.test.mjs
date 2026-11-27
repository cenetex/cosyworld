import { describe, expect, it } from "vitest";
import { exits, legalActions, nameOf } from "../v2/card-game/world.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { perception } from "../v2/card-game/perception.mjs";
import { HELEN, act, committed, greek, wait, witnessed } from "./fixtures/card-branch-ways.mjs";
import { ajaxTalk } from "./helpers/greek-ajax.mjs";

const TOMB = "greek-egypt-tomb",
  BEACH = "greek-troy-beach";
const HARBOR = "greek-harbor",
  SHIPMASTER = "greek-shipmaster",
  PAGASAE = "greek-pagasae",
  PILOT = "greek-pagasae-pilot",
  SCYLLA = "greek-scylla";
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

  it("keeps the Troy Walk out of the context of travelers who did not see it open", () => {
    const w = committed("troy");
    expect(exits(w, HARBOR, "vale")).toContain(BEACH);
    expect([named(w, TOMB), named(w, BEACH)]).toEqual([false, false]);
    expect(pull(w, BEACH)).toBeUndefined();
  });

  it("names the Troy Walk to a witness of the commitment", () => {
    const later = witnessed("troy");
    expect(said(later, "vale")).toContain(openWay(BEACH));
    expect(pull(later, BEACH)).toBe(BEACH);
    for (const id of ["vale", SHIPMASTER, HARBOR])
      expect(said(later, id)).not.toContain(nameOf(TOMB));
    expect(said(later, HARBOR)).not.toContain(openWay(BEACH));
  });

  it("names the Troy Walk to a reader who settled the tablet on the beach", () => {
    let w = committed("troy");
    w.items[HELEN].holder = "vale";
    w = act(w, "read", (a) => a.item === HELEN);
    w.actors.vale.place = BEACH;
    w = wait(w);
    w.actors.vale.place = HARBOR;
    w = wait(w);
    expect(said(w, "vale")).toContain(openWay(BEACH));
    expect(said(w, "vale")).not.toContain(nameOf(TOMB));
    expect(said(w, SHIPMASTER)).not.toContain(openWay(BEACH));
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
