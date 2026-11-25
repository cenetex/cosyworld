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
  wantAPI,
} from "../v2/card-game/world.mjs";
// Play here starts past the pond, where the first quest begins.
const createWorld = (...args) => questing(baseCreateWorld(...args));
import { holdQuest, levelFor, levelOf, newWant, releaseQuest, reviseStalledWants, wantCandidates, wantMet, REFUSAL_LIMIT, STALL_TURNS, CONTENT_TURNS } from "../v2/card-game/want.mjs";
import { questCards } from "../v2/card-game/quest-card.mjs";
import { questFor } from "../v2/card-game/talk-quest.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { humanAvatarIds } from "../v2/card-game/human-cast.mjs";
import { entityActive, packPeople } from "../v2/card-game/pack-registry.mjs";

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
    expect(s.actors.keeper.want).toEqual({
      ...newWant("place", "pond", 0),
      step: { verb: "call", crossing: "pond-greek-harbor" },
    });
    expect(s.actors.vale.xp).toBe(0);
    expect(validateWorld(s)).toBe(s);
  });

  it("levels follow a rising curve of experience", () => {
    expect([0, 1, 2, 3, 5, 6, 10].map(levelFor)).toEqual([1, 2, 2, 3, 3, 4, 5]);
  });

  it("starts authored pack residents at their tier's first level", () => {
    const s = createWorld();
    expect(levelOf(s, "greek-creon")).toBe(19);
    expect(s.actors["greek-creon"].xp).toBe(1225);
    expect(levelOf(s, "greek-antigone")).toBe(11);
    expect(levelOf(s, "greek-guard")).toBe(1);
    expect(levelOf(s, "vale")).toBe(0);
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

  it("commits want_met, pays a traveler no XP and leaves a player holding no quest", () => {
    let s = createWorld();
    s.actors.vale.want = newWant("place", "pond", 0);
    s = play(s, act(s, "move", { target: "pond" })).state;
    const [event] = metEvents(s, "vale");
    expect(event.wantMet).toEqual({ kind: "place", target: "pond" });
    // Paid on the play that meets it: no receipt, no claim.
    expect(s.actors.vale.xp).toBe(0);
    expect(s.actors.vale.questRewards).toBeUndefined();
    expect(legalActions(s).some((a) => a.kind === "claim")).toBe(false);
    expect(levelOf(s, "vale")).toBe(0);
    // Nothing is drawn for a player, now or after Sleep.
    expect(s.actors.vale.want).toBeNull();
    expect(s.actors.vale.content).toBeUndefined();
    expect(questCards(s, "vale")).toEqual([]);
    expect(
      narrativeContext(s).entities.find((e) => e.id === "vale").desire,
    ).toEqual({ items: [], location: null, avatars: [] });
    expect(decodeSave(encodeSave(s)).actors.vale).toEqual(s.actors.vale);
    s.turn = s.revision = s.turn + CONTENT_TURNS;
    s = play(s, act(s, "wait")).state;
    expect(s.actors.vale.want).toBeNull();
    s = play(
      s,
      legalActions(s).find((a) => a.sleep),
    ).state;
    expect(s.log.findLast((e) => e.actorId === "vale" && e.woke)).toBeTruthy();
    expect(s.actors.vale.want).toBeNull();
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
    delete s.actors.keeper.dwellUntil; // its stay at the station is over
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

  it("keeps an authored want asleep until a player meets its resident", () => {
    const fresh = () => {
      const s = baseCreateWorld({ opening: true });
      const id = Object.keys(packPeople).find(
        (other) =>
          (packPeople[other].want || packPeople[other].wants) &&
          entityActive(s, other) && s.actors[other].want && wantAPI(s).metTurn(other) === undefined,
      );
      return { s, id, start: { ...s.actors[id].want }, met: s.packs[packPeople[id].packId].met };
    };
    const { s, id, start, met } = fresh();
    const moth = { ...s.actors.moth.want };
    s.turn = 500;
    reviseStalledWants(s, [id, "moth"], wantAPI(s));
    expect(s.actors[id].want).toEqual(start);
    expect(s.actors.moth.want).toEqual(moth);
    met[id] = s.turn;
    s.turn += STALL_TURNS - 1;
    reviseStalledWants(s, [id], wantAPI(s));
    expect(s.actors[id].want).toEqual(start);
    s.turn += 1;
    reviseStalledWants(s, [id], wantAPI(s));
    expect(s.actors[id].gaveUp).toEqual({ target: start.target, turn: s.turn });
    const held = fresh();
    held.met[held.id] = 500;
    holdQuest(held.s, "vale", questFor(held.s, held.id, held.start), `quest:from:${held.id}`);
    held.s.turn = 2000;
    reviseStalledWants(held.s, [held.id], wantAPI(held.s));
    expect(held.s.actors[held.id].want).toEqual(held.start);
    const drawn = fresh();
    drawn.s.actors[drawn.id].want = newWant("person", drawn.id === "vale" ? "moth" : "vale", 0);
    drawn.s.turn = STALL_TURNS;
    reviseStalledWants(drawn.s, [drawn.id], wantAPI(drawn.s));
    expect(drawn.s.actors[drawn.id].gaveUp?.turn).toBe(STALL_TURNS);
  });

  it("wakes a want when any player first stands with its resident", () => {
    const both = { claimed: ["rue", "mara"], present: ["rue", "mara"] };
    let world = dispatchShared({ op: "create" }).world;
    world = dispatchShared({ op: "join", world, actor: "mara", ...both }).world;
    const id = Object.keys(packPeople).find(
      (other) => entityActive(world, other) && wantAPI(world).metTurn(other) === undefined,
    );
    world.actors.mara.place = world.actors[id].place;
    const { actions } = dispatchShared({ op: "view", world, actor: "mara", ...both });
    const wait = actions.find((a) => a.kind === "wait" && !a.sleep);
    world = dispatchShared({ op: "play", world, actor: "mara", ...both, action: wait }).world;
    expect(wantAPI(world).metTurn(id)).toBe(world.turn);
  });

  it("never redraws a player's quest for refusals; Drop is free", () => {
    let s = createWorld();
    s.actors.vale.place = "station";
    s.items.oil.holder = "keeper";
    s.actors.keeper.place = "station";
    s.actors.keeper.want = newWant("place", "station", 0);
    const step = newWant("item", "oil", 0);
    Object.assign(s.actors.vale, { want: step, xp: 3, level: 1 });
    let refused = 0;
    for (let i = 0; i < REFUSAL_LIMIT; i++) {
      const ask = (w) =>
        legalActions(w).find((a) => a.kind === "ask" && a.item === "oil");
      if (!ask(s)) break;
      s = play(s, ask(s)).state;
      if (s.items.oil.holder === "keeper") refused += 1;
    }
    expect(refused).toBeGreaterThan(0);
    expect(s.actors.vale.want).toMatchObject({ target: "oil", refusals: 0 });
    expect(s.actors.vale.gaveUp).toBeUndefined();
    s = play(s, act(s, "drop", { item: null }), s.revision).state;
    expect(s.actors.vale.want).toBeNull();
    expect(s.actors.vale.xp).toBe(3);
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

  it("keeps an accepted want with no way forward, and sets aside one no player holds", () => {
    const world = () => {
      const s = createWorld();
      s.turn = 200;
      return s;
    };
    const api = (s) => ({ ...wantAPI(s), reachable: () => [] });
    const s = world();
    const off = Object.keys(s.actors).find((id) => !entityActive(s, id));
    const wants = () => [
      newWant("item", "bell", 0),
      newWant("place", "attic", 0),
      newWant("person", "keeper", 0),
      newWant("person", off, 0),
    ];
    holdQuest(s, "vale", questFor(s, "moth", wants()[0]), "quest:from:moth");
    for (const want of wants()) {
      s.actors.moth.want = want;
      reviseStalledWants(s, ["moth"], api(s));
      expect(s.actors.moth.want).toMatchObject({ target: want.target, since: 0 });
    }
    for (const want of wants().slice(1).filter((w) => w.target !== "keeper")) {
      const open = world();
      open.actors.moth.want = want;
      reviseStalledWants(open, ["moth"], api(open));
      expect(open.actors.moth.want?.target).not.toBe(want.target);
      expect(open.actors.moth.gaveUp).toEqual({ target: want.target, turn: 200 });
    }
  });

  it("keeps a want on every active resident but the content through a long shared run", () => {
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
    // A player holds a quest only when it takes one by a tap.
    const wantless = () =>
      Object.keys(world.actors).filter(
        (id) =>
          entityActive(world, id) &&
          !world.actors[id].want &&
          !world.actors[id].content &&
          !(id === "vale" || players.includes(id)),
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
