// Rules 100, world life: residents keep a home and a range, walk home when
// displaced, and take a step at dawn and dusk where no player is. The world
// stays deterministic and cheap.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  exits,
  legalActions,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
import {
  DAY_TURNS,
  OFFSTAGE_STEPS,
  hops,
  inRange,
  lifeHome,
  mayBoard,
  rangeOf,
} from "../v2/card-game/resident-home.mjs";
import { entityActive, packPeople } from "../v2/card-game/pack-registry.mjs";
import { lifeWorld, reload, wait, waitUntil } from "./helpers/world-life.mjs";

const GUARD = "greek-guard",
  GATE = "greek-gate";

describe("home and range", () => {
  it("reads home, range and sailing from pack data", () => {
    const s = lifeWorld();
    expect(rangeOf(s, GUARD)).toBe(0);
    expect(rangeOf(s, "oak")).toBe(0);
    expect(rangeOf(s, "greek-aethra")).toBe(0);
    expect(rangeOf(s, "greek-creon")).toBe(2);
    expect(rangeOf(s, "greek-shipmaster")).toBe(2);
    expect(mayBoard(s, "greek-shipmaster")).toBe(true);
    expect(mayBoard(s, "greek-creon")).toBe(false);
    expect(rangeOf(s, "greek-rhapsode")).toBe(null);
    expect(rangeOf(s, "moth")).toBe(Infinity);
    expect(rangeOf(s, "vale")).toBe(null);
    expect(lifeHome(GUARD)).toBe(GATE);
    expect(inRange(s, "greek-creon", "greek-well")).toBe(true);
    expect(inRange(s, "greek-creon", "greek-harbor")).toBe(false);
  });

  it("steps toward a want in range at dawn and dusk, never out of range", () => {
    let s = lifeWorld({ turn: DAY_TURNS + 20, place: "greek-harbor" });
    // The elder wants the courtyard, one hop from the well; Creon wants the
    // harbor, three hops from the palace.
    s.actors["greek-elder"].want = {
      kind: "place",
      target: "greek-courtyard",
      since: s.turn,
      refusals: 0,
    };
    s.actors["greek-creon"].want = {
      kind: "place",
      target: "greek-harbor",
      since: s.turn,
      refusals: 0,
    };
    s = reload(s);
    s = waitUntil(s, DAY_TURNS + 23);
    expect(s.actors["greek-elder"].place).toBe("greek-well");
    s = wait(s); // dusk
    expect(s.actors["greek-elder"].place).toBe("greek-courtyard");
    expect(s.actors["greek-creon"].place).toBe("greek-palace");
    // Its want met, it waits there until the next light change, then walks home.
    s = wait(s, 3);
    expect(s.actors["greek-elder"].place).not.toBe("greek-palace");
    expect(hops("greek-well", s.actors["greek-elder"].place)).toBeLessThan(3);
  });

  it("meets a want to talk when two residents end in one place off-stage", () => {
    let s = lifeWorld({ turn: 2 * DAY_TURNS + 23, place: "greek-harbor" });
    s.actors["greek-ismene"].want = {
      kind: "person",
      target: "greek-creon",
      since: s.turn,
      refusals: 0,
    };
    const xp = s.actors["greek-ismene"].xp;
    s = wait(reload(s)); // dusk
    expect(s.actors["greek-ismene"].place).toBe("greek-palace");
    expect(s.actors["greek-ismene"].xp).toBe(xp + 1);
    expect(s.actors["greek-ismene"].talked).toContain("greek-creon");
    expect(
      s.log.some(
        (e) =>
          e.verb === "want_met" &&
          e.actorId === "greek-ismene" &&
          e.targetId === "greek-creon",
      ),
    ).toBe(true);
    // No speech: the meeting is a rules fact only.
    expect(s.log.some((e) => e.kind === "dialogue")).toBe(false);
  });

  it("walks a pushed resident home one step a turn, even off-stage", () => {
    let s = lifeWorld({ place: "greek-palace" });
    s.actors["greek-creon"].place = "greek-well";
    s.actors["greek-creon"].homeward = true;
    s = reload(s);
    s = wait(s);
    expect(s.actors["greek-creon"].place).toBe("greek-courtyard");
    expect(s.actors["greek-creon"].homeward).toBe(true);
    s = wait(s);
    expect(s.actors["greek-creon"].place).toBe("greek-palace");
    expect(s.actors["greek-creon"].homeward).toBeUndefined();
  });

  it("caps the off-stage steps of one play", () => {
    let s = lifeWorld({ place: "greek-harbor" });
    const away = Object.keys(packPeople).filter(
      (id) =>
        entityActive(s, id) &&
        rangeOf(s, id) > 0 &&
        Number.isFinite(rangeOf(s, id)) &&
        exits(s, lifeHome(id), id).length,
    );
    for (const id of away) {
      s.actors[id].place = exits(s, lifeHome(id), id)[0];
      s.actors[id].homeward = true;
    }
    s = reload(s);
    const before = structuredClone(s);
    s = wait(s);
    const moved = away.filter(
      (id) => s.actors[id].place !== before.actors[id].place,
    );
    expect(moved.length).toBeLessThanOrEqual(OFFSTAGE_STEPS);
    expect(moved.length).toBeGreaterThan(0);
    // One step each: everyone is home again, and nobody walks on.
    expect(moved.every((id) => s.actors[id].place === lifeHome(id))).toBe(true);
  });
});

