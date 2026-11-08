import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  plan,
  play,
  wantAPI,
} from "../v2/card-game/world.mjs";
import {
  hub,
  packDefinition,
  packPeople,
  packPlaces,
  packThings,
} from "../v2/card-game/pack-registry.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import { levelOf, levelReturnHome, newWant } from "../v2/card-game/want.mjs";

const resident = "greek-rhapsode",
  home = "greek-sanctuary";
const original = structuredClone(packPeople[resident]);
const homeRequires = packPlaces[home].requires;
const restore = () => {
  for (const key of Object.keys(packPeople[resident]))
    delete packPeople[resident][key];
  Object.assign(packPeople[resident], structuredClone(original));
  if (homeRequires === undefined) delete packPlaces[home].requires;
  else packPlaces[home].requires = homeRequires;
};
const fixture = () => {
  const s = createWorld({ seed: 17 });
  s.actors.vale.place = "pond";
  Object.assign(s.actors[resident], {
    place: "greek-well",
    sanctuary: "attic",
    want: newWant("place", "greek-well", 0),
    under: [newWant("place", "greek-harbor", 0)],
  });
  return s;
};
const apply = (s, action) => {
  expect(action).toBeDefined();
  const result = play(s, action);
  expect(result.ok, result.error).toBe(true);
  return result.state;
};
const advance = (s, kind = "wait", target) =>
  apply(
    s,
    legalActions(s).find(
      (a) => a.kind === kind && (!target || a.target === target),
    ),
  );

describe("resident levels earned at a fixed home", () => {
  beforeEach(() =>
    Object.assign(packPeople[resident], { home, levelAtHome: true }),
  );
  afterEach(restore);

  it("banks XP away, walks home, then resumes roaming with identical replay", () => {
    let s = fixture();
    const start = encodeSave(s),
      journal = [];
    const act = (kind = "wait", target) => {
      const action = legalActions(s).find(
        (a) => a.kind === kind && (!target || a.target === target),
      );
      journal.push(structuredClone(action));
      s = apply(s, action);
    };
    act("move", "station");
    expect(s.actors[resident]).toMatchObject({
      place: "greek-palace",
      xp: 1,
      level: 1,
    });
    expect(levelReturnHome(s, resident)).toBe(home);
    expect(wantAPI(s).home(resident)).toBe(home);
    s = decodeSave(encodeSave(s));
    expect(levelOf(s, resident)).toBe(1);
    expect(plan(s, resident).action).toMatchObject({
      kind: "move",
      target: home,
    });
    act();
    expect(s.actors[resident]).toMatchObject({ place: home, xp: 1, level: 2 });
    expect(levelReturnHome(s, resident)).toBeNull();
    expect(s.actors[resident].want.target).toBe("greek-harbor");
    act();
    expect(s.actors[resident].place).toBe("greek-palace");
    expect(levelOf(s, resident)).toBe(2);
    const replay = journal.reduce(apply, decodeSave(start));
    expect(encodeSave(replay)).toBe(encodeSave(s));
    expect(decodeSave(encodeSave(s)).actors[resident]).toEqual(
      s.actors[resident],
    );
  });

  it("waits for a closed home without losing XP or gaining a level elsewhere", () => {
    packPlaces[home].requires = [
      { kind: "flag", key: "test-home-open", value: true },
    ];
    let s = fixture();
    for (const actor of Object.values(s.actors))
      if (actor.place === home) actor.place = "greek-palace";
    for (const item of Object.values(s.items))
      if (item.holder === home) item.holder = "greek-palace";
    s = advance(s, "move", "station");
    expect(s.actors[resident]).toMatchObject({
      place: "greek-palace",
      xp: 1,
      level: 1,
    });
    expect(plan(s, resident).action.kind).toBe("wait");
    s = advance(s);
    expect(s.actors[resident]).toMatchObject({
      place: "greek-palace",
      xp: 1,
      level: 1,
    });
    delete packPlaces[home].requires;
    s = advance(s);
    expect(s.actors[resident]).toMatchObject({ place: home, xp: 1, level: 2 });
  });

  it("preserves earned levels in older saves without an explicit level", () => {
    const s = fixture();
    s.turn = s.revision = 1;
    s.actors[resident].xp = 3;
    delete s.actors[resident].level;
    const restored = decodeSave(encodeSave(s));
    expect(restored.actors[resident]).toMatchObject({ xp: 3, level: 3 });
    expect(levelReturnHome(restored, resident)).toBeNull();
  });

  it("keeps ordinary resident gains immediate and human gains quest-bound", () => {
    delete packPeople[resident].levelAtHome;
    let s = fixture();
    s.turn = s.revision = 1;
    Object.assign(s.actors.vale, { xp: 3, level: 1 });
    s = advance(s, "move", "station");
    expect(s.actors[resident].place).not.toBe(home);
    expect(levelOf(s, resident)).toBe(2);
    expect(levelOf(s, "vale")).toBe(1);
  });

  it("accepts only an explicit fixed sanctuary home for the option", () => {
    const pack = structuredClone(packDefinition("greek-drama"));
    const avatar = pack.avatars[resident];
    Object.assign(avatar, { home, levelAtHome: true });
    const problems = () =>
      packProblems(pack, hub, Object.keys(packPlaces), Object.keys(packThings));
    expect(problems()).toEqual([]);
    for (const invalid of ["greek-harbor", "attic", undefined]) {
      avatar.home = invalid;
      expect(problems().join("\n")).toMatch(
        /levelAtHome needs a fixed sanctuary/,
      );
    }
    avatar.home = home;
    avatar.homeWhen = {
      place: home,
      requires: [{ kind: "flag", key: "changed", value: true }],
    };
    expect(problems().join("\n")).toMatch(
      /levelAtHome needs a fixed sanctuary/,
    );
  });
});
