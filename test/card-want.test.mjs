import { questing } from "./helpers/first-quest.mjs";
import { describe, expect, it } from "vitest";
import {
  createWorld as baseCreateWorld,
  decodeSave,
  encodeSave,
  legalActions,
  plan,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
// Play here starts past the pond, where the first quest begins.
const createWorld = (...args) => questing(baseCreateWorld(...args));
import {
  levelFor,
  levelOf,
  newWant,
  reviseStalledWants,
  wantCandidates,
  wantMet,
  REFUSAL_LIMIT,
  STALL_TURNS,
} from "../v2/card-game/want.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { humanAvatarIds } from "../v2/card-game/human-cast.mjs";
import { entityActive } from "../v2/card-game/pack-registry.mjs";

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
    expect(s.actors.moth.want).toEqual({
      ...newWant("item", "lamp", 0),
      lit: true,
    });
    expect(s.actors.keeper.want).toEqual(newWant("item", "bell", 0));
    expect(s.actors.vale.xp).toBe(0);
    expect(validateWorld(s)).toBe(s);
  });

  it("levels follow a rising curve of experience", () => {
    expect([0, 1, 2, 3, 5, 6, 10].map(levelFor)).toEqual([1, 2, 2, 3, 3, 4, 5]);
  });

  it("starts authored pack residents at their tier's first level", () => {
    const s = createWorld();
    expect(levelOf(s, "greek-creon")).toBe(50);
    expect(s.actors["greek-creon"].xp).toBe(1225);
    expect(levelOf(s, "greek-antigone")).toBe(20);
    expect(levelOf(s, "greek-guard")).toBe(1);
    expect(levelOf(s, "vale")).toBe(1);
    expect(validateWorld(decodeSave(encodeSave(s)))).toBeTruthy();
  });

  it("meets an item want when the actor is its root holder", () => {
    const s = createWorld();
    s.items.lamp.holder = "vale";
    expect(wantMet(s, "vale")).toBe(true);
    s.items.cloth.holder = "lamp";
    expect(wantMet(s, "vale")).toBe(true);
    s.items.lamp.holder = "station";
    expect(wantMet(s, "vale")).toBe(false);
  });

  it("meets a lit item want only with the light uncovered in hand", () => {
    const s = createWorld();
    s.items.lamp.holder = "moth";
    s.items.lamp.lit = false;
    expect(wantMet(s, "moth")).toBe(false);
    s.items.lamp.lit = true;
    expect(wantMet(s, "moth")).toBe(true);
    s.items.cloth.holder = "lamp";
    expect(wantMet(s, "moth")).toBe(false);
    expect(validateWorld(s)).toBe(s);
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
    // The player's level waits for its level quest.
    expect(levelOf(s, "vale")).toBe(1);
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

  it("leaves out an item nobody would part with (#1781)", () => {
    const s = createWorld();
    s.actors.moth.place = "station";
    s.actors.keeper.place = "station";
    for (const id of ["oil", "bell", "cloth"]) s.items[id].holder = "keeper";
    s.items.lamp.holder = "station";
    s.actors.keeper.want = newWant("place", "attic", 0);
    const api = {
      carried: () => [],
      rootHolder: (id) => s.items[id].holder,
      valueOf: () => 5,
      reachable: () => [],
      obtainable: (_, id) => id === "cloth",
    };
    const pool = wantCandidates(s, "moth", api).filter((c) =>
      c.startsWith("item:"),
    );
    // Empty-handed Pip can hope only for what the keeper would give.
    expect(pool).toEqual(["item:cloth"]);
    // With nothing near, the wide pool may still hold a mystery.
    expect(wantCandidates(s, "moth", api, null, true)).toContain("item:oil");
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

  it("keeps one want on every active avatar through a long shared run", () => {
    const players = humanAvatarIds.slice(0, 4);
    let world = dispatchShared({ op: "create" }).world;
    const ask = (op, actor, extra = {}) =>
      dispatchShared({
        world,
        op,
        actor,
        claimed: players,
        present: players,
        ...extra,
      });
    // A player still on its way to the Black Pond holds no quest yet.
    const waiting = (a) =>
      !a.visited.includes("pond") && a.metTurn === undefined;
    const wantless = () =>
      Object.keys(world.actors).filter(
        (id) =>
          entityActive(world, id) &&
          !world.actors[id].want &&
          !(
            (id === "vale" || players.includes(id)) &&
            waiting(world.actors[id])
          ),
      );
    expect(wantless()).toEqual([]);
    let met = 0;
    for (let t = 0; t < 300; t++) {
      const actor = players[t % players.length];
      const actions = ask("view", actor).actions.filter(
        (a) => a.kind !== "attack",
      );
      // A play the rules reject leaves the world as it was.
      try {
        const result = ask("play", actor, {
          action: actions[(t * 7919) % actions.length],
        });
        if (result.ok) world = result.world;
      } catch {}
      met = world.log.filter((e) => e.verb === "want_met").length || met;
      if (t % 25 === 24) expect(wantless(), `turn ${world.turn}`).toEqual([]);
    }
    expect(met).toBeGreaterThan(0);
  }, 60000);
});
