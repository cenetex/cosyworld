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
  validateWorld,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import {
  knownActors,
  programFor,
  desireFor,
  levelOf,
} from "../v2/card-game/quests.mjs";
import { availableCards, cardPlay } from "../v2/card-game/cards.mjs";
import { narrativeContext, turnOutcome } from "../v2/card-game/narrative.mjs";
import { sceneCast, currentScene } from "../v2/card-game/scene.mjs";

const fresh = () =>
  enableMotives(createWorld({ opening: true }), { questPrograms: true });
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
  act(act(act(fresh(), "light"), "talk", { target: "moth" }), "move", {
    target: "station",
  });

describe("the first light in the attic", () => {
  it("starts with one avatar, an unlit carried lamp, and the light target hand", () => {
    const s = fresh();
    expect(s.actors.vale.place).toBe("attic");
    expect(s.items.lamp).toMatchObject({ holder: "vale", lit: false, fuel: 8 });
    expect(availableCards(s)).toEqual(["vale", "lamp", "attic"]);
    expect(sceneCast(s)).toEqual(["vale", null]);
    expect(exits(s, "attic")).toEqual([]);
    expect(exits(s, "station")).toEqual(["pond"]);
    expect(cardPlay(s, ["lamp"]).action.kind).toBe("light");
    expect(programFor(s, "vale").name).toBe("Light the lamp");
    expect(desireFor(s, "vale")).toMatchObject({
      items: ["lamp"],
      location: "attic",
      avatars: [],
      conditions: [{ kind: "lit", item: "lamp" }],
    });
    expect(placeText(s, "attic")).toContain("lamp wakes the crossing");
    expect(JSON.stringify(narrativeContext(s))).not.toMatch(
      /keeper|moth|Pip|Oil flask|bell|cloth/,
    );
  });

  it("keeps the waiting cast and their progress in place while the first play is delayed", () => {
    let s = fresh();
    const before = structuredClone([
      s.actors.moth,
      s.actors.keeper,
      s.items.oil,
      s.items.cloth,
    ]);
    for (let i = 0; i < 25; i++) s = act(s, "wait");
    expect([
      s.actors.moth,
      s.actors.keeper,
      s.items.oil,
      s.items.cloth,
    ]).toEqual(before);
    expect(knownActors(s)).toEqual(["vale"]);
    expect(s.memories.moth.events).toEqual([]);
    expect(s.memories.keeper.events).toEqual([]);
    expect(levelOf(s, "vale")).toBe(1);
    s = act(s, "light");
    expect(s.actors.vale.place).toBe("pond");
  });

  it("carries the first light to Pip and records the light card and solo crossing separately", () => {
    const s = act(fresh(), "light");
    expect(s.actors.vale.place).toBe("pond");
    expect(s.items.lamp).toMatchObject({ holder: "vale", lit: true, fuel: 7 });
    expect(s.opening).toEqual({
      version: 1,
      crossed: true,
      met: { vale: 0, moth: 1 },
    });
    expect(s.locations.attic.anchored).toBe(true);
    expect(levelOf(s, "vale")).toBe(2);
    const receipt = s.log.find(
      (e) => e.kind === "quest" && e.actorId === "vale",
    );
    expect(receipt.fulfillment).toMatchObject({
      location: "attic",
      items: ["lamp"],
      conditions: [{ kind: "lit", item: "lamp", met: true }],
    });
    expect(
      s.log.some(
        (e) => e.kind === "action" && ["moth", "keeper"].includes(e.actorId),
      ),
    ).toBe(false);
    const outcome = turnOutcome(s);
    expect(outcome.card.kind).toBe("light");
    expect(outcome.avatars).toHaveLength(2);
    expect(outcome.avatars[0].travel).toEqual({
      from: "attic",
      to: "pond",
      companions: [],
    });
    expect(outcome.avatars[1].travel).toBeNull();
    expect(outcome.items.map((i) => i.id)).toEqual(["lamp", "cloth"]);
    expect(
      narrativeContext(s)
        .entities.find((e) => e.id === "moth")
        .facts.join(" "),
    ).toContain("first meeting");
    expect(currentScene(s).locationId).toBe("pond");
    expect(sceneCast(s)).toEqual(["vale", "moth"]);
  });

  it("meets the keeper on reaching the station, then grows a new program from the discovered world", () => {
    let s = act(fresh(), "light");
    s = act(s, "talk", { target: "moth" });
    expect(desireFor(s, "vale")).toEqual({
      items: ["lamp"],
      location: "station",
      avatars: [],
    });
    expect(knownActors(s)).toEqual(["vale", "moth"]);
    const keeper = structuredClone(s.actors.keeper);
    s = act(s, "move", { target: "station" });
    expect(s.actors.keeper).toEqual(keeper);
    expect(s.opening.met.keeper).toBe(3);
    expect(narrativeContext(s).speakers).toEqual(["vale", "keeper", "moth"]);
    expect(knownActors(s)).toEqual(["vale", "moth", "keeper"]);
    expect(availableCards(s)).toContain("keeper");
    expect(levelOf(s, "vale")).toBe(3);
    expect(programFor(s, "vale").generated).toMatchObject({
      level: 3,
      turn: 3,
    });
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
        (e) => e.turn === 4 && e.actorId === "keeper" && e.kind === "action",
      ),
    ).toBe(true);
  });

  it("keeps the first crossing safe after putting the lamp down or letting it run dry", () => {
    let dropped = act(fresh(), "drop", { item: "lamp" });
    dropped = act(dropped, "light");
    expect(dropped.items.lamp.holder).toBe("vale");
    expect(dropped.actors.vale.place).toBe("pond");
    let s = act(act(fresh(), "light"), "move", { target: "attic" });
    for (let i = 0; i < 9; i++) s = act(s, "wait");
    expect(s.items.lamp.fuel).toBe(0);
    expect(exits(s, "attic")).toEqual(["pond"]);
    expect(exits(s, "station")).toEqual(["pond"]);
    s = act(s, "move", { target: "pond" });
    expect(s.actors.vale.place).toBe("pond");
  });

  it("lets a defeated avatar retreat from the attic through the mirror", () => {
    let s = meetEveryone();
    for (const a of Object.values(s.actors)) a.place = "attic";
    s = act(s, "threaten", { target: "moth" });
    s.standoffs[0].resolve.moth = 1;
    s = act(s, "attack", { target: "moth" });
    expect(s.actors.moth.place).toBe("pond");
    expect(s.standoffs).toEqual([]);
    expect(validateWorld(s)).toBe(s);
  });

  it("keeps new and existing saves on their own routes and authored hands", () => {
    const old = createWorld();
    const restored = decodeSave(encodeSave(old));
    expect(restored).toEqual(old);
    expect(restored.opening).toBeUndefined();
    expect(exits(restored, "attic")).toEqual(["station"]);
    expect(programFor(restored, "vale").id).toBe("borrowed-light");
    for (const s of [fresh(), act(fresh(), "light"), meetEveryone()])
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

  it("keeps trading and levelling through cooperative play after the opening", () => {
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
              "light",
              "refill",
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
      expect(trades).toBeGreaterThan(3);
      expect(decodeSave(encodeSave(s))).toEqual(s);
    }
  });
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
  });
});
