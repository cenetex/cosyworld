import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  activeResidents,
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
  standoffFor,
  willingToGive,
} from "../v2/card-game/core/world.mjs";
import { plan } from "../v2/card-game/core/planner.mjs";
import {
  avatarOrder,
  desireFor,
  generateQuest,
  isPlayer,
} from "../v2/card-game/core/goals.mjs";

const coreDir = new URL("../v2/card-game/core/", import.meta.url);
const shore = JSON.parse(
  readFileSync(new URL("../v2/card-game/seeds/shore.json", import.meta.url)),
);
const next = (x) => (Math.imul(x, 1664525) + 1013904223) >>> 0;

// A connected world with random places, avatars, and items.
function randomSeed(k) {
  let x = (k * 2654435761) >>> 0;
  const r = (m) => (x = next(x)) % m;
  const P = 3 + r(6),
    A = 2 + r(5),
    I = 2 + r(8),
    players = 1 + r(2);
  const places = Array.from({ length: P }, (_, i) => ({
    id: `p${i}`,
    name: `Place ${i}`,
    exits: [],
  }));
  const link = (a, b) => {
    if (a === b || places[a].exits.includes(`p${b}`)) return;
    places[a].exits.push(`p${b}`);
    places[b].exits.push(`p${a}`);
  };
  for (let i = 1; i < P; i++) link(i, r(i));
  for (let e = r(P); e > 0; e--) link(r(P), r(P));
  const avatars = Array.from({ length: A }, (_, i) => ({
    id: `a${i}`,
    name: `Avatar ${i}`,
    role: i < players ? "player" : "resident",
    place: `p${r(P)}`,
  }));
  const load = {};
  const items = Array.from({ length: I }, (_, i) => {
    let holder = r(2) ? `p${r(P)}` : `a${r(A)}`;
    if (holder[0] === "a" && (load[holder] = (load[holder] || 0) + 1) > 3)
      holder = "p0";
    return { id: `i${i}`, name: `Item ${i}`, holder };
  });
  return { id: `random-${k}`, places, avatars, items };
}
const playersOf = (s) => avatarOrder(s).filter((id) => isPlayer(s, id));
const progressOf = (s) =>
  Object.values(s.avatars).map((a) => [a.progress.program, a.progress.step]);
// Players alternate; each play follows the planner or a random legal offer.
function loosePlay(s, turns, k, mix = 0.5) {
  let x = (k * 2246822519) >>> 0;
  const players = playersOf(s);
  for (let t = 0; t < turns; t++) {
    x = next(x);
    const p = players[t % players.length];
    const acts = legalActions(s, p);
    const action =
      (x >>> 8) % 1000 < mix * 1000 ? plan(s, p).action : acts[x % acts.length];
    const result = play(s, action);
    expect(result.ok, result.error).toBe(true);
    s = result.state;
  }
  return s;
}

