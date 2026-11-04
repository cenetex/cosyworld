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
  dropCost,
  STALL_TURNS,
  CONTENT_TURNS,
  contentOf,
} from "../v2/card-game/want.mjs";
import { questCards } from "../v2/card-game/quest-card.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
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

  it("commits want_met, adds experience and leaves the avatar content until it sleeps", () => {
    let s = createWorld();
    s.actors.vale.want = newWant("place", "pond", 0);
    s = play(s, act(s, "move", { target: "pond" })).state;
    const [event] = metEvents(s, "vale");
    expect(event.wantMet).toEqual({ kind: "place", target: "pond" });
    expect(s.actors.vale.xp).toBe(1);
    // The player's level waits for its level quest.
    expect(levelOf(s, "vale")).toBe(1);
    // Enough for now: no next want, and the rules say so.
    expect(s.actors.vale).toMatchObject({ want: null, content: true });
    expect(contentOf(s, "vale")).toBe(true);
    expect(questCards(s, "vale")).toEqual([]);
    expect(
      narrativeContext(s).entities.find((e) => e.id === "vale").desire,
    ).toEqual({ items: [], location: null, avatars: [] });
    expect(decodeSave(encodeSave(s)).actors.vale).toEqual(s.actors.vale);
    // A day of waiting draws nothing; Sleep does, on waking.
    s.turn = s.revision = s.turn + CONTENT_TURNS;
    s = play(s, act(s, "wait")).state;
    expect(s.actors.vale.content).toBe(true);
    s = play(
      s,
      legalActions(s).find((a) => a.sleep),
    ).state;
    expect(s.log.findLast((e) => e.actorId === "vale" && e.woke)).toBeTruthy();
    expect(s.actors.vale.content).toBeUndefined();
    expect(s.actors.vale.want).toMatchObject({ refusals: 0 });
    expect(s.actors.vale.want.since).toBeGreaterThan(event.turn);
    expect(validateWorld(s)).toBe(s);
  });

  it("lets a content resident wait, then draws its next want after a day", () => {
    let s = createWorld();
    s.actors.keeper.want = newWant("place", "station", 0);
    s.actors.keeper.place = "pond";
    s.actors.vale.place = "pond";
    s = play(s, act(s, "wait")).state;
    expect(s.actors.keeper).toMatchObject({ want: null, content: true });
    const metAt = s.actors.keeper.metTurn;
    // Without a want the resident still takes legal plays: it waits.
    expect(plan(s, "keeper").action.kind).toBe("wait");
    for (let i = 0; i < 3; i++) s = play(s, act(s, "wait")).state;
    expect(s.actors.keeper.place).toBe("station");
    s.turn = s.revision = metAt + CONTENT_TURNS;
    s = play(s, act(s, "wait")).state;
    expect(s.actors.keeper.want).not.toBeNull();
    expect(s.actors.keeper.content).toBeUndefined();
    expect(validateWorld(s)).toBe(s);
  });

  it("rests where a want is met, holding the next want", () => {
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
    // Away from home too: the resident rests right where its want is met.
    // The pond is no sanctuary, so that rest leaves its defeats.
    s.actors.keeper.want = newWant("place", "pond", s.turn);
    delete s.actors.keeper.metTurn;
    s.defeats = { keeper: 2 };
    s = play(s, act(s, "wait")).state;
    expect(s.actors.keeper.place).toBe("pond");
    expect(s.actors.keeper.want?.target).not.toBe("station");
    expect(plan(s, "keeper").action.kind).toBe("wait");
    expect(s.defeats).toEqual({ keeper: 2 });
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

  it("never redraws a player's level step for refusals; Drop costs", () => {
    let s = createWorld();
    s.actors.vale.place = "station";
    s.items.oil.holder = "keeper";
    s.actors.keeper.place = "station";
    s.actors.keeper.want = newWant("place", "station", 0);
    const step = { ...newWant("item", "oil", 0), quest: { level: 2, left: 2 } };
    Object.assign(s.actors.vale, { want: step, xp: 1, level: 1 });
    let refused = 0;
    for (let i = 0; i < REFUSAL_LIMIT; i++) {
      const ask = (w) =>
        legalActions(w).find((a) => a.kind === "ask" && a.item === "oil");
      if (!ask(s)) break;
      s = play(s, ask(s)).state;
      if (s.items.oil.holder === "keeper") refused += 1;
    }
    expect(refused).toBeGreaterThan(0);
    // No free redraw (rules 98): the step stays, and only Drop, at its
    // cost, takes it off.
    expect(s.actors.vale.want).toMatchObject({ target: "oil", refusals: 0 });
    expect(s.actors.vale.gaveUp).toBeUndefined();
    expect(dropCost(s, "vale")).toBe(1);
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

  it("keeps a want on every active avatar but the content through a long shared run", () => {
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
          !world.actors[id].content &&
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
