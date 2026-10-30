import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  plan,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
import {
  levelFor,
  levelOf,
  newWant,
  wantCandidates,
  wantMet,
  REFUSAL_LIMIT,
  STALL_TURNS,
} from "../v2/card-game/want.mjs";

const act = (s, kind, fields = {}, actor = "vale") => {
  const a = legalActions(s, actor).find(
    (a) =>
      a.kind === kind &&
      Object.entries(fields).every(([key, value]) => a[key] === value),
  );
  expect(a, `${kind} ${JSON.stringify(fields)}`).toBeTruthy();
  return a;
};
const metEvents = (s, actor) =>
  s.log.filter((e) => e.verb === "want_met" && e.actorId === actor);

describe("one want per avatar", () => {
  it("installs the authored want on every hub avatar", () => {
    const s = createWorld();
    expect(s.actors.moth.want).toEqual(newWant("item", "lamp", 0));
    expect(s.actors.keeper.want).toEqual(newWant("item", "bell", 0));
    expect(s.actors.vale.xp).toBe(0);
    expect(validateWorld(s)).toBe(s);
  });

  it("levels follow a rising curve of experience", () => {
    expect([0, 1, 2, 3, 5, 6, 10].map(levelFor)).toEqual([1, 2, 2, 3, 3, 4, 5]);
  });

  it("meets an item want when the actor is its root holder", () => {
    const s = createWorld();
    s.items.lamp.holder = "moth";
    expect(wantMet(s, "moth")).toBe(true);
    s.items.cloth.holder = "lamp";
    expect(wantMet(s, "moth")).toBe(true);
    s.items.lamp.holder = "station";
    expect(wantMet(s, "moth")).toBe(false);
  });

  it("meets a person want only through Talk in a shared place", () => {
    const s = createWorld();
    s.actors.vale.want = newWant("person", "keeper", 0);
    s.actors.vale.place = s.actors.keeper.place;
    expect(wantMet(s, "vale")).toBe(false);
    expect(wantMet(s, "vale", { actor: "keeper", target: "vale" })).toBe(true);
    s.actors.vale.place = "attic";
    expect(wantMet(s, "vale", { actor: "vale", target: "keeper" })).toBe(false);
  });

  it("commits want_met, adds experience and sends the avatar home", () => {
    let s = createWorld();
    s.actors.vale.want = newWant("place", "pond", 0);
    s = play(s, act(s, "move", { target: "pond" })).state;
    const [event] = metEvents(s, "vale");
    expect(event.wantMet).toEqual({ kind: "place", target: "pond" });
    expect(s.actors.vale.xp).toBe(1);
    expect(levelOf(s, "vale")).toBe(2);
    // Vale's home is the attic, so the want after a trip is the way home.
    expect(s.actors.vale.want).toMatchObject({
      kind: "place",
      target: "attic",
    });
    expect(decodeSave(encodeSave(s)).actors.vale.want).toEqual(
      s.actors.vale.want,
    );
  });

  it("rests at home after a want met there, then draws a real want", () => {
    let s = createWorld();
    s.actors.keeper.place = "station";
    s.actors.keeper.want = newWant("place", "station", 0);
    s.actors.keeper.place = "pond";
    s.actors.vale.place = "pond";
    s = play(s, act(s, "wait")).state;
    expect(s.actors.keeper.place).toBe("station");
    expect(metEvents(s, "keeper")).toHaveLength(1);
    const next = s.actors.keeper.want;
    expect(next === null || next.target !== "station").toBe(true);
    expect(plan(s, "keeper").action.kind).toBe("wait");
  });

  it("draws the next want from the world and the same turn draws the same want", () => {
    const s = createWorld();
    s.actors.moth.place = "station";
    s.actors.moth.visited = ["station"];
    const api = {
      carried: () => [],
      rootHolder: (id) => {
        let h = s.items[id].holder;
        while (s.items[h]) h = s.items[h].holder;
        return h;
      },
      valueOf: (_, id) => ({ lamp: 12, cloth: 6, oil: 3 })[id] ?? 1,
      reachable: () => ["attic", "pond"],
    };
    const pool = wantCandidates(s, "moth", api);
    expect(pool).toContain("place:pond");
    expect(pool).toContain("person:keeper");
    // Pip values the bell at the minimum, so it never wants it.
    expect(pool).not.toContain("item:bell");
    expect(wantCandidates(s, "moth", api)).toEqual(pool);
  });

  it("counts refusals of the want and sets it aside at the limit", () => {
    let s = createWorld();
    s.actors.vale.place = "station";
    s.items.oil.holder = "keeper";
    s.actors.keeper.place = "station";
    s.actors.keeper.want = newWant("place", "station", 0);
    s.actors.vale.want = newWant("item", "oil", 0);
    for (let i = 0; i < REFUSAL_LIMIT; i++) {
      const ask = legalActions(s).find(
        (a) => a.kind === "ask" && a.item === "oil",
      );
      if (!ask) break;
      s = play(s, ask).state;
      if (s.actors.vale.want?.target !== "oil") break;
    }
    expect(s.actors.vale.want?.target).not.toBe("oil");
    expect(s.actors.vale.gaveUp).toMatchObject({ target: "oil" });
  });

  it("trusts only someone who gave the wanted item", () => {
    const start = () => {
      const s = createWorld();
      s.actors.vale.place = "pond";
      s.items.lamp.holder = "vale";
      s.items.cloth.holder = "vale";
      return s;
    };
    let s = start();
    s = play(s, act(s, "give", { item: "cloth", target: "moth" })).state;
    expect(s.actors.moth.trust.vale).toBe(0);
    s = start();
    s = play(s, act(s, "give", { item: "lamp", target: "moth" })).state;
    expect(s.actors.moth.trust.vale).toBe(1);
    expect(metEvents(s, "moth")).toHaveLength(1);
  });

  it("sets aside a cast want with no way forward", () => {
    const s = createWorld();
    s.actors.moth.want = newWant("item", "bell", 0);
    s.turn = STALL_TURNS + 1;
    s.revision = s.turn;
    const next = play(s, act(s, "wait")).state;
    expect(next.actors.moth.want?.target).not.toBe("bell");
  });

  it("drops quest records from a legacy save and keeps its world", () => {
    const s = createWorld();
    const legacy = JSON.parse(encodeSave(s));
    for (const a of Object.values(legacy.actors)) {
      delete a.want;
      delete a.xp;
      delete a.visited;
      delete a.talked;
      a.progress = { program: 1, step: 0, marks: [1] };
    }
    legacy.quests = { version: 1, next: 1, records: {}, focus: {} };
    legacy.life = { version: 2, actors: {} };
    const loaded = decodeSave(JSON.stringify(legacy));
    expect(loaded.quests).toBeUndefined();
    expect(loaded.actors.moth.progress).toBeUndefined();
    expect(loaded.actors.moth.want).toMatchObject({
      kind: "item",
      target: "lamp",
    });
  });
});