describe("world life is deterministic and cheap", () => {
  it("uses no clock and no random number", () => {
    for (const file of ["home", "sleep", "guard"]) {
      const source = readFileSync(`v2/card-game/resident-${file}.mjs`, "utf8");
      expect(source).not.toMatch(/Date|Math\.random|performance/u);
    }
  });

  // A seeded walk of random plays across many dawns and dusks, reloading as
  // it goes: no play throws, every save is valid, and a replay agrees.
  for (const seed of [1, 2, 3])
    it(`fuzzes random plays, light changes and reloads (seed ${seed})`, () => {
      let state = seed * 2654435761;
      const next = (n) => {
        state = (Math.imul(state ^ (state >>> 15), 2246822507) + 1) >>> 0;
        return state % n;
      };
      let s = lifeWorld({ seed, turn: DAY_TURNS - 4, place: GATE });
      const keys = [];
      for (let i = 0; i < 160; i++) {
        const plays = legalActions(s).filter(
          (a) => !["focus", "drop"].includes(a.kind) || a.item,
        );
        const pick = plays[next(plays.length)];
        const done = play(s, pick, s.revision);
        expect(done.ok, done.error).toBe(true);
        keys.push(pick.key);
        s = done.state;
        expect(() => validateWorld(structuredClone(s))).not.toThrow();
        if (next(5) === 0) s = reload(s);
      }
      expect(s.turn).toBeGreaterThan(DAY_TURNS + 24);
      let again = lifeWorld({ seed, turn: DAY_TURNS - 4, place: GATE });
      for (const key of keys) {
        const done = play(again, { key }, again.revision);
        expect(done.ok, done.error).toBe(true);
        again = done.state;
      }
      expect(again).toEqual(reload(s));
    }, 120_000);

  it("keeps the slowest play of a busy world well inside the budget", () => {
    // Every resident away from home and walking, played through dusk.
    let s = lifeWorld({ turn: 3 * DAY_TURNS + 18, place: "greek-harbor" });
    for (const id of Object.keys(packPeople)) {
      const range = rangeOf(s, id);
      const out =
        entityActive(s, id) && range > 0 && exits(s, lifeHome(id), id)[0];
      if (out) s.actors[id].place = out;
    }
    s = reload(s);
    let slowest = 0;
    for (let i = 0; i < 12; i++) {
      const plays = legalActions(s);
      const pick = plays.find((a) => a.kind === "wait" && !a.sleep);
      const t = performance.now();
      s = play(s, pick, s.revision).state;
      slowest = Math.max(slowest, performance.now() - t);
    }
    // The browser runs this in milliseconds; QuickJS has a 2 s deadline.
    expect(slowest).toBeLessThan(400);
  });
});
