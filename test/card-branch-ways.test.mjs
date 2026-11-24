import { describe, expect, it } from "vitest";
import { createWorld, exits, legalActions, nameOf, play } from "../v2/card-game/world.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { perception } from "../v2/card-game/perception.mjs";

const HELEN = "greek-helen-accounts",
  TOMB = "greek-egypt-tomb",
  BEACH = "greek-troy-beach";
const PLACE = { egypt: TOMB, troy: BEACH };
const act = (w, kind, test = () => true) => {
  const action = legalActions(w, "vale").find((a) => a.kind === kind && !a.sleep && test(a));
  if (!action) throw new Error(`vale cannot ${kind}`);
  return play(w, action).state;
};
const wait = (w) => act(w, "wait");
const greek = (place = "greek-harbor") => {
  const w = createWorld({ packScopes: { "greek-drama": "full" } });
  w.crossings["pond-greek-harbor"].discovered = true;
  w.actors.vale.place = place;
  return w;
};
const committed = (value) => {
  const w = wait(greek());
  w.packs["greek-drama"].choices["greek-helen-account"] = value;
  w.packs["greek-drama"].receipts[`greek-helen-${value}`] = w.turn;
  return wait(w);
};
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
    expect(w.actors["greek-shipmaster"].place).toBe("greek-harbor");
    expect([named(w, TOMB), named(w, BEACH)]).toEqual([false, false]);
  });

  for (const value of ["egypt", "troy"]) {
    const open = PLACE[value],
      other = PLACE[value === "egypt" ? "troy" : "egypt"];
    it(`names neither way at the harbour to those who did not see it commit to ${value}`, () => {
      const w = committed(value);
      expect(exits(w, "greek-harbor", "vale")).toContain(open);
      expect([named(w, TOMB), named(w, BEACH)]).toEqual([false, false]);
      expect(pull(w, open)).toBeUndefined();
    });

    it(`names the open way to a witness of the ${value} commit, and never the other`, () => {
      const [at, subject] = value === "egypt" ? ["greek-harbor", "greek-shipmaster"] : ["greek-well", "greek-elder"];
      const w = greek(at);
      w.items[HELEN].holder = "vale";
      const after = act(w, "give", (a) => a.item === HELEN && a.target === subject);
      after.actors.vale.place = "greek-harbor";
      const later = wait(after);
      expect(said(later, "vale")).toContain(`The way to ${nameOf(open)} is open.`);
      expect(pull(later, open)).toBe(open);
      for (const id of ["vale", "greek-shipmaster", "greek-harbor"])
        expect(said(later, id)).not.toContain(nameOf(other));
      expect(said(later, "greek-harbor")).not.toContain(nameOf(open));
    });
  }

  it("names the open way to a reader who settled the tablet at the tomb", () => {
    let w = committed("egypt");
    w.items[HELEN].holder = "vale";
    w = act(w, "read", (a) => a.item === HELEN);
    w.actors.vale.place = TOMB;
    w = wait(w);
    w.actors.vale.place = "greek-harbor";
    w = wait(w);
    expect(said(w, "vale")).toContain(`The way to ${nameOf(TOMB)} is open.`);
    expect(said(w, "vale")).not.toContain(nameOf(BEACH));
    expect(said(w, "greek-shipmaster")).not.toContain(nameOf(TOMB));
  });
});
