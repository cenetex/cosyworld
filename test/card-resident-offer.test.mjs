import { afterEach, describe, expect, it } from "vitest";
import "./helpers/still-cast.mjs";
import { questing } from "./helpers/first-quest.mjs";
import { lifeWorld } from "./helpers/world-life.mjs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
  residentOffer,
} from "../v2/card-game/world.mjs";
import { MAX_HELD, heldOf, holdQuest, newWant, slotsUsed } from "../v2/card-game/want.mjs";
import { offerFrom } from "../v2/card-game/offer-chance.mjs";
import { offerCard, offerLapse, offerWords } from "../v2/card-game/quest-card.mjs";
import { packPeople } from "../v2/card-game/pack-registry.mjs";

const act = (s, pick, actor = "vale") => {
  const action = legalActions(s, actor).find(pick);
  expect(action, "a legal play").toBeTruthy();
  const done = play(s, action, s.revision, actor);
  expect(done.ok, done.error).toBe(true);
  return done.state;
};
const talk = (s, who = "moth") => act(s, (a) => a.kind === "talk" && a.target === who);
const accept = (s, who = "moth") => act(s, (a) => a.kind === "accept" && a.target === who);
const wait = (s) => act(s, (a) => a.kind === "wait" && !a.sleep && !a.guards);
const accepts = (s) => legalActions(s).filter((a) => a.kind === "accept");
const sources = (s) => heldOf(s.actors.vale).map((w) => w.from);

function station(turn = 0) {
  const s = questing(createWorld());
  for (const id of ["vale", "moth", "keeper"]) s.actors[id].place = "station";
  s.items.lamp.holder = "vale";
  s.actors.vale.want = null;
  s.actors.moth.trust.vale = 0;
  s.turn = s.revision = turn;
  return s;
}

describe("a resident's offer after Talk", () => {
  it("comes every time a quest is available, from a stranger too", () => {
    for (let turn = 0; turn < 24; turn++) {
      const s = talk(station(turn));
      expect(offerFrom(s, "vale")).toBe("moth");
      expect(accepts(s)).toMatchObject([{ target: "moth", cards: [] }]);
      expect(sources(s)).toEqual([]);
    }
  });

  it("is worded as the resident asking, naming nothing undiscovered", () => {
    const quest = offerCard(talk(station()));
    expect(quest).toMatchObject({ offer: "moth", kind: "item", target: "lamp" });
    expect(offerWords(quest)).toBe("Pip asks for the Lamp");
    expect(offerWords(quest, (id) => id !== "lamp")).toBe(
      "Pip asks for something you haven't found",
    );
  });

  it("lapses on deselect, and Talk again offers it again", () => {
    const lapse = offerLapse();
    let s = talk(station());
    const first = offerCard(s);
    expect(lapse.sync(first, false)).toBe(true);
    expect(lapse.sync(first, true)).toBe(false);
    expect(lapse.standing(first)).toBe(first);
    expect(lapse.sync(first, false)).toBe(false);
    expect(lapse.standing(first)).toBeNull();
    expect(lapse.sync(first, true)).toBe(false);
    expect(lapse.standing(first)).toBeNull();
    s = talk(s);
    const again = offerCard(s);
    expect(again.key).not.toBe(first.key);
    expect(lapse.sync(again, false)).toBe(true);
    expect(lapse.standing(again)).toBe(again);
  });

  it("lapses in the rules at the next play", () => {
    let s = wait(talk(station()));
    expect(offerFrom(s, "vale")).toBeNull();
    expect(accepts(s)).toEqual([]);
    expect(offerCard(s)).toBeNull();
    s = talk(s);
    expect(accepts(s)).toHaveLength(1);
  });

  it("fills a slot on Accept, passing no turn, and saves as it plays", () => {
    const told = talk(station());
    const s = accept(told);
    expect(s.turn).toBe(told.turn);
    expect(sources(s)).toEqual(["quest:from:moth"]);
    expect(slotsUsed(s.actors.vale)).toBe(1);
    expect(offerFrom(s, "vale")).toBeNull();
    expect(accepts(s)).toEqual([]);
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });

  it("stands with the slots full, but Accept waits for a free slot", () => {
    const s = station();
    for (const [kind, target] of [["place", "attic"], ["place", "pond"], ["item", "bell"]].slice(0, MAX_HELD))
      holdQuest(s, "vale", newWant(kind, target, s.turn), `quest:box:${target}`);
    const told = talk(s);
    expect(residentOffer(told)).toMatchObject({ source: "moth", full: true });
    expect(offerCard(told)).toMatchObject({ full: true });
    expect(accepts(told)).toEqual([]);
  });

  it("offers nothing when no quest is available", () => {
    const none = station();
    none.actors.moth.want = null;
    expect(offerFrom(talk(none), "vale")).toBeNull();
    const met = station();
    met.items.lamp.holder = "moth";
    expect(accepts(talk(met))).toEqual([]);
    const held = accept(talk(station()));
    expect(accepts(talk(held))).toEqual([]);
  });
});

describe("trust still gates a want told only to the trusted", () => {
  const R = "greek-ismene";
  const saved = { want: packPeople[R].want, wants: packPeople[R].wants };
  afterEach(() => {
    packPeople[R].want = saved.want;
    if (saved.wants === undefined) delete packPeople[R].wants;
    else packPeople[R].wants = saved.wants;
  });

  it("offers a minTrust want only once that trust is reached", () => {
    const at = (trust) => {
      const s = lifeWorld();
      for (const id of ["vale", R]) s.actors[id].place = "greek-gate";
      delete packPeople[R].wants;
      packPeople[R].want = { kind: "item", target: "lamp", minTrust: 1 };
      s.actors[R].want = { kind: "item", target: "lamp", since: s.turn, refusals: 0 };
      s.items.lamp.holder = "vale";
      s.actors[R].trust.vale = trust;
      return talk(s, R);
    };
    expect(accepts(at(0))).toEqual([]);
    expect(accepts(at(1))).toMatchObject([{ target: R }]);
  });
});
