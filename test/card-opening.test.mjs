import "./helpers/no-dwell.mjs";
import { selectLamp } from "./fixtures/card-attic-opening.mjs";
import { roomFuelFromTurns } from "../v2/card-game/lamp-room-fuel.mjs";
import { settleLamp } from "../v2/card-game/lamp-state.mjs";
import { describe, expect, it } from "vitest";
import {
  createWorld,
  legalActions,
  play,
  plan,
  exits,
  encodeSave,
  decodeSave,
  placeText,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { knownActors, levelOf } from "../v2/card-game/want.mjs";
import { availableCards, cardPlay } from "../v2/card-game/cards.mjs";
import { isLockedBox } from "../v2/card-game/locked-box.mjs";
import {
  narrativeContext,
  turnOutcome,
  applyGeneratedText,
} from "../v2/card-game/narrative.mjs";
import { sceneCast, currentScene } from "../v2/card-game/scene.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";

const fresh = () => enableMotives(createWorld({ opening: true }));
const choose = (s, kind, fields = {}) => {
  const action = legalActions(s).find(
    (a) =>
      a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  expect(action, `${kind} at ${s.actors.vale.place}`).toBeTruthy();
  return action;
};
const act = (s, kind, fields) => {
  const action = choose(s, kind, fields);
  const result = play(s, action);
  expect(result.ok).toBe(true);
  expect(play(decodeSave(encodeSave(s)), action)).toEqual(result);
  return result.state;
};
const meetEveryone = () =>
  act(act(selectLamp(fresh()), "move", { target: "pond" }), "move", {
    target: "station",
  });

describe("dousing the lamp in the attic", () => {
  it("brings no quest on arrival at the Black Pond: a player takes its own", () => {
    let s = selectLamp(fresh());
    expect(s.actors.vale.want).toBeNull();
    s = act(s, "move", { target: "pond" });
    expect(s.actors.vale.place).toBe("pond");
    expect(s.actors.vale.want).toBeNull();
    s = decodeSave(encodeSave(s));
    s = act(s, "wait");
    expect(s.actors.vale.want).toBeNull();
    expect(s.actors.vale.visited).toContain("pond");
  });

  it("starts with one avatar, a lit carried lamp, and no quest yet", () => {
    const s = fresh();
    expect(s.actors.vale.place).toBe("attic");
    expect(s.items.lamp).toMatchObject({ holder: "vale", lit: true, fuel: 12 });
    // The Black pond lies in the hand from the start, a locked box (rules 133).
    expect(availableCards(s)).toEqual(["vale", "lamp", "attic", "pond"]);
    expect(isLockedBox(s, "pond")).toBe(true);
    expect(sceneCast(s)).toEqual(["vale", null]);
    expect(exits(s, "attic")).toEqual([]);
    expect(exits(s, "station")).toEqual(["pond"]);
    expect(
      legalActions(s).some((a) => ["light", "snuff"].includes(a.kind)),
    ).toBe(false);
    // The first quest comes at the Black Pond.
    expect(s.actors.vale.want).toBeNull();
    expect(placeText(s, "attic")).toContain("Dust gathers");
    expect(JSON.stringify(narrativeContext(s))).not.toMatch(
      /keeper|moth|Pip|Oil flask|bell|cloth/,
    );
  });

  it("keeps the opening lit through waiting and sleeping until the lamp is stowed", () => {
    let s = fresh();
    expect(exits(s, "attic")).toEqual([]);
    s = act(s, "wait");
    expect(s.turn).toBe(1);
    expect(s.items.lamp).toMatchObject({ lit: true, fuel: 12, fuelRooms: 3 });
    s = act(s, "wait", { sleep: true });
    expect(s.items.lamp).toMatchObject({
      holder: "vale",
      lit: true,
      fuelRooms: 3,
    });
    expect(s.actors.vale.sleeping).toBeUndefined();
    expect(s.log.some((e) => e.woke === "lamp" || e.woke === "dry")).toBe(
      false,
    );
    expect(exits(s, "attic")).toEqual([]);
    const before = s.turn;
    s = selectLamp(s);
    expect(s.turn).toBe(before);
    expect(s.items.lamp).toMatchObject({
      holder: "vale",
      lit: false,
      fuelRooms: 3,
    });
    expect(exits(s, "attic")).toEqual(["pond"]);
    expect(act(s, "move", { target: "pond" }).actors.vale.place).toBe("pond");
  });

  it("keeps the waiting cast and their wants in place while the first play is delayed", () => {
    let s = fresh();
    const held = (s) => [
      s.actors.moth.place,
      s.actors.keeper.place,
      s.items.oil,
      s.items.cloth,
    ];
    const before = structuredClone(held(s));
    // Each Wait is one turn, even in the attic sanctuary.
    for (let i = 0; i < 25; i++) s = act(s, "wait");
    expect(held(s)).toEqual(before);
    expect(knownActors(s)).toEqual(["vale"]);
    expect(s.memories.moth.events).toEqual([]);
    expect(s.memories.keeper.events).toEqual([]);
    // Vale holds no quest in the attic, so nothing is met there.
    expect(s.actors.vale.xp).toBe(0);
    expect(levelOf(s, "vale")).toBe(1);
    // Waiting does not spend room fuel or open the mirror.
    expect(s.items.lamp).toMatchObject({ lit: true, fuel: 12 });
    expect(exits(s, "attic")).toEqual([]);
    expect(s.actors.vale.place).toBe("attic");
    expect(knownActors(s)).toEqual(["vale"]);
  });

  it("reveals a path card while Vale stays in the attic, then travels when it is played", () => {
    const before = fresh();
    const lit = selectLamp(before);
    expect(lit.actors.vale.place).toBe("attic");
    expect(lit.items.lamp).toMatchObject({
      holder: "vale",
      lit: false,
      fuel: 12,
    });
    expect(lit.opening).toEqual({
      version: 1,
      crossed: false,
      met: { vale: 0 },
    });
    expect(lit.locations.attic.anchored).toBe(true);
    // Putting the lamp out opens the pond box and pays its one XP.
    expect(isLockedBox(before, "pond")).toBe(true);
    expect(availableCards(lit)).toContain("pond");
    expect(isLockedBox(lit, "pond")).toBe(false);
    expect(lit.actors.vale.xp).toBe(before.actors.vale.xp + 1);
    expect(lit.opened).toEqual({ pond: ["vale"] });
    expect(exits(lit, "attic")).toEqual(["pond"]);
    expect(levelOf(lit, "vale")).toBe(1);
    expect(
      lit.log.some((e) => e.verb === "want_met" && e.actorId === "vale"),
    ).toBe(false);
    // A quiet hand choice makes no turn outcome or narrated action.
    expect(lit.turn).toBe(before.turn);
    expect(lit.log).toEqual(before.log);
    expect(currentScene(lit).locationId).toBe("attic");
    expect(sceneCast(lit)).toEqual(["vale", null]);
    expect(JSON.stringify(narrativeContext(lit))).not.toMatch(
      /keeper|moth|Pip/,
    );
    const saved = encodeSave(lit);
    const path = cardPlay(lit, ["pond"]);
    expect(path.action.kind).toBe("move");
    expect(encodeSave(lit)).toBe(saved);
    const s = act(lit, "move", { target: "pond" });
    expect(s.opening).toEqual({
      version: 1,
      crossed: true,
      met: { vale: 0, moth: 1 },
    });
    expect(
      s.log.some(
        (e) =>
          e.turn === 1 &&
          e.kind === "action" &&
          ["moth", "keeper"].includes(e.actorId),
      ),
    ).toBe(false);
    expect(turnOutcome(s).card.kind).toBe("move");
    expect(turnOutcome(s).avatars[0].travel).toEqual({
      from: "attic",
      to: "pond",
      companions: [],
    });
    expect(
      narrativeContext(s)
        .entities.find((e) => e.id === "moth")
        .facts.join(" "),
    ).toContain("first meeting");
    expect(currentScene(s).locationId).toBe("pond");
    expect(sceneCast(s)).toEqual(["vale", "moth"]);
  });

  it("asks the model for Vale's first line with no action and Vale alone", () => {
    const s = fresh();
    const context = narrativeContext(s);
    expect(context.turn).toBe(0);
    expect(context.action).toBeNull();
    expect(context.speakers).toEqual(["vale"]);
    expect(JSON.stringify(context)).not.toMatch(/light the lamp/i);
    const next = applyGeneratedText(s, context, {
      revision: context.revision,
      model: "fixture-model",
      entries: context.entities.map(({ id }) => ({
        id,
        text: id === "vale" ? "Dust, and a dark mirror." : "Dust settles.",
      })),
    });
    const words = next.log.filter(
      (entry) => entry.generated && entry.actorId === "vale",
    );
    expect(words.map((entry) => [entry.turn, entry.text])).toEqual([
      [0, "Dust, and a dark mirror."],
    ]);
  });

  it("grounds the unrevealed opening in observations, including after older speech was saved", () => {
    let s = fresh();
    const context = narrativeContext(s);
    const spoiler =
      "I know the hidden solution: light the lamp and the mirror opens the path.";
    s = applyGeneratedText(s, context, {
      revision: context.revision,
      model: "fixture-model",
      entries: context.entities.map(({ id }) => ({ id, text: spoiler })),
    });
    // A play that keeps the lamp burning: a Wait here would sleep the night.
    s = act(s, "drop", { item: "lamp" });
    const next = narrativeContext(s);
    expect(JSON.stringify(next)).not.toMatch(
      /hidden solution|mirror opens|waiting for lamplight|needs a lit|Wake the attic|Reason for the desire/,
    );
    expect(next.conversation).toEqual([]);
    expect(
      next.entities.every(
        (e) =>
          e.previous === null && e.memories.every((m) => m.kind === "event"),
      ),
    ).toBe(true);
    expect(s.memories.vale.text).toBe(spoiler);
    expect(next.entities.find((e) => e.id === "attic").facts).toContain(
      "Paths visible now: none.",
    );
    const lit = selectLamp(act(s, "take", { item: "lamp" }));
    expect(
      narrativeContext(lit).entities.find((e) => e.id === "attic").facts,
    ).toContain("An open passage is visible in the reflection.");
  });

  it("meets the keeper on reaching the station", () => {
    let s = selectLamp(fresh());
    s = act(s, "move", { target: "pond" });
    expect(knownActors(s)).toEqual(["vale", "moth"]);
    const keeper = structuredClone(s.actors.keeper);
    s = act(s, "move", { target: "station" });
    expect(s.actors.keeper).toEqual(keeper);
    expect(s.opening.met.keeper).toBe(2);
    // The newcomer greets; the first arrival also captions the station.
    expect(narrativeContext(s)).toMatchObject({
      occasion: "first_meeting",
      speakers: ["vale", "keeper"],
      scenery: true,
    });
    expect(knownActors(s)).toEqual(["vale", "moth", "keeper"]);
    expect(availableCards(s)).toContain("keeper");
    expect(
      turnOutcome(s).avatars.find((a) => a.id === "keeper").travel,
    ).toBeNull();
    expect(
      narrativeContext(s)
        .entities.find((e) => e.id === "keeper")
        .facts.join(" "),
    ).toContain("You were already here");
    s = act(s, "wait");
    expect(
      s.log.some(
        (e) => e.turn === 3 && e.actorId === "keeper" && e.kind === "action",
      ),
    ).toBe(true);
  });

  // A scarf opens the attic stair at once; it used to fail the opening check
  // and a shared world refused it as "waiting for an update".
  it("crosses the opening when a scarf's stair leads down to the cottage", () => {
    const worn = fresh();
    worn.actors.vale.upgrades = ["scarf"];
    expect(knownActors(worn)).toEqual(["vale"]);
    let s = act(worn, "move", { target: "forest-cottage" });
    expect(s.opening.crossed).toBe(true);
    expect(s.locations.attic.anchored).toBe(true);
    // Vale meets people one by one, as after the pond: only who is here.
    const here = Object.keys(s.actors).filter(
      (id) => id !== "vale" && s.actors[id].place === "forest-cottage",
    );
    expect(Object.keys(s.opening.met).sort()).toEqual(["vale", ...here].sort());
    expect(knownActors(s).length).toBeLessThan(Object.keys(s.actors).length);
    expect(knownActors(s).every((id) => s.opening.met[id] !== undefined)).toBe(
      true,
    );
    s = act(s, "move", { target: "attic" });
    s = act(selectLamp(s), "move", { target: "pond" });
    expect(s.actors.vale.place).toBe("pond");
    expect(s.opening.met.moth).toBe(s.turn);
    const ask = (world, op, extra) =>
      dispatchShared({ world, op, actor: "vale", ...extra });
    let shared = dispatchShared({ op: "create", seed: 7 }).world;
    const seat = { claimed: ["vale"], present: ["vale"] };
    shared = ask(shared, "join", {
      ...seat,
      progress: { upgrades: ["scarf"] },
    }).world;
    const down = ask(shared, "view", seat).actions.find(
      (a) => a.kind === "move" && a.target === "forest-cottage",
    );
    const played = ask(shared, "play", { ...seat, action: down });
    expect(played.ok).toBe(true);
    expect(played.world.actors.vale.place).toBe("forest-cottage");
  });

  it("keeps a placed lamp burning and restores a genuinely exhausted opening", () => {
    const dropped = act(fresh(), "drop", { item: "lamp" });
    expect(dropped.items.lamp).toMatchObject({
      holder: "attic",
      lit: true,
      fuelRooms: 3,
    });
    const picked = act(dropped, "take", { item: "lamp" });
    expect(picked.items.lamp.holder).toBe("vale");
    expect(selectLamp(picked).items.lamp.lit).toBe(false);
    let s = fresh();
    Object.assign(s.items.lamp, roomFuelFromTurns(0, "attic"));
    settleLamp(s);
    expect(s.opening.crossed).toBe(false);
    expect(knownActors(s)).toEqual(["vale"]);
    s = decodeSave(encodeSave(s));
    expect(exits(s, "attic")).toEqual(["pond"]);
    expect(exits(s, "station")).toEqual(["pond"]);
    expect(availableCards(s)).toContain("pond");
    expect(availableCards(s)).not.toContain("station");
    expect(cardPlay(s, ["pond"]).action.kind).toBe("move");
    expect(placeText(s, "attic")).toContain("black shore");
    expect(s.actors.vale.place).toBe("attic");
  });

  it("keeps new and existing saves on their own routes and authored wants", () => {
    const old = createWorld();
    const restored = decodeSave(encodeSave(old));
    expect(restored).toEqual(old);
    expect(restored.opening).toBeUndefined();
    expect(exits(restored, "attic")).toEqual([]);
    expect(restored.actors.keeper.want).toMatchObject({
      kind: "item",
      target: "bell",
    });
    for (const s of [fresh(), selectLamp(fresh()), meetEveryone()])
      expect(decodeSave(encodeSave(s))).toEqual(s);
  });

  it("checks discovery records during save restore", () => {
    for (const opening of [
      null,
      {},
      { version: 2 },
      { version: 1, crossed: false, met: { vale: 0, keeper: 0 } },
      { version: 1, crossed: true, met: { vale: 0 } },
      { version: 1, crossed: false, met: { vale: 0, moth: 999 } },
    ]) {
      const s = fresh();
      s.opening = opening;
      expect(() => decodeSave(JSON.stringify(s))).toThrow();
    }
  });

  it("keeps meeting wants and trading through cooperative play after the opening", () => {
    for (const seedStart of [7, 42, 1729]) {
      let s = meetEveryone(),
        seed = seedStart,
        trades = 0;
      for (let i = 0; i < 240; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const acts = legalActions(s).filter((a) =>
            [
              "wait",
              "move",
              "take",
              "give",
              "trade",
              "accompany",
              "talk",
            ].includes(a.kind),
          ),
          a = i % 3 ? plan(s).action : acts[seed % acts.length];
        const result = play(s, a);
        if (i % 20 === 0)
          expect(play(decodeSave(encodeSave(s)), a)).toEqual(result);
        expect(result.ok).toBe(true);
        s = result.state;
        trades += s.log.filter(
          (e) => e.turn === s.turn && e.verb === "trade",
        ).length;
      }
      expect(levelOf(s, "moth")).toBeGreaterThan(3);
      expect(levelOf(s, "keeper")).toBeGreaterThan(3);
      // Trades are one escalation among several; most wants end sooner.
      expect(trades).toBeGreaterThan(0);
      expect(decodeSave(encodeSave(s))).toEqual(s);
    }
  }, 60_000);
  it("preserves the world through mixed combat, item use, and travel after discovery", () => {
    let s = meetEveryone(),
      seed = 7;
    for (let i = 0; i < 1000; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const actions = legalActions(s),
        action = actions[seed % actions.length];
      const result = play(s, action);
      expect(result.ok).toBe(true);
      s = result.state;
      if (i % 50 === 0) expect(decodeSave(encodeSave(s))).toEqual(s);
    }
  }, 60_000);
});
