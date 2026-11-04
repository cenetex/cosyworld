// Rules 99: a sanctuary quest rebuilt for another place, when its pack
// switches off or it is set aside, takes the place of an ordinary quest for
// that place. It never crashes the play, is never held twice, and never
// costs a level quest.
import { describe, expect, it } from "vitest";
import {
  createWorld,
  legalActions,
  play,
  sanctuaries,
  validateWorld,
  wantAPI,
} from "../v2/card-game/world.mjs";
import {
  halfwayXp,
  newWant,
  pushQuest,
  questsOf,
  restStep,
  reviseStalledWants,
  STALL_TURNS,
} from "../v2/card-game/want.mjs";

const TEA = "hoppycat-halfway-tea-garden";
const off = (pack) => ({ kind: "pack", pack, enable: false });
const shape = (s, id = "vale") =>
  questsOf(s, id).map(
    (w) => `${w.kind}:${w.target}:${w.step?.verb ?? ""}${w.quest ? "*" : ""}`,
  );

// Vale reaches halfway at the station by a real want met, with the Hoppy
// Cat tea garden as sanctuary, so the rules issue the sanctuary quest there.
function halfwayAtTea() {
  const s = createWorld({ seed: 3 });
  delete s.opening;
  s.turn = s.revision = 60;
  const v = s.actors.vale;
  Object.assign(v, { place: "station", sanctuary: TEA, level: 2 });
  v.xp = halfwayXp(2) - 1;
  v.want = newWant("place", "pond", s.turn);
  delete v.under;
  const move = legalActions(s, "vale").find(
    (a) => a.kind === "move" && a.target === "pond",
  );
  const next = play(s, move, s.revision, "vale").state;
  expect(shape(next)).toEqual([`place:${TEA}:rest`]);
  return next;
}

describe("a sanctuary quest redirected by a pack going off", () => {
  it("takes the place of an ordinary quest for the attic, without a crash", () => {
    const s = halfwayAtTea();
    pushQuest(s, "vale", newWant("place", "attic", s.turn));
    expect(validateWorld(s)).toBe(s);
    const result = play(s, off("hoppy"), s.revision, "vale");
    expect(result.error).toBeUndefined();
    expect(shape(result.state)).toEqual(["place:attic:rest"]);
    expect(validateWorld(result.state)).toBe(result.state);
  });

  it("keeps an ordinary quest for another place beside it", () => {
    const s = halfwayAtTea();
    pushQuest(s, "vale", newWant("place", "pond", s.turn));
    const result = play(s, off("hoppy"), s.revision, "vale");
    expect(shape(result.state)).toEqual(["place:pond:", "place:attic:rest"]);
  });

  it("never costs a level quest redirected to the same place", () => {
    const s = halfwayAtTea();
    pushQuest(s, "vale", newWant("place", "attic", s.turn));
    pushQuest(
      s,
      "vale",
      restStep(s, "vale", wantAPI(s), { level: 3, left: 1 }),
    );
    expect(shape(s)).toEqual([
      `place:${TEA}:rest*`,
      "place:attic:",
      `place:${TEA}:rest`,
    ]);
    expect(validateWorld(s)).toBe(s);
    const result = play(s, off("hoppy"), s.revision, "vale");
    expect(result.error).toBeUndefined();
    expect(shape(result.state)).toEqual([
      "place:attic:rest*",
      "place:attic:rest",
    ]);
    expect(validateWorld(result.state)).toBe(result.state);
  });
});

describe("a sanctuary quest set aside", () => {
  it("takes the place of an ordinary quest for its new place", () => {
    const s = createWorld();
    const id = "keeper";
    s.turn = s.revision = STALL_TURNS * 2;
    s.actors[id].sanctuary = "greek-sanctuary";
    s.actors[id].want = {
      ...newWant("place", "attic", 0),
      refusals: 1,
      step: { verb: "rest" },
    };
    s.actors[id].under = [newWant("place", "greek-sanctuary", 0)];
    expect(validateWorld(s)).toBe(s);
    reviseStalledWants(s, [id], wantAPI(s));
    expect(shape(s, id)).toEqual(["place:greek-sanctuary:rest"]);
    expect(validateWorld(s)).toBe(s);
  });
});

// A small seeded generator: mulberry32.
function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (next, list) => list[Math.floor(next() * list.length)];
const PACKS = ["hoppy", "sea", "cottage", "shore"];
const levelQuests = (s) =>
  questsOf(s, "vale")
    .filter((w) => w.quest)
    .map((w) => w.quest.level);

describe("pack toggles with sanctuary quests held, fuzzed", () => {
  it("never crash, hold a quest twice, or lose a level quest", () => {
    let worlds = 0,
      toggles = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const next = rng(seed);
      const s = createWorld({ seed });
      delete s.opening;
      s.turn = s.revision = 60;
      const v = s.actors.vale;
      const level = 1 + Math.floor(next() * 6);
      Object.assign(v, { level, xp: halfwayXp(level), want: null });
      delete v.under;
      v.visited = [...new Set([...v.visited, ...sanctuaries, "pond"])];
      v.sanctuary = pick(next, sanctuaries);
      const places = [...sanctuaries, "pond", "station", v.place];
      // Ordinary quests, a sanctuary quest at halfway, now and then a level
      // quest's rest step, and the same for a resident.
      for (let i = 0; i < 3; i++)
        pushQuest(s, "vale", newWant("place", pick(next, places), s.turn));
      pushQuest(s, "vale", restStep(s, "vale", wantAPI(s)));
      if (next() < 0.4)
        pushQuest(
          s,
          "vale",
          restStep(s, "vale", wantAPI(s), { level: level + 1, left: 1 }),
        );
      s.actors.keeper.sanctuary = pick(next, sanctuaries);
      pushQuest(s, "keeper", newWant("place", pick(next, places), s.turn));
      pushQuest(s, "keeper", restStep(s, "keeper", wantAPI(s)));
      try {
        validateWorld(s);
      } catch {
        continue;
      }
      worlds += 1;
      let state = s;
      for (let n = 0; n < 24; n++) {
        const toggle = next() < 0.5;
        const action = toggle
          ? { kind: "pack", pack: pick(next, PACKS), enable: next() < 0.4 }
          : pick(next, legalActions(state, "vale"));
        if (!action) break;
        const before = levelQuests(state);
        const result = play(state, action, state.revision, "vale");
        if (result.error) continue;
        if (toggle) {
          toggles += 1;
          expect(levelQuests(result.state)).toEqual(before);
        }
        expect(validateWorld(result.state)).toBe(result.state);
        state = result.state;
      }
    }
    expect(worlds).toBeGreaterThan(40);
    expect(toggles).toBeGreaterThan(100);
  });
});
