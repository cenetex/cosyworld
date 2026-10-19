import { describe, it, expect } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  play,
  plan,
  legalActions,
  handStatus,
  rootHolder,
  places,
  things,
} from "../v2/card-game/world.mjs";
import {
  hand,
  hold,
  at,
  withAvatars,
  sequence,
  either,
  alternatives,
  meet,
  carryTo,
  generateProgram,
  programFor,
  desireFor,
  targetsFor,
  levelOf,
} from "../v2/card-game/quests.mjs";
import { sceneScript } from "../v2/card-game/scene.mjs";

function completedSave() {
  const s = createWorld();
  s.schema = 2;
  s.turn = 8;
  s.revision = 8;
  for (const [id, a] of Object.entries(s.actors).filter(
    ([id]) => id !== "badger",
  )) {
    a.progress = {
      program: 2,
      step: 0,
      marks: Array.from({ length: id === "vale" ? 5 : 4 }, (_, i) => i + 1),
    };
    a.place = "station";
  }
  s.items.lamp.holder = "moth";
  s.items.cloth.holder = "keeper";
  s.items.oil.holder = "vale";
  s.items.bell.holder = "vale";
  return s;
}
const continuing = () => decodeSave(JSON.stringify(completedSave()));
const wait = (s) => play(s, legalActions(s)[0]).state;

