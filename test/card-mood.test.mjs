import { afterEach, describe, expect, it } from "vitest";
import { createWorld } from "../v2/card-game/world.mjs";
import { packDefinitions } from "../v2/card-game/pack-registry.mjs";
import { CONTENT_TURNS, STALL_TURNS, newWant } from "../v2/card-game/want.mjs";
import { MOODS, moodFact, moodOf } from "../v2/card-game/mood.mjs";
import {
  faceArt,
  fightPortrait,
  registerFaceArt,
} from "../v2/card-game/mood-art.mjs";
import { combatPortrait } from "../v2/card-game/combat-portraits.mjs";
import { portrait } from "../v2/card-game/scene.mjs";
import { activeGrievances } from "../v2/card-game/motives.mjs";

const world = () => createWorld({ seed: 7 });
// A resident with a plain state: no want, not content, nothing recorded.
const calm = (s, id = "moth") => {
  const a = s.actors[id];
  a.want = null;
  delete a.under;
  delete a.content;
  delete a.metTurn;
  delete a.gaveUp;
  return a;
};
const grieve = (s, id, other, turn = s.turn) => {
  s.motives.grievances[id] = [
    { other, weight: 2, turn, lastTouched: turn, repaired: false },
  ];
};
afterEach(() => {
  for (const id of Object.keys(faceArt)) delete faceArt[id];
});

describe("moods", () => {
  it("is plain by default and keeps its rules in one readable list", () => {
    const s = world();
    calm(s);
    expect(moodOf(s, "moth")).toBeNull();
    expect(moodOf(s, "nobody")).toBeNull();
    expect(MOODS.map((r) => r.mood)).toEqual([
      "sad", "sad", "sad", "sad", "happy",
    ]);
    for (const rule of MOODS) expect(rule.says).toMatch(/^[A-Z]/u);
  });

  it("is happy for the content day after a want is met, then passes", () => {
    const s = world();
    const a = calm(s);
    s.turn = 10;
    a.content = true;
    a.metTurn = 10;
    expect(moodOf(s, "moth")).toBe("happy");
    expect(moodFact(s, "moth")).toBe("I feel happy.");
    s.turn = 10 + CONTENT_TURNS - 1;
    expect(moodOf(s, "moth")).toBe("happy");
    s.turn = 10 + CONTENT_TURNS;
    expect(moodOf(s, "moth")).toBeNull();
    expect(moodFact(s, "moth")).toBeNull();
    a.want = newWant("place", "pond", s.turn);
    s.turn = 11;
    expect(moodOf(s, "moth")).toBeNull();
  });

  it("is not happy when the wanted thing was handed over under pressure", () => {
    const s = world();
    const a = calm(s);
    s.turn = 10;
    a.content = true;
    a.metTurn = 10;
    s.log.push({ seq: 99, turn: 10, kind: "action", verb: "give",
      targetId: "moth", handover: { kind: "pressure" } });
    expect(moodOf(s, "moth")).toBeNull();
    // A gift on another turn does not take the happiness away.
    s.log.at(-1).turn = 9;
    expect(moodOf(s, "moth")).toBe("happy");
  });

  it("is sad while someone who wronged it is in the room", () => {
    const s = world();
    calm(s);
    s.actors.moth.place = s.actors.vale.place = "pond";
    grieve(s, "moth", "vale");
    expect(moodOf(s, "moth")).toBe("sad");
    s.actors.vale.place = "attic";
    expect(moodOf(s, "moth")).toBeNull();
    s.actors.vale.place = "pond";
    s.motives.grievances.moth[0].repaired = true;
    expect(moodOf(s, "moth")).toBeNull();
    s.motives.grievances.moth[0].repaired = false;
    s.turn += 24;
    expect(activeGrievances(s, "moth")).toHaveLength(0);
    expect(moodOf(s, "moth")).toBeNull();
  });

  it("is sad after giving up a want, until a want is met or the day ends", () => {
    const s = world();
    const a = calm(s);
    s.turn = 30;
    a.gaveUp = { target: "lamp", turn: 30 };
    expect(moodOf(s, "moth")).toBe("sad");
    a.metTurn = 31;
    expect(moodOf(s, "moth")).toBeNull();
    delete a.metTurn;
    s.turn = 30 + CONTENT_TURNS;
    expect(moodOf(s, "moth")).toBeNull();
  });

  it("does not count a player's own Drop as giving up", () => {
    const s = world();
    s.actors.vale.gaveUp = { target: "lamp", turn: s.turn };
    expect(moodOf(s, "vale")).toBeNull();
  });

  it("is sad when someone here holds the wanted thing and refused it", () => {
    const s = world();
    const a = calm(s);
    s.turn = 5;
    s.actors.moth.place = s.actors.vale.place = "pond";
    s.items.lamp.holder = "vale";
    a.want = { ...newWant("item", "lamp", 5), refusals: 1 };
    expect(moodOf(s, "moth")).toBe("sad");
    a.want.refusals = 0;
    expect(moodOf(s, "moth")).toBeNull();
    a.want.refusals = 1;
    s.actors.vale.place = "attic";
    expect(moodOf(s, "moth")).toBeNull();
    s.actors.vale.place = "pond";
    s.turn = 5 + STALL_TURNS;
    expect(moodOf(s, "moth")).toBeNull();
  });

  it("is sad for the quiet turns after a beating, then passes", () => {
    const s = world();
    calm(s);
    s.turn = 20;
    s.defeats = { moth: 1 };
    s.peaceUntil.moth = 23;
    expect(moodOf(s, "moth")).toBe("sad");
    s.turn = 23;
    expect(moodOf(s, "moth")).toBeNull();
  });

  it("weighs fight, then sleep, then sad, then happy", () => {
    const s = world();
    const a = calm(s);
    s.turn = 10;
    a.content = true;
    a.metTurn = 10;
    expect(moodOf(s, "moth")).toBe("happy");
    // A grievance in the room outweighs a met want.
    s.actors.moth.place = s.actors.vale.place = "pond";
    grieve(s, "moth", "vale");
    expect(moodOf(s, "moth")).toBe("sad");
    // Asleep overrides everything.
    a.sleeping = { since: 10, place: "pond", present: [] };
    expect(moodOf(s, "moth")).toBeNull();
    delete a.sleeping;
    // A standoff overrides mood: the fight poses apply.
    s.standoffs.push({
      challenger: "vale", defender: "moth", item: "lamp", location: "pond",
      opened: 10, resolve: { vale: 4, moth: 4 },
      guarding: {}, struck: {}, steppedBack: {}, hitBy: {}, covering: {},
    });
    expect(moodOf(s, "moth")).toBeNull();
  });

  it("is the same for every viewer of a shared world", () => {
    const s = world();
    const a = calm(s);
    s.turn = 10;
    a.content = true;
    a.metTurn = 10;
    const shared = structuredClone(s);
    shared.sharedVersion = 1;
    shared.controlledActors = shared.presentActors = ["vale", "mara"];
    for (const viewer of ["vale", "mara", "ash"]) {
      shared.viewer = viewer;
      expect(moodOf(shared, "moth")).toBe("happy");
    }
    expect(moodOf(structuredClone(shared), "moth")).toBe("happy");
  });

  it("is rare on fresh worlds of each mounted pack", () => {
    let total = 0, moody = 0;
    for (const pack of [{ id: null }, ...packDefinitions]) {
      const s = pack.id
        ? createWorld({ seed: 3, packScopes: pack.release ? { [pack.id]: "full" } : {} })
        : createWorld({ seed: 3 });
      for (const id of Object.keys(s.actors)) {
        total += 1;
        if (moodOf(s, id)) moody += 1;
      }
    }
    expect(moody / total).toBeLessThan(0.05);
    console.log(`moody at turn 0: ${moody} of ${total} avatars`);
  });
});

