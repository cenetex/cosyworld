import { describe, expect, it } from "vitest";
import { createPipWorld } from "../v2/card-game/pip-landing.mjs";
import {
  decodeSave,
  legalActions,
  questOffers,
  residentOffer,
  validateWorld,
} from "../v2/card-game/world.mjs";
import {
  MAX_HELD,
  heldOf,
  holdQuest,
  levelFor,
  newWant,
  slotsUsed,
} from "../v2/card-game/want.mjs";
import { CALLS, recordOf } from "../v2/card-game/world/arcana-record.mjs";
import { act } from "./helpers/play.mjs";

const FROM = "quest:from:moth";
const tell = (s) => act(s, (a) => a.kind === "talk" && a.target === "moth");
const talk = (s) => act(tell(s), (a) => a.kind === "accept" && a.target === "moth");
const wait = (s) => act(s, (a) => a.kind === "wait" && !a.sleep && !a.guards);
const give = (s) =>
  act(s, (a) => a.kind === "give" && a.item === "lamp" && a.target === "moth");
const sources = (s) => heldOf(s.actors.vale).map((w) => w.from);
const TARGETS = [
  ["place", "attic"],
  ["place", "station"],
  ["item", "bell"],
  ["item", "cloth"],
];
const boxQuests = (s, n) =>
  TARGETS.slice(0, n).map(([kind, target], i) => ({
    ...newWant(kind, target, s.turn),
    from: `quest:box:slot-${i}`,
  }));
const fill = (s, n) => {
  for (const w of boxQuests(s, n)) holdQuest(s, "vale", w, w.from);
  return s;
};
const ready = () => {
  const s = talk(createPipWorld(5));
  s.items.lamp.holder = "vale";
  s.actors.moth.place = s.actors.vale.place;
  return s;
};

describe("three quest slots", () => {
  it("holds three quests and leaves a fourth offer unaccepted", () => {
    expect(MAX_HELD).toBe(3);
    const s = fill(createPipWorld(5), 3);
    expect(slotsUsed(s.actors.vale)).toBe(3);
    const after = tell(s);
    expect(residentOffer(after, "vale", "moth")).toMatchObject({ source: "moth", full: true });
    expect(legalActions(after).some((a) => a.kind === "accept")).toBe(false);
    expect(sources(after)).not.toContain(FROM);
    expect(heldOf(after.actors.vale)).toHaveLength(3);
    expect(questOffers(after)).toEqual([]);
  });

  it("loads a save with five held quests as three, and a released one is offered again on Talk", () => {
    const s = talk(createPipWorld(5));
    const pip = s.actors.vale.want;
    const extra = boxQuests(s, 4);
    s.actors.vale.want = extra[0];
    s.actors.vale.under = [...extra.slice(1), pip];
    expect(heldOf(s.actors.vale)).toHaveLength(5);
    let loaded = decodeSave(JSON.stringify(s));
    expect(validateWorld(loaded)).toBeTruthy();
    expect(sources(loaded)).toEqual(extra.slice(0, 3).map((w) => w.from));
    expect(loaded.actors.vale.closed?.[FROM]).toBeUndefined();
    loaded = act(loaded, (a) => a.kind === "drop" && !a.item && a.quest === 0);
    expect(sources(loaded)).not.toContain(FROM);
    loaded = talk(loaded);
    expect(sources(loaded)).toContain(FROM);
    expect(heldOf(loaded.actors.vale)).toHaveLength(3);
  });

  it("discards the second held quest and keeps the others", () => {
    const s = fill(talk(createPipWorld(5)), 1);
    expect(sources(s)).toEqual(["quest:box:slot-0", FROM]);
    const drops = legalActions(s).filter((a) => a.kind === "drop" && !a.item);
    expect(drops.map((a) => a.quest)).toEqual([0, 1]);
    const after = act(s, (a) => a.kind === "drop" && !a.item && a.quest === 1);
    expect(sources(after)).toEqual(["quest:box:slot-0"]);
    expect(after.actors.vale.closed[FROM]).toBeTruthy();
  });
});

describe("resident quests", () => {
  it("raise the resident's trust and rank by one when the traveler meets them", () => {
    const s = ready();
    const trust = s.actors.moth.trust.vale,
      rank = levelFor(s.actors.moth.xp),
      xp = s.actors.vale.xp;
    const after = give(s);
    expect(sources(after)).not.toContain(FROM);
    expect(after.actors.moth.trust.vale).toBe(trust + 1);
    expect(levelFor(after.actors.moth.xp)).toBe(rank + 1);
    expect(after.actors.vale.xp).toBe(xp);
  });

  it("count toward the Listener's call, and box quests do not", () => {
    const s = ready();
    holdQuest(s, "vale", newWant("item", "lamp", s.turn), "quest:box:test");
    let after = wait(s);
    expect(sources(after)).toEqual([FROM]);
    expect(recordOf(after, "vale").calls).toBe(0);
    after = give(after);
    expect(recordOf(after, "vale").calls).toBe(1);
  });

  it("stop counting at three", () => {
    const s = ready();
    s.actors.vale.arcana = { proved: [], did: [], calls: CALLS };
    const after = give(s);
    expect(sources(after)).not.toContain(FROM);
    expect(recordOf(after, "vale").calls).toBe(3);
    const bad = structuredClone(after);
    bad.actors.vale.arcana.calls = 4;
    expect(() => validateWorld(bad)).toThrow();
  });
});