describe("composable quest programs", () => {
  it("combines hand parts and nested reusable sequences without sharing mutable data", () => {
    const held = hold("lamp", "bell", "lamp");
    const together = hand(
      held,
      at("pond"),
      withAvatars("moth"),
      withAvatars("moth", "keeper"),
    );
    expect(together).toEqual({
      items: ["lamp", "bell"],
      location: "pond",
      avatars: ["moth", "keeper"],
    });
    expect(() => hand(at("pond"), at("attic"))).toThrow();
    const fragment = {
      steps: sequence(
        together,
        either(carryTo(["lamp"], "attic"), carryTo(["lamp"], "station")),
      ),
    };
    const composed = sequence(fragment, [sequence(hand(hold("oil")))]);
    expect(composed).toHaveLength(3);
    together.items.push("oil");
    held.items.push("cloth");
    expect(composed[0].items).toEqual(["lamp", "bell"]);
    expect(alternatives(composed[1])).toHaveLength(2);
    expect(() => either()).toThrow();
  });
  it("accepts either hand and records the actual choice once, in order", () => {
    let s = continuing();
    s.actors.vale.progress.current.steps = sequence(
      either(hand(hold("lamp"), at("pond")), hand(hold("oil"), at("station"))),
      hand(hold("oil"), at("station")),
    );
    const saved = encodeSave(s);
    expect(targetsFor(s, "vale")).toHaveLength(2);
    expect(desireFor(s, "vale").items).toEqual(["oil"]);
    expect(encodeSave(s)).toBe(saved);
    s = wait(s);
    expect(s.actors.vale.progress.step).toBe(1);
    expect(levelOf(s, "vale")).toBe(3);
    const receipt = s.log.findLast(
      (e) => e.kind === "quest" && e.actorId === "vale",
    );
    expect(receipt.target.items).toEqual(["oil"]);
    expect(
      sceneScript(s).beats.findLast((e) => e.quest && e.actorId === "vale")
        .quest.target,
    ).toEqual(receipt.target);
    s = wait(s);
    expect(levelOf(s, "vale")).toBe(4);
    expect(programFor(s, "vale").id).toBe("generated-vale-4");
  });
  it("uses reachable places, real holders and current spare items deterministically", () => {
    const s = continuing(),
      before = encodeSave(s);
    for (const actor of ["vale", "moth", "keeper"]) {
      const p = generateProgram(s, actor, places, things);
      expect(p).toEqual(generateProgram(s, actor, places, things));
      expect(p.generated.owner).toBe(rootHolder(s, p.generated.item));
      for (const step of p.steps)
        for (const h of alternatives(step)) {
          expect(h.items.every((id) => s.items[id])).toBe(true);
          expect(h.avatars.every((id) => s.actors[id] && id !== actor)).toBe(
            true,
          );
          expect(h.location === null || places[h.location]).toBeTruthy();
        }
      expect(
        p.steps.every((step) =>
          alternatives(step).some((h) => handStatus(s, actor, h).met),
        ),
      ).toBe(false);
    }
    expect(encodeSave(s)).toBe(before);
    const first = generateProgram(s, "vale", places, things);
    s.items[first.generated.item].holder = "pond";
    const changed = generateProgram(s, "vale", places, things);
    expect(changed).not.toEqual(first);
  });
  it("makes meeting choices from reachable places and counts a covered item once", () => {
    const s = continuing();
    s.items.cloth.holder = "lamp";
    const isolated = {
      station: { exits: [] },
      attic: { exits: [] },
      pond: { exits: [] },
    };
    const p = generateProgram(s, "vale", isolated, things);
    for (const step of p.steps)
      for (const h of alternatives(step))
        expect([null, "station"]).toContain(h.location);
    expect(p.generated.item).not.toBe("cloth");
    expect(
      alternatives(meet(["lamp"], "moth", ["station", "pond"])),
    ).toHaveLength(2);
  });
  it("seeks a payment item and trades it through the shared cast rules", () => {
    let s = continuing();
    s.actors.keeper.progress = { program: 0, step: 0, marks: [] };
    s.items.bell.holder = "station";
    s.actors.moth.progress.current.steps = sequence(
      hand(hold("cloth")),
      carryTo(["cloth"], "pond"),
    );
    expect(plan(s, "moth").action).toMatchObject({
      kind: "take",
      item: "bell",
    });
    s = wait(s);
    expect(
      s.log.some(
        (e) =>
          e.turn === s.turn && e.verb === "trade" && e.actorId === "keeper",
      ),
    ).toBe(true);
    expect(s.items.cloth.holder).toBe("moth");
    expect(s.items.bell.holder).toBe("keeper");
    expect(s.items.oil.holder).toBe("vale");
  });
  it("revises a stalled cast suffix while preserving earned steps and the player's program", () => {
    let s = continuing();
    s.turn = 16;
    s.revision = 16;
    s.items.lamp.holder = "vale";
    s.items.bell.holder = "station";
    const p = s.actors.moth.progress;
    p.step = 1;
    p.marks.push(5);
    p.current.generated.turn = 0;
    p.current.steps = sequence(
      hand(hold("cloth")),
      hand(hold("lamp"), at("attic")),
    );
    s.actors.vale.progress.current.steps = sequence(
      hand(hold("cloth"), at("pond")),
      hand(hold("cloth"), at("attic")),
    );
    const prefix = structuredClone(p.current.steps[0]),
      marks = [...p.marks],
      player = structuredClone(programFor(s, "vale"));
    s = wait(s);
    expect(levelOf(s, "moth")).toBe(3);
    expect(s.actors.moth.progress.step).toBe(1);
    expect(s.actors.moth.progress.marks).toEqual(marks);
    expect(programFor(s, "moth").steps[0]).toEqual(prefix);
    expect(programFor(s, "moth").generated.turn).toBe(17);
    expect(
      targetsFor(s, "moth").some((h) => handStatus(s, "moth", h).met),
    ).toBe(false);
    expect(programFor(s, "vale")).toEqual(player);
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });
  it("keeps leveling through varied plays and trades with exact restores and bounded saves", () => {
    let s = continuing(),
      trades = 0;
    const ids = new Set();
    const verbs = new Set(),
      situations = new Set();
    for (let turn = 0; turn < 360; turn++) {
      const action = plan(s).action;
      if (turn % 30 === 0) {
        const restored = decodeSave(encodeSave(s));
        expect(play(restored, action)).toEqual(play(s, action));
      }
      s = play(s, action).state;
      trades += s.log.filter(
        (e) => e.turn === s.turn && e.verb === "trade",
      ).length;
      for (const entry of s.log.filter((e) => e.turn === s.turn && e.verb))
        verbs.add(entry.verb);
      for (const actor of ["vale", "moth", "keeper"]) {
        ids.add(programFor(s, actor).id);
        situations.add(programFor(s, actor).generated?.situation || "bargain");
      }
    }
    expect(trades).toBeGreaterThan(1);
    for (const verb of ["trade", "give", "ring", "refill", "cover", "move"])
      expect(verbs.has(verb)).toBe(true);
    expect(situations.size).toBeGreaterThanOrEqual(4);
    expect(ids.size).toBeGreaterThan(20);
    for (const actor of ["vale", "moth", "keeper"]) {
      expect(levelOf(s, actor)).toBeGreaterThan(10);
      expect(s.actors[actor].progress.marks.length).toBeLessThanOrEqual(32);
      expect(s.actors[actor].progress.recent.length).toBeLessThanOrEqual(4);
      expect(programFor(s, actor).steps.length).toBeLessThanOrEqual(12);
    }
    expect(s.log.length).toBeLessThanOrEqual(100);
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });
  it("keeps the cast trading and leveling while Vale keeps items and waits", () => {
    let s = continuing(),
      trades = 0;
    for (let turn = 0; turn < 300; turn++) {
      s = wait(s);
      trades += s.log.filter(
        (e) => e.turn === s.turn && e.verb === "trade",
      ).length;
      expect(s.items.oil.holder).toBe("vale");
      expect(s.items.bell.holder).toBe("vale");
    }
    expect(levelOf(s, "moth")).toBeGreaterThan(10);
    expect(levelOf(s, "keeper")).toBeGreaterThan(10);
    expect(trades).toBeGreaterThan(10);
    expect(levelOf(s, "vale")).toBe(3);
  });
  it("preserves completed schema-two saves and resumes them at the earned level", () => {
    const old = completedSave(),
      s = decodeSave(JSON.stringify(old));
    expect(s.items).toEqual(old.items);
    expect(s.log).toEqual(old.log);
    for (const actor of ["vale", "moth", "keeper"]) {
      expect(levelOf(s, actor)).toBe(3);
      expect(s.actors[actor].progress.marks).toEqual(
        old.actors[actor].progress.marks,
      );
      expect(programFor(s, actor).generated.turn).toBe(old.turn);
    }
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });
  it("rejects broken program parts, evidence, counters and generated references", () => {
    for (const mutate of [
      (s) => (s.actors.vale.progress.current.steps = [{ any: [] }]),
      (s) => (s.actors.vale.progress.current.steps = [hand(hold("missing"))]),
      (s) => (s.actors.vale.progress.current.steps = [hand(at("missing"))]),
      (s) =>
        (s.actors.vale.progress.current.steps = [hand(withAvatars("vale"))]),
      (s) => (s.actors.vale.progress.current.generated.level = 99),
      (s) => (s.actors.vale.progress.current.generated.owner = "missing"),
      (s) => (s.actors.vale.progress.completedHands = 999),
      (s) => (s.actors.vale.progress.marks = []),
    ]) {
      const s = continuing();
      mutate(s);
      expect(() => decodeSave(JSON.stringify(s))).toThrow();
    }
  });
});