describe("the general card core", () => {
  it("names no entity in its rules", () => {
    const names = [
      ...shore.places.map((e) => e.id),
      ...shore.avatars.map((e) => e.id),
      ...shore.items.map((e) => e.id),
    ];
    for (const file of readdirSync(coreDir)) {
      const source = readFileSync(new URL(file, coreDir), "utf8");
      for (const id of names)
        expect(source, `${file} names ${id}`).not.toMatch(
          new RegExp(`["'\`]${id}["'\`]`),
        );
    }
  });

  it("builds a world from seed data with a quest for every avatar", () => {
    const s = createWorld(shore);
    expect(Object.keys(s.places)).toEqual(["station", "attic", "pond"]);
    for (const id of Object.keys(s.avatars)) {
      expect(s.avatars[id].progress.current.steps.length).toBeGreaterThan(0);
      expect(desireFor(s, id)).toHaveProperty("items");
    }
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });

  it("replays exactly and varies by world seed", () => {
    const a = loosePlay(createWorld(shore), 120, 3);
    const b = loosePlay(createWorld(shore), 120, 3);
    expect(encodeSave(a)).toBe(encodeSave(b));
    const renamed = createWorld({ ...shore, id: "shore-2" });
    const quests = (s) =>
      Object.values(s.avatars).map((v) => v.progress.current.steps);
    const varied = [2, 3, 4, 5].some(
      (k) =>
        JSON.stringify(quests(createWorld({ ...shore, id: `shore-${k}` }))) !==
        JSON.stringify(quests(createWorld(shore))),
    );
    expect(renamed.seed).toBe("shore-2");
    expect(varied).toBe(true);
  });

  it("accepts plays only from players at the current revision", () => {
    const s = createWorld(shore);
    const resident = avatarOrder(s).find((id) => !isPlayer(s, id));
    expect(play(s, legalActions(s, resident)[0]).ok).toBe(false);
    const wait = legalActions(s, "vale")[0];
    expect(play(s, wait, s.revision + 1).ok).toBe(false);
    expect(play(s, wait).ok).toBe(true);
  });

  it("derives consent from goals for every avatar", () => {
    const s = createWorld({
      id: "consent",
      places: [{ id: "here", name: "Here", exits: [] }],
      avatars: [
        { id: "ana", name: "Ana", role: "player", place: "here" },
        { id: "bo", name: "Bo", role: "resident", place: "here" },
      ],
      items: [
        { id: "cup", name: "Cup", holder: "bo" },
        { id: "key", name: "Key", holder: "bo" },
      ],
    });
    const wanted = desireFor(s, "bo").items;
    for (const item of wanted)
      expect(willingToGive(s, "bo", item, "ana")).toBe(false);
    expect(willingToGive(s, "ana", "cup", "bo")).toBe(false);
    // Residents never trade with players by rule; a player answers with a play.
    expect(
      legalActions(s, "bo").some(
        (a) => a.kind === "trade" && a.target === "ana",
      ),
    ).toBe(false);
    s.turn = 24;
    const spare = ["cup", "key"].find((id) => !wanted.includes(id));
    if (spare) expect(willingToGive(s, "bo", spare, "ana")).toBe(true);
  });

  it("keeps a distant part of the world still", () => {
    const places = Array.from({ length: 6 }, (_, i) => ({
      id: `p${i}`,
      name: `Place ${i}`,
      exits: [i > 0 && `p${i - 1}`, i < 5 && `p${i + 1}`].filter(Boolean),
    }));
    let s = createWorld({
      id: "line",
      rules: { actRadius: 1 },
      places,
      avatars: [
        { id: "ana", name: "Ana", role: "player", place: "p0" },
        { id: "near", name: "Near", role: "resident", place: "p1" },
        { id: "far", name: "Far", role: "resident", place: "p5" },
      ],
      items: [
        { id: "cup", name: "Cup", holder: "p4" },
        { id: "key", name: "Key", holder: "p1" },
      ],
    });
    expect(activeResidents(s, "ana")).toEqual(["near"]);
    const far = structuredClone(s.avatars.far);
    for (let i = 0; i < 10; i++) s = play(s, legalActions(s, "ana")[0]).state;
    expect(s.avatars.far.place).toBe(far.place);
    expect(s.avatars.far.progress).toEqual(far.progress);
  });

  it("lets any avatar threaten and settles the standoff by the same rules", () => {
    let s = createWorld({
      id: "standoff",
      places: [
        { id: "yard", name: "Yard", exits: ["lane"] },
        { id: "lane", name: "Lane", exits: ["yard"] },
      ],
      avatars: [
        { id: "ana", name: "Ana", role: "player", place: "yard" },
        { id: "bo", name: "Bo", role: "resident", place: "yard" },
      ],
      items: [{ id: "cup", name: "Cup", holder: "bo" }],
    });
    const threat = legalActions(s, "ana").find((a) => a.kind === "threaten");
    expect(threat).toMatchObject({ target: "bo", item: "cup" });
    s = play(s, threat).state;
    expect(standoffFor(s, "ana")).toBeTruthy();
    for (let i = 0; i < 8 && standoffFor(s, "ana"); i++) {
      const attack = legalActions(s, "ana").find((a) => a.kind === "attack");
      s = play(s, attack).state;
    }
    expect(standoffFor(s, "ana")).toBeUndefined();
    const retreat = s.log.find((e) => / retreats to Lane\./.test(e.text));
    expect(retreat).toBeTruthy();
    expect(Object.values(s.avatars).map((a) => a.place)).toContain("lane");
  });

  it("builds quests over any world without naming its entities", () => {
    for (let k = 1; k <= 40; k++) {
      const s = createWorld(randomSeed(k));
      for (const id of Object.keys(s.avatars)) {
        const q = generateQuest(structuredClone(s), id, { independent: true });
        expect(q.steps.length).toBeGreaterThan(0);
        const solo = generateQuest(structuredClone(s), id, { solo: true });
        expect(solo.generated).toMatchObject({ solo: true, partner: null });
      }
    }
  });

  it("keeps every random world progressing after long loose play", () => {
    for (let k = 1; k <= 40; k++) {
      let s = loosePlay(createWorld(randomSeed(k)), 240, k);
      const before = progressOf(s);
      s = loosePlay(s, 60, k, 1);
      expect(progressOf(s), `world ${k}`).not.toEqual(before);
      expect(decodeSave(encodeSave(s))).toEqual(s);
    }
  }, 60_000);

  it("keeps the player and every active resident progressing as the shore grows", () => {
    for (let k = 1; k <= 10; k++) {
      let s = loosePlay(createWorld(shore), 400, k);
      const last = (t, id) => t.avatars[id].progress.marks.at(-1);
      const before = Object.fromEntries(
        Object.keys(s.avatars).map((id) => [id, last(s, id)]),
      );
      const activeTurns = {};
      for (let i = 0; i < 160; i++) {
        for (const id of activeResidents(s, "vale"))
          activeTurns[id] = (activeTurns[id] || 0) + 1;
        s = play(s, plan(s, "vale").action).state;
      }
      const busy = Object.keys(before).filter(
        (id) => id === "vale" || activeTurns[id] >= 120,
      );
      expect(busy.length, `seed ${k}`).toBeGreaterThan(1);
      for (const id of busy)
        expect(last(s, id), `seed ${k} ${id}`).not.toBe(before[id]);
    }
  }, 60_000);
});