describe("mood faces", () => {
  it("renders an avatar without happy or sad art exactly as before", () => {
    const s = world();
    const a = calm(s);
    const before = portrait("moth", null, s);
    s.turn = 10;
    a.content = true;
    a.metTurn = 10;
    expect(moodOf(s, "moth")).toBe("happy");
    expect(portrait("moth", null, s)).toBe(before);
  });

  it("shows the face art when the mood holds, and only then", () => {
    const s = world();
    const a = calm(s);
    const plain = portrait("moth", null, s);
    registerFaceArt("moth", {
      happy: "assets/test/moth-happy.png",
      sad: "assets/test/moth-sad.png",
    });
    expect(portrait("moth", null, s)).toBe(plain);
    s.turn = 10;
    a.content = true;
    a.metTurn = 10;
    expect(portrait("moth", null, s)).toBe("./assets/test/moth-happy.png");
    s.actors.moth.place = s.actors.vale.place = "pond";
    grieve(s, "moth", "vale");
    expect(portrait("moth", null, s)).toBe("./assets/test/moth-sad.png");
    a.sleeping = { since: 10, place: "pond", present: [] };
    expect(portrait("moth", null, s)).not.toContain("moth-sad");
  });

  it("serves a maker avatar's strike, brace and hit to the fight view", () => {
    const mothHit = combatPortrait("moth", "hit", "./assets/moth.png");
    registerFaceArt("made", {
      strike: "assets/w/made-strike.png",
      brace: "assets/w/made-brace.png",
      hit: "assets/w/made-hit.png",
    });
    expect(fightPortrait("made", "attack")).toBe("assets/w/made-strike.png");
    expect(combatPortrait("made", "guard", "./assets/w/made.png")).toBe(
      "./assets/w/made-brace.png",
    );
    expect(combatPortrait("made", "hit", "./assets/w/made.png")).toBe(
      "./assets/w/made-hit.png",
    );
    expect(combatPortrait("moth", "hit", "./assets/moth.png")).toBe(mothHit);
  });
});
