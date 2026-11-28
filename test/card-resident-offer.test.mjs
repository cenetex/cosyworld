import { afterEach, describe, expect, it } from "vitest";
import "./helpers/still-cast.mjs";
import { questing } from "./helpers/first-quest.mjs";
import { lifeWorld } from "./helpers/world-life.mjs";
import {
  createWorld,
  legalActions,
  lockedOffer,
  residentOffer,
} from "../v2/card-game/world.mjs";
import { MAX_HELD, heldOf, holdQuest, newWant, slotsUsed } from "../v2/card-game/want.mjs";
import { offerFrom } from "../v2/card-game/offer-chance.mjs";
import { offerCard, offerWords } from "../v2/card-game/quest-card.mjs";
import { packPeople } from "../v2/card-game/pack-registry.mjs";
import { knowsFact, questFactId } from "../v2/card-game/knowledge.mjs";
import { act, reload } from "./helpers/play.mjs";

const talk = (s, who = "moth") => act(s, (a) => a.kind === "talk" && a.target === who);
const accept = (s, who = "moth") => act(s, (a) => a.kind === "accept" && a.target === who);
const wait = (s) => act(s, (a) => a.kind === "wait" && !a.sleep && !a.guards);
const residentAccepts = (s) => legalActions(s).filter((a) =>
  a.kind === "accept" && !a.box && !a.place && !a.tarot);
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
      expect(residentAccepts(s)).toMatchObject([{ target: "moth", cards: [] }]);
      expect(sources(s)).toEqual([]);
    }
  });

  it("is worded as the resident asking, naming nothing undiscovered", () => {
    const quest = offerCard(talk(station()), "vale", null, "moth");
    expect(quest).toMatchObject({ offer: "moth", kind: "item", target: "lamp" });
    expect(offerWords(quest)).toBe("Pip asks for the Lamp");
    expect(offerWords(quest, (id) => id !== "lamp")).toBe(
      "Pip asks for something you haven't found",
    );
  });

  it("lies locked among the resident's things until a Talk tells it", () => {
    const s = station();
    const fact = questFactId("moth", s.actors.moth.want);
    expect(lockedOffer(s, "vale", "moth")).toMatchObject({ source: "moth" });
    expect(offerCard(s, "vale", null, "moth")).toBeNull();
    expect(knowsFact(s, "vale", fact)).toBe(false);
    expect(residentAccepts(s)).toEqual([]);
    const told = talk(s);
    expect(knowsFact(told, "vale", fact)).toBe(true);
    expect(lockedOffer(told, "vale", "moth")).toBeNull();
    expect(residentAccepts(told)).toMatchObject([{ target: "moth" }]);
  });

  it("stands after the next play once told, while the want is still theirs", () => {
    const s = wait(talk(station()));
    expect(offerFrom(s, "vale")).toBeNull();
    expect(residentAccepts(s)).toMatchObject([{ target: "moth" }]);
    expect(offerCard(s, "vale", null, "moth")).toMatchObject({ offer: "moth" });
    s.actors.moth.want = null;
    expect(residentAccepts(s)).toEqual([]);
  });

  it("fills a slot on Accept, passing no turn, and saves as it plays", () => {
    const told = talk(station());
    const s = accept(told);
    expect(s.turn).toBe(told.turn);
    expect(sources(s)).toEqual(["quest:from:moth"]);
    expect(slotsUsed(s.actors.vale)).toBe(1);
    expect(offerFrom(s, "vale")).toBeNull();
    expect(residentAccepts(s)).toEqual([]);
    expect(reload(s)).toEqual(s);
  });

  it("stands with the slots full, but Accept waits for a free slot", () => {
    const s = station();
    for (const [kind, target] of [["place", "attic"], ["item", "cloth"], ["item", "bell"]].slice(0, MAX_HELD))
      holdQuest(s, "vale", newWant(kind, target, s.turn), `quest:box:${target}`);
    const told = talk(s);
    expect(residentOffer(told, "vale", "moth")).toMatchObject({ source: "moth", full: true });
    expect(offerCard(told, "vale", null, "moth")).toMatchObject({ full: true });
    expect(residentAccepts(told)).toEqual([]);
  });

  it("offers nothing when no quest is available", () => {
    const none = station();
    none.actors.moth.want = null;
    expect(offerFrom(talk(none), "vale")).toBeNull();
    const met = station();
    met.items.lamp.holder = "moth";
    expect(residentAccepts(talk(met))).toEqual([]);
    const held = accept(talk(station()));
    expect(residentAccepts(talk(held))).toEqual([]);
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
    expect(residentAccepts(at(0))).toEqual([]);
    expect(residentAccepts(at(1))).toMatchObject([{ target: R }]);
  });
});
