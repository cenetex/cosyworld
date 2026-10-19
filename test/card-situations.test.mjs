import { describe, it, expect } from "vitest";
import {
  createWorld,
  play,
  legalActions,
  plan,
  handStatus,
  reflectionOpen,
  willingToGive,
  accompanyDecision,
  encodeSave,
  decodeSave,
  places,
  things,
} from "../v2/card-game/world.mjs";
import {
  hand,
  hold,
  at,
  withAvatars,
  condition,
  generateProgram,
  programFor,
} from "../v2/card-game/quests.mjs";
import {
  speechMemories,
  narrativeContext,
} from "../v2/card-game/narrative.mjs";
import { addLog } from "../v2/card-game/world.mjs";

function continuing() {
  const s = createWorld();
  s.schema = 2;
  s.turn = s.revision = 20;
  for (const [id, actor] of Object.entries(s.actors)) {
    actor.place = "station";
    actor.progress = {
      program: 2,
      step: 0,
      marks: Array.from({ length: id === "vale" ? 5 : 4 }, (_, i) => i + 1),
    };
  }
  return decodeSave(JSON.stringify(s));
}
function use(s, kind, item, target) {
  const action = legalActions(s).find(
    (a) =>
      a.kind === kind &&
      (!item || a.item === item) &&
      (!target || a.target === target),
  );
  expect(action, `${kind} ${item || ""} ${target || ""}`).toBeTruthy();
  const result = play(s, action);
  expect(result.ok).toBe(true);
  return result.state;
}
function lastStep(s, target) {
  s.actors.vale.progress.current.steps = [target];
  return s;
}

