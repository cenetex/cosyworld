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
  nextWant,
  weightedCandidates,
  reviseStalledWants,
  wantCandidates,
  wantMet,
  BLOCKED_TURNS,
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

  it("draws the next want from everything the avatar knows of", () => {
    const s = createWorld();
    s.actors.moth.place = "station";
    s.actors.moth.visited = ["station"];
    // Pip has seen the station, the keeper and the loose oil, and heard of
    // the bell; it knows nothing of the cloth.
    s.items.oil.holder = "pond";
    s.actors.moth.known = ["station", "keeper", "oil", "bell", "lamp"];
    s.items.lamp.holder = "moth";
    const api = {
      carried: () => ["lamp"],
      rootHolder: (id) => {
        let h = s.items[id].holder;
        while (s.items[h]) h = s.items[h].holder;
        return h;
      },
      valueOf: (_, id) => ({ lamp: 12, cloth: 6, oil: 3 })[id] ?? 1,
      reachable: () => ["attic", "pond"],
      routePlaces: () => [],
      isPlace: (id) => ["attic", "pond", "station"].includes(id),
      transportPlace: () => false,
    };
    const pool = wantCandidates(s, "moth", api);
    expect(pool).toContain("place:pond");
    expect(pool).toContain("person:keeper");
    // A thing lying loose in a place can be wanted, and so can one valued
    // at the minimum; what Pip holds, where it stands and what it has never
    // seen or heard of cannot.
    expect(pool).toContain("item:oil");
    expect(pool).toContain("item:bell");
    expect(pool).not.toContain("item:lamp");
    expect(pool).not.toContain("place:station");
    expect(pool).not.toContain("item:cloth");
    expect(wantCandidates(s, "moth", api)).toEqual(pool);
    // Preference weights the draw: the near unvisited pond outweighs the
    // minimum-valued bell.
    const weight = (kind, target) =>
      weightedCandidates(s, "moth", api).find(
        ([k, t]) => k === kind && t === target,
      )[2];
    expect(weight("place", "pond")).toBeGreaterThan(weight("item", "bell"));
    expect(nextWant(s, "moth", api)).toEqual(nextWant(s, "moth", api));
  });

  it("learns what it sees where it stands and what it hears in Talk", () => {
    let s = createWorld();
    s.actors.vale.place = "station";
    s.actors.keeper.place = "station";
    s.items.oil.holder = "station";
    s.actors.keeper.want = newWant("item", "cloth", 0);
    s.actors.vale.known = ["station"];
    s = play(s, act(s, "talk", { target: "keeper" })).state;
    const known = s.actors.vale.known;
    // Seen: the loose oil and the keeper. Heard: the keeper wants the cloth.
    expect(known).toEqual(expect.arrayContaining(["oil", "keeper", "cloth"]));
    expect(known).not.toContain("vale");
    expect(validateWorld(s)).toBe(s);
    expect(decodeSave(encodeSave(s)).actors.vale.known).toEqual(known);
  });

  it("keeps an unseen resident's starter want until it has tried", () => {
    const s = createWorld();
    const id = "greek-antigone";
    const start = s.actors[id].want;
    expect(start).toMatchObject({ kind: "item", refusals: 0 });
    const api = {
      carried: () => [],
      rootHolder: (item) => s.items[item].holder,
      valueOf: () => 5,
      reachable: () => [],
    };
    s.turn = STALL_TURNS * 3;
    reviseStalledWants(s, [id], api);
    expect(s.actors[id].want).toEqual(start);
    // After a refusal the clock runs from that attempt.
    s.actors[id].want = { ...start, refusals: 1, since: s.turn };
    s.turn += STALL_TURNS;
    reviseStalledWants(s, [id], api);
    expect(s.actors[id].want?.target).not.toBe(start.target);
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

  it("sets aside sooner a want with no play toward it", () => {
    const s = createWorld();
    // The attic is beyond every open route from the station.
    s.actors.keeper.place = "station";
    s.actors.keeper.want = newWant("place", "attic", 0);
    s.turn = BLOCKED_TURNS + 1;
    s.revision = s.turn;
    expect(plan(s, "keeper").action.kind).toBe("wait");
    const next = play(s, act(s, "wait")).state;
    expect(next.actors.keeper.want?.target).not.toBe("attic");
    expect(next.actors.keeper.gaveUp).toMatchObject({ target: "attic" });
  });

  it("lets a challenger whose want moved on leave its standoff", () => {
    const s = createWorld();
    for (const id of ["keeper", "moth"]) s.actors[id].place = "station";
    s.items.lamp.holder = "moth";
    s.standoffs = [
      {
        challenger: "keeper",
        defender: "moth",
        location: "station",
        item: "lamp",
        opened: 0,
        answered: true,
        resolve: { keeper: 4, moth: 4 },
        guarding: { keeper: false, moth: false },
        struck: { keeper: false, moth: false },
      },
    ];
    s.actors.keeper.want = newWant("item", "lamp", 0);
    expect(plan(s, "keeper").action.kind).toBe("wait");
    s.actors.keeper.want = newWant("place", "pond", 0);
    expect(plan(s, "keeper").action).toMatchObject({
      kind: "move",
      target: "pond",
    });
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
