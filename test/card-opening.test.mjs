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
import {
  narrativeContext,
  turnOutcome,
  applyGeneratedText,
} from "../v2/card-game/narrative.mjs";
import { sceneCast, currentScene } from "../v2/card-game/scene.mjs";

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
  act(act(act(fresh(), "snuff"), "move", { target: "pond" }), "move", {
    target: "station",
  });

describe("dousing the lamp in the attic", () => {
  it("brings the first quest on arrival at the Black Pond, and keeps it", () => {
    let s = act(fresh(), "snuff");
    expect(s.actors.vale.want).toBeNull();
    s = act(s, "move", { target: "pond" });
    expect(s.actors.vale.place).toBe("pond");
    const first = s.actors.vale.want;
    expect(first).not.toBeNull();
    // A save already past the pond keeps its quest through later plays.
    s = decodeSave(encodeSave(s));
    s = act(s, "wait");
    // Its quest is still there, or was met and its next one drawn in rest.
    expect(s.actors.vale.want !== null || s.actors.vale.metTurn !== undefined).toBe(true);
    expect(s.actors.vale.visited).toContain("pond");
  });

  it("starts with one avatar, a lit carried lamp, and no quest yet", () => {
    const s = fresh();
    expect(s.actors.vale.place).toBe("attic");
    expect(s.items.lamp).toMatchObject({ holder: "vale", lit: true, fuel: 12 });
    expect(availableCards(s)).toEqual(["vale", "lamp", "attic"]);
    expect(sceneCast(s)).toEqual(["vale", null]);
    expect(exits(s, "attic")).toEqual([]);
    expect(exits(s, "station")).toEqual(["pond"]);
    expect(cardPlay(s, ["lamp"]).action.kind).toBe("snuff");
    // The first quest comes at the Black Pond.
    expect(s.actors.vale.want).toBeNull();
    expect(placeText(s, "attic")).toContain("Dust gathers");
    expect(JSON.stringify(narrativeContext(s))).not.toMatch(
      /keeper|moth|Pip|Oil flask|bell|cloth/,
    );
  });

  it("opens the mirror when the full lamp burns out by itself, with no douse", () => {
    let s = fresh();
    expect(exits(s, "attic")).toEqual([]);
    // The attic Wait sleeps until the light changes: all twelve fuel burn.
    s = act(s, "wait");
    expect(s.log.some((e) => e.verb === "snuff")).toBe(false);
    expect(s.items.lamp).toMatchObject({ holder: "vale", lit: false, fuel: 0 });
    expect(s.turn).toBeGreaterThanOrEqual(12);
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
    // The attic is a sanctuary: each Wait there sleeps until the light
    // changes, so these waits span many nights.
    for (let i = 0; i < 25; i++) s = act(s, "wait");
    expect(held(s)).toEqual(before);
    expect(knownActors(s)).toEqual(["vale"]);
    expect(s.memories.moth.events).toEqual([]);
    expect(s.memories.keeper.events).toEqual([]);
    // Vale holds no quest in the attic, so nothing is met there.
    expect(s.actors.vale.xp).toBe(0);
    expect(levelOf(s, "vale")).toBe(1);
    // The lamp burned dry while everyone waited; its dark opens the mirror.
    expect(s.items.lamp).toMatchObject({ lit: false, fuel: 0 });
    expect(exits(s, "attic")).toEqual(["pond"]);
    expect(s.actors.vale.place).toBe("attic");
    expect(knownActors(s)).toEqual(["vale"]);
  });

  it("reveals a path card while Vale stays in the attic, then travels when it is played", () => {
    const before = fresh();
    const lit = act(before, "snuff");
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
    expect(
      availableCards(lit).filter((id) => !availableCards(before).includes(id)),
    ).toEqual(["pond"]);
    expect(exits(lit, "attic")).toEqual(["pond"]);
    expect(levelOf(lit, "vale")).toBe(1);
    expect(
      lit.log.some((e) => e.verb === "want_met" && e.actorId === "vale"),
    ).toBe(false);
    expect(turnOutcome(lit)).toMatchObject({
      card: { kind: "snuff" },
      avatars: [{ id: "vale", location: "attic", travel: null }],
    });
    expect(turnOutcome(lit).items.map((i) => i.id)).toEqual(["lamp"]);
    expect(currentScene(lit).locationId).toBe("attic");
    expect(sceneCast(lit)).toEqual(["vale", null]);
    expect(narrativeContext(lit).events.join(" ")).toContain(
      "opens a path to the pond",
    );
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
      met: { vale: 0, moth: 2 },
    });
    expect(
      s.log.some(
        (e) =>
          e.turn === 2 &&
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
    const lit = act(s, "snuff");
    expect(
      narrativeContext(lit).entities.find((e) => e.id === "attic").facts,
    ).toContain("An open passage is visible in the reflection.");
  });

  it("meets the keeper on reaching the station", () => {
    let s = act(fresh(), "snuff");
    s = act(s, "move", { target: "pond" });
    expect(knownActors(s)).toEqual(["vale", "moth"]);
    const keeper = structuredClone(s.actors.keeper);
    s = act(s, "move", { target: "station" });
    expect(s.actors.keeper).toEqual(keeper);
    expect(s.opening.met.keeper).toBe(3);
    expect(narrativeContext(s).speakers).toEqual(["vale", "keeper", "moth"]);
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
        (e) => e.turn === 4 && e.actorId === "keeper" && e.kind === "action",
      ),
    ).toBe(true);
  });

  it("takes the lamp when relighting it and opens the mirror when its fuel runs out", () => {
    let dropped = act(act(fresh(), "drop", { item: "lamp" }), "snuff");
    dropped = act(dropped, "light");
    expect(dropped.items.lamp.holder).toBe("vale");
    expect(dropped.actors.vale.place).toBe("attic");
    let s = fresh();
    for (let i = 0; i < 8; i++) s = act(s, "wait");
    expect(s.items.lamp.fuel).toBe(0);
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
    for (const s of [fresh(), act(fresh(), "snuff"), meetEveryone()])
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
              "light",
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