describe("situations and their consequences", () => {
  it("chooses different situations from current custody, past help and recent programs", () => {
    const s = continuing();
    s.items.lamp.holder = s.items.bell.holder = s.items.cloth.holder = "vale";
    s.actors.moth.progress.current.steps = [hand(hold("cloth"), at("pond"))];
    const before = encodeSave(s),
      kinds = [];
    for (let i = 0; i < 4; i++) {
      s.actors.vale.progress.recentKinds = [...kinds];
      const p = generateProgram(s, "vale", places, things);
      expect(p).toEqual(generateProgram(s, "vale", places, things));
      kinds.push(p.generated.situation);
      expect(p.purpose.length).toBeLessThanOrEqual(240);
    }
    expect(new Set(kinds)).toEqual(
      new Set(["crossing", "answer", "delivery", "gathering"]),
    );
    s.actors.vale.progress.recentKinds = [];
    expect(encodeSave(s)).toBe(before);
    s.locations.attic.anchored = true;
    expect(
      generateProgram(s, "vale", places, things).generated.situation,
    ).not.toBe("crossing");
    s.items.lamp.fuel = s.items.oil.doses = 0;
    expect(
      generateProgram(s, "vale", places, things).generated.situation,
    ).not.toBe("gathering");
  });

  it("checks actual use, coverings and custody together with the target hand", () => {
    const s = createWorld();
    s.items.lamp.holder = s.items.bell.holder = "vale";
    s.items.cloth.holder = "lamp";
    s.items.lamp.lit = true;
    const lit = hand(hold("lamp"), at("station"), condition("lit", "lamp"));
    expect(handStatus(s, "vale", lit).met).toBe(false);
    s.items.cloth.holder = "vale";
    expect(handStatus(s, "vale", lit).met).toBe(true);
    const delivered = hand(
      withAvatars("moth"),
      condition("heldBy", "lamp", { avatar: "moth" }),
    );
    s.actors.moth.place = "station";
    expect(handStatus(s, "vale", delivered).met).toBe(false);
    s.items.lamp.holder = "moth";
    expect(handStatus(s, "vale", delivered).met).toBe(true);
  });

  it("records a crossing once and keeps the path open through darkness and reload", () => {
    let s = continuing();
    s.actors.vale.place = "pond";
    s.items.lamp.holder = "vale";
    s = lastStep(s, {
      ...hand(hold("lamp"), at("pond")),
      consequence: { kind: "anchor" },
    });
    s = use(s, "wait");
    expect(s.locations.attic.anchored).toBe(true);
    s.items.lamp.fuel = 0;
    s.items.lamp.lit = false;
    expect(reflectionOpen(s)).toBe(true);
    const effects = s.log.filter((e) => e.consequence?.kind === "anchor");
    expect(effects).toHaveLength(1);
    const restored = decodeSave(encodeSave(s));
    expect(play(restored, plan(restored).action)).toEqual(
      play(s, plan(s).action),
    );
    expect(reflectionOpen(restored)).toBe(true);
  });

  it("a bell call restores the real oil resource only after the played sound", () => {
    let s = continuing();
    s.actors.vale.place = "pond";
    s.items.bell.holder = "vale";
    s.items.oil.doses = 0;
    s = lastStep(s, {
      ...hand(hold("bell"), at("pond"), condition("ringing", "bell")),
      consequence: { kind: "oil" },
    });
    expect(plan(s).action.kind).toBe("ring");
    expect(handStatus(s, "vale").met).toBe(false);
    s = use(s, "ring", "bell");
    expect(s.items.oil.doses).toBe(3);
    expect(s.locations.pond.answer).toBe("call");
    const receipt = s.log.findLast(
      (e) => e.kind === "quest" && e.actorId === "vale",
    );
    expect(receipt.fulfillment.conditions).toEqual([
      { kind: "ringing", item: "bell", met: true },
    ]);
    expect(decodeSave(encodeSave(s))).toEqual(s);
    receipt.fulfillment.conditions[0].met = false;
    expect(() => decodeSave(JSON.stringify(s))).toThrow();
  });

  it("keeps the first sighting in memory while later crossings record fresh movement", () => {
    let s = continuing();
    s.actors.vale.place = "attic";
    s.items.lamp.holder = "vale";
    s.items.lamp.lit = true;
    s = use(s, "move", null, "pond");
    s = use(s, "move", null, "attic");
    expect(
      s.log.filter((e) =>
        e.text.includes("Something on the far shore turns its head"),
      ),
    ).toHaveLength(1);
    expect(s.actors.vale.crossed).toBe(2);
  });

  it("wrapping the bell makes a refuge that a new ringing ends", () => {
    let s = continuing();
    s.actors.vale.place = "pond";
    s.items.bell.holder = s.items.cloth.holder = "vale";
    s = lastStep(s, {
      ...hand(hold("bell", "cloth"), at("pond"), condition("covered", "bell")),
      consequence: { kind: "hush" },
    });
    expect(plan(s).action).toMatchObject({ kind: "cover", target: "bell" });
    s = use(s, "cover", "cloth", "bell");
    expect(s.locations.pond.answer).toBe("hush");
    s = use(s, "take", "cloth");
    s = use(s, "ring", "bell");
    expect(s.locations.pond.answer).toBe(null);
  });

  it("a real handover earns help with spare items and a future detour", () => {
    let s = continuing();
    s.items.lamp.holder = "vale";
    s.items.oil.holder = "moth";
    s.items.cloth.holder = "keeper";
    s.actors.moth.progress.current.steps = [hand(hold("cloth"), at("pond"))];
    s = lastStep(s, {
      ...hand(
        at("station"),
        withAvatars("moth"),
        condition("heldBy", "lamp", { avatar: "moth" }),
      ),
      consequence: { kind: "trust", avatar: "moth" },
    });
    expect(willingToGive(s, "moth", "oil", "vale")).toBe(false);
    expect(plan(s).action).toMatchObject({
      kind: "give",
      item: "lamp",
      target: "moth",
    });
    s = use(s, "give", "lamp", "moth");
    expect(s.actors.moth.trust.vale).toBe(1);
    expect(willingToGive(s, "moth", "oil", "vale")).toBe(true);
    expect(accompanyDecision(s, "vale", "moth", "attic").accepted).toBe(true);
    expect(
      s.memories.moth.landmarks.some((e) => e.text.includes("remembers Vale")),
    ).toBe(true);
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });

  it("uncovers an attached item before a promised handover", () => {
    let s = continuing();
    s.items.bell.holder = "vale";
    s.items.cloth.holder = "bell";
    s.actors.moth.progress.current.steps = [hand(hold("oil"), at("station"))];
    s = lastStep(s, {
      ...hand(
        at("station"),
        withAvatars("moth"),
        condition("heldBy", "cloth", { avatar: "moth" }),
      ),
      consequence: { kind: "trust", avatar: "moth" },
    });
    expect(plan(s).action).toMatchObject({ kind: "take", item: "cloth" });
    s = use(s, "take", "cloth");
    expect(plan(s).action).toMatchObject({
      kind: "give",
      item: "cloth",
      target: "moth",
    });
    s = use(s, "give", "cloth", "moth");
    expect(s.actors.moth.trust.vale).toBe(1);
  });

  it("recovers oil for a light-based goal through the same item plays", () => {
    let s = continuing();
    s.actors.vale.place = "pond";
    s.items.lamp.holder = s.items.bell.holder = "vale";
    s.items.lamp.fuel = s.items.oil.doses = 0;
    s.items.oil.holder = "station";
    s = lastStep(s, hand(hold("lamp"), at("attic"), condition("lit", "lamp")));
    expect(plan(s).action).toMatchObject({ kind: "ring", item: "bell" });
    s = use(s, "ring", "bell");
    expect(s.items.oil.doses).toBe(1);
    expect(
      s.memories.oil.events.some((e) => e.text.includes("One measure of oil")),
    ).toBe(true);
    for (let i = 0; i < 40 && s.actors.vale.progress.program === 2; i++)
      s = play(s, plan(s).action).state;
    expect(s.actors.vale.progress.program).toBeGreaterThan(2);
    expect(s.items.oil.doses).toBeLessThanOrEqual(3);
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });

  it("spends an earned favour on a detour while keeping the remembered help", () => {
    let s = createWorld();
    s.actors.moth.place = "station";
    s.actors.moth.trust.vale = 1;
    s.items.lamp.holder = "moth";
    s.actors.moth.progress.current = undefined;
    const action = legalActions(s).find(
      (a) =>
        a.kind === "accompany" &&
        a.target === "moth" &&
        a.destination === "attic",
    );
    expect(accompanyDecision(s, "vale", "moth", "attic").favor).toBe(true);
    s = play(s, action).state;
    expect(s.actors.moth.trust.vale).toBe(0);
    expect(
      s.memories.moth.landmarks.some((e) =>
        e.text.includes("share this detour"),
      ),
    ).toBe(true);
  });

  it("keeps a witnessed kindness after many later descriptions and removes quest counters from speech", () => {
    const s = createWorld();
    addLog(s, "World", "Vale gives Pip the lamp.", {
      kind: "action",
      actorId: "vale",
      targetId: "moth",
      itemId: "lamp",
      verb: "give",
    });
    for (let i = 0; i < 22; i++)
      addLog(s, "Pip", "Warm glass catches the light.", {
        generated: true,
        entityId: "moth",
      });
    const memories = speechMemories(s.memories.moth);
    expect(memories.some((m) => m.text.includes("gives Pip"))).toBe(true);
    expect(memories.length).toBeLessThanOrEqual(8);
    addLog(s, "World", "Vale completes hand 1/2. Level 4. Next: hold Bell.", {
      kind: "quest",
      actorId: "vale",
    });
    const context = narrativeContext(s);
    expect(context.events.join(" ")).not.toMatch(/completes hand|Level 4/);
    expect(
      context.entities
        .flatMap((e) => e.memories)
        .map((m) => m.text)
        .join(" "),
    ).not.toMatch(/completes hand|Level 4/);
  });

  it("upgrades schema five while keeping its current quests, speech and custody", () => {
    const old = continuing();
    old.schema = 5;
    delete old.locations;
    for (const actor of Object.values(old.actors)) delete actor.trust;
    for (const memory of Object.values(old.memories)) delete memory.landmarks;
    const restored = decodeSave(JSON.stringify(old));
    expect(restored.schema).toBe(6);
    expect(programFor(restored, "vale")).toEqual(programFor(old, "vale"));
    expect(restored.items).toEqual(old.items);
    expect(restored.log).toEqual(old.log);
    expect(decodeSave(encodeSave(restored))).toEqual(restored);
  });

  it("rejects broken item conditions, effects and lasting memories", () => {
    for (const mutate of [
      (s) => {
        s.actors.vale.progress.current.steps = [hand(condition("lit", "oil"))];
      },
      (s) => {
        s.actors.vale.progress.current.steps = [
          hand(condition("heldBy", "lamp", { avatar: "absent" })),
        ];
      },
      (s) => {
        s.actors.vale.progress.current.steps = [
          {
            ...hand(hold("lamp")),
            consequence: { kind: "trust", avatar: "vale" },
          },
        ];
      },
      (s) => {
        s.memories.vale.landmarks = [
          { seq: 1, turn: 1000, kind: "event", text: "Later" },
        ];
      },
      (s) => {
        s.actors.moth.trust.vale = 4;
      },
    ]) {
      const s = continuing();
      mutate(s);
      expect(() => decodeSave(JSON.stringify(s))).toThrow();
    }
  });
});
