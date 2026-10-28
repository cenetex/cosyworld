import { describe, expect, it } from "vitest";
import { legacySaveFixture } from "./helpers/legacy-save-fixture.mjs";
import {
  createWorld,
  play,
  legalActions,
  plan,
  handStatus,
  carried,
  canTrade,
  encodeSave,
  decodeSave,
  validateWorld,
  willingToGive,
} from "../v2/card-game/world.mjs";
import {
  questPrograms,
  desireFor,
  programFor,
  levelOf,
} from "../v2/card-game/quests.mjs";
import { cardPlay } from "../v2/card-game/cards.mjs";
import { sceneScript } from "../v2/card-game/scene.mjs";
function cards(s, ...ids) {
  const action = cardPlay(s, ids).action;
  expect(action, ids.join(" + ")).toBeTruthy();
  const result = play(s, action);
  expect(result.ok).toBe(true);
  return result.state;
}
// Playing the place Vale stands in waits a turn.
const wait = (s) => cards(s, s.actors.vale.place);
const firstProgram = [
  ["lamp"],
  ["bell"],
  ["bell", "oil"],
  ["lamp"],
  ["pond"],
  ["attic"],
  ["pond"],
  ["lamp", "cloth"],
];
const secondProgram = [
  ["cloth", "bell"],
  ["oil", "lamp"],
  ["station"],
  ["station"],
  ["station"],
];
const playRoute = (s, route) =>
  route.reduce((world, hand) => cards(world, ...hand), s);

describe("target hands and quest programs", () => {
  it("checks possession, place and every companion together", () => {
    const s = createWorld(),
      target = {
        items: ["lamp", "bell"],
        location: "pond",
        avatars: ["moth", "keeper"],
      };
    s.items.lamp.holder = "vale";
    s.items.bell.holder = "vale";
    expect(handStatus(s, "vale", target).met).toBe(false);
    s.actors.vale.place = "pond";
    s.actors.keeper.place = "attic";
    expect(handStatus(s, "vale", target).met).toBe(false);
    s.actors.keeper.place = "pond";
    expect(handStatus(s, "vale", target).met).toBe(true);
    s.items.lamp.holder = "pond";
    expect(handStatus(s, "vale", target).met).toBe(false);
    s.items.lamp.holder = "moth";
    expect(handStatus(s, "vale", target).met).toBe(false);
  });
  it("allows extra items, attached items and open parts of a hand", () => {
    const s = createWorld();
    s.items.lamp.holder = "vale";
    s.items.cloth.holder = "lamp";
    s.items.bell.holder = "vale";
    expect(
      handStatus(s, "vale", {
        items: ["lamp", "cloth"],
        location: null,
        avatars: [],
      }).met,
    ).toBe(true);
    expect(carried(s, "vale")).toHaveLength(3);
    expect(
      handStatus(s, "vale", { items: [], location: null, avatars: ["keeper"] })
        .met,
    ).toBe(false);
  });
  it("keeps previews and planning free", () => {
    const s = createWorld(),
      before = encodeSave(s);
    for (let i = 0; i < 10; i++) {
      handStatus(s, "vale");
      desireFor(s, "moth");
      plan(s, "keeper");
      cardPlay(s, ["lamp"]);
    }
    expect(encodeSave(s)).toBe(before);
    expect(s.actors.vale.progress).toEqual({ program: 0, step: 0, marks: [] });
  });
  it("completes ordered hands and earns a level only for the whole program", () => {
    let s = createWorld();
    s = playRoute(s, firstProgram.slice(0, 6));
    expect(levelOf(s, "vale")).toBe(1);
    expect(s.actors.vale.progress.step).toBe(2);
    expect(s.actors.vale.progress.marks).toEqual([1, 6]);
    s = playRoute(s, firstProgram.slice(6));
    expect(levelOf(s, "vale")).toBe(2);
    expect(programFor(s, "vale").id).toBe("the-bell-below");
    expect(s.actors.vale.progress.marks).toEqual([1, 6, 8]);
    expect(desireFor(s, "moth")).toEqual({
      items: ["oil"],
      location: "attic",
      avatars: ["keeper"],
    });
  });
  it("credits a hand before the cast leaves and advances one step per turn", () => {
    let s = playRoute(createWorld(), firstProgram);
    // The keeper leaves for the attic after receiving the cloth.
    s = cards(s, "cloth", "bell");
    expect(s.actors.keeper.place).toBe("attic");
    expect(s.actors.vale.progress.step).toBe(1);
    expect(s.actors.vale.progress.marks).toEqual([1, 6, 8, 9]);
    expect(levelOf(s, "vale")).toBe(2);
    const receipt = s.log.findLast(
      (e) => e.kind === "quest" && e.actorId === "vale",
    );
    expect(receipt.fulfillment).toMatchObject({
      location: "pond",
      items: expect.arrayContaining(["bell"]),
      avatars: expect.arrayContaining(["keeper"]),
    });
    expect(
      sceneScript(s).beats.findLast((e) => e.quest && e.actorId === "vale")
        .quest.hand,
    ).toEqual(receipt.fulfillment);
  });
  it("records a ready hand when the next play leaves its place", () => {
    let s = createWorld();
    s.items.lamp.holder = "vale";
    s.actors.moth.place = "station";
    s = cards(s, "pond");
    expect(s.actors.vale.progress).toEqual({ program: 0, step: 1, marks: [1] });
    expect(
      s.log.find((e) => e.kind === "quest" && e.actorId === "vale").fulfillment
        .location,
    ).toBe("station");
  });
  it("keeps later hands pending until their program step is active", () => {
    let s = createWorld();
    s.actors.vale.place = "attic";
    s.items.oil.holder = "vale";
    s = cards(s, "attic");
    expect(s.actors.vale.progress.step).toBe(0);
    expect(s.actors.vale.progress.marks).toEqual([]);
  });
  it("lets all three avatars finish two programs through card trades and gifts", () => {
    let s = playRoute(createWorld(), [...firstProgram, ...secondProgram]);
    expect(levelOf(s, "vale")).toBe(3);
    expect(levelOf(s, "moth")).toBe(2);
    expect(levelOf(s, "keeper")).toBe(2);
    s = playRoute(s, [
      ["bell", "keeper"],
      ["pond"],
      ["pond"],
      ["lamp", "oil"],
      ["oil", "keeper"],
    ]);
    for (const actor of ["vale", "moth", "keeper"]) {
      expect(levelOf(s, actor)).toBe(3);
      expect(programFor(s, actor).generated.level).toBe(3);
    }
    const restored = decodeSave(encodeSave(s));
    expect(restored).toEqual(s);
    expect(wait(restored)).toEqual(wait(s));
  });
  it("moves the cast toward its target items and place while Vale waits", () => {
    let s = createWorld();
    for (let i = 0; i < 5; i++) s = wait(s);
    expect(s.items.lamp.holder).toBe("moth");
    expect(s.actors.moth.place).toBe("pond");
    expect(s.items.bell.holder).toBe("keeper");
    expect(s.actors.keeper.place).toBe("attic");
    expect(s.actors.moth.progress.step).toBe(0);
    expect(s.actors.keeper.progress.step).toBe(0);
  });
  it("releases earlier target items after a desire changes", () => {
    let s = playRoute(createWorld(), firstProgram);
    expect(desireFor(s, "keeper").items).toEqual(["cloth"]);
    expect(canTrade(s, "vale", "cloth", "bell")).toBe(true);
    expect(canTrade(s, "vale", "oil", "lamp")).toBe(true);
    expect(willingToGive(s, "moth", "lamp")).toBe(false);
    s = cards(s, "cloth", "bell");
    expect(s.items.bell.holder).toBe("vale");
  });
  it("has bounded authored programs made from valid entity hands", () => {
    for (const [actor, programs] of Object.entries(questPrograms)) {
      expect(new Set(programs.map((p) => p.id)).size).toBe(programs.length);
      for (const p of programs)
        for (const h of p.steps) {
          expect(new Set(h.items).size).toBe(h.items.length);
          expect(h.items.length).toBeLessThanOrEqual(3);
          for (const id of h.items)
            expect(Object.keys(createWorld().items)).toContain(id);
          expect(["station", "attic", "pond", null]).toContain(h.location);
          expect(h.avatars).not.toContain(actor);
          for (const id of h.avatars)
            expect(Object.keys(createWorld().actors)).toContain(id);
        }
    }
  });
});

describe("card trade rules", () => {
  it("exchanges both item holders and records both sides in one turn", () => {
    let s = playRoute(createWorld(), firstProgram.slice(0, 2));
    const before = encodeSave(s),
      offer = cardPlay(s, ["bell", "oil"]).action;
    expect(offer).toMatchObject({
      kind: "trade",
      item: "bell",
      receive: "oil",
      target: "keeper",
    });
    expect(cardPlay(s, ["oil", "bell"]).action).toEqual(offer);
    const next = play(s, offer).state;
    expect(next.turn).toBe(s.turn + 1);
    expect(next.items.bell.holder).toBe("keeper");
    expect(next.items.oil.holder).toBe("vale");
    expect(encodeSave(s)).toBe(before);
    expect(
      sceneScript(next).beats.find((e) => e.verb === "trade"),
    ).toMatchObject({ itemId: "bell", receiveId: "oil", targetId: "keeper" });
  });
  it("keeps current target items and accepts useful exchanges", () => {
    const s = createWorld();
    s.actors.moth.place = "station";
    s.items.lamp.holder = "moth";
    s.items.bell.holder = "vale";
    expect(canTrade(s, "vale", "bell", "lamp")).toBe(false);
    expect(willingToGive(s, "moth", "lamp")).toBe(false);
    s.items.lamp.holder = "vale";
    expect(canTrade(s, "vale", "lamp", "cloth")).toBe(true);
  });
  it("swaps attached bundles as a whole and measures space after the swap", () => {
    let s = createWorld();
    s.actors.keeper.place = "station";
    s.items.bell.holder = "vale";
    s.items.lamp.holder = "vale";
    s.items.cloth.holder = "bell";
    expect(carried(s, "vale")).toHaveLength(3);
    expect(canTrade(s, "vale", "bell", "oil")).toBe(true);
    s = cards(s, "bell", "oil");
    expect(s.items.cloth.holder).toBe("bell");
    expect(carried(s, "keeper")).toEqual(["bell", "cloth"]);
    expect(carried(s, "vale")).toEqual(["lamp", "oil"]);
  });
  it("requires local direct custody and protects player choice during cast turns", () => {
    const s = createWorld();
    s.items.lamp.holder = "vale";
    expect(canTrade(s, "vale", "lamp", "cloth")).toBe(false);
    s.actors.moth.place = "station";
    expect(
      legalActions(s, "moth").some(
        (a) => a.kind === "trade" && a.target === "vale",
      ),
    ).toBe(false);
    const next = wait(s);
    expect(next.items.lamp.holder).toBe("vale");
    expect(next.log.some((e) => e.actorId === "moth" && e.verb === "ask")).toBe(
      true,
    );
  });
  it("lets two cast members make a mutually useful trade", () => {
    let s = createWorld();
    s.actors.moth.place = "station";
    s.actors.keeper.place = "station";
    s.items.lamp.holder = "keeper";
    s.items.bell.holder = "moth";
    expect(plan(s, "moth").action).toMatchObject({
      kind: "trade",
      item: "bell",
      receive: "lamp",
      target: "keeper",
    });
    s = wait(s);
    expect(s.items.lamp.holder).toBe("moth");
    expect(s.items.bell.holder).toBe("keeper");
  });
  it("seeks a desired cover through the object its owner holds", () => {
    const s = createWorld();
    s.turn = 4;
    s.revision = 4;
    s.actors.moth.progress = { program: 1, step: 0, marks: [1, 2] };
    s.actors.keeper.progress = { program: 1, step: 1, marks: [1, 2, 3] };
    s.actors.moth.place = "station";
    s.actors.keeper.place = "station";
    s.items.bell.holder = "keeper";
    s.items.cloth.holder = "bell";
    s.items.oil.holder = "moth";
    expect(() => validateWorld(s)).not.toThrow();
    expect(plan(s, "moth").action).toMatchObject({
      kind: "trade",
      item: "oil",
      receive: "bell",
      target: "keeper",
    });
    expect(cardPlay(s, ["cloth"]).hint).toContain("Bell");
  });
  it("uses the cloth on the ringing bell when several objects can be covered", () => {
    const s = createWorld();
    s.turn = 1;
    s.revision = 1;
    s.actors.keeper.progress = { program: 0, step: 1, marks: [1] };
    for (const id of ["lamp", "bell", "cloth"]) s.items[id].holder = "keeper";
    s.items.bell.ringing = 2;
    s.items.oil.holder = "station";
    expect(() => validateWorld(s)).not.toThrow();
    expect(plan(s, "keeper").action).toMatchObject({
      kind: "cover",
      item: "cloth",
      target: "bell",
    });
  });
  it("rechecks offers against current custody and ignores forged payload fields", () => {
    let s = playRoute(createWorld(), firstProgram.slice(0, 2));
    const offer = cardPlay(s, ["bell", "oil"]).action;
    expect(play(s, offer, s.revision + 1).ok).toBe(false);
    const canonical = play(s, { ...offer, receive: "cloth", target: "moth" });
    expect(canonical.ok).toBe(true);
    expect(canonical.state.items.oil.holder).toBe("vale");
    expect(canonical.state.items.cloth.holder).toBe("moth");
    s.items.oil.holder = "attic";
    expect(play(s, offer).ok).toBe(false);
    expect(s.items.bell.holder).toBe("vale");
  });
});

describe("quest saves and scene records", () => {
  it("restores the exact next trade, cast choices and quest award", () => {
    const s = playRoute(createWorld(), firstProgram.slice(0, -1)),
      restored = decodeSave(encodeSave(s));
    expect(restored).toEqual(s);
    expect(cards(restored, "lamp", "cloth")).toEqual(cards(s, "lamp", "cloth"));
    const done = cards(restored, "lamp", "cloth"),
      script = sceneScript(done);
    expect(script.current.avatars.find((a) => a.id === "vale")).toMatchObject({
      level: 2,
      programId: "the-bell-below",
    });
    expect(
      script.beats.find((e) => e.quest?.level === 2)?.quest.programId,
    ).toBe("borrowed-light");
  });
  it("migrates earlier saves while preserving items, positions and history", () => {
    const legacy = legacySaveFixture(createWorld(), 1);
    legacy.turn = 5;
    legacy.revision = 7;
    for (const [id, a] of Object.entries(legacy.actors)) {
      delete a.progress;
      a.aim = id === "vale" ? "free" : id === "moth" ? "moth" : "quiet";
    }
    legacy.items.lamp.holder = "vale";
    legacy.actors.vale.place = "pond";
    const restored = decodeSave(JSON.stringify(legacy));
    expect(restored.schema).toBe(7);
    expect(restored.items).toEqual(legacy.items);
    expect(restored.log).toEqual(legacy.log);
    expect(restored.actors.vale.place).toBe("pond");
    expect(levelOf(restored, "vale")).toBe(1);
    expect(restored.actors.vale.progress).toEqual({
      program: 0,
      step: 0,
      marks: [],
    });
    expect(decodeSave(encodeSave(restored))).toEqual(restored);
  });
  it("validates program bounds, ordered evidence and quest events", () => {
    const completed = playRoute(createWorld(), firstProgram);
    for (const progress of [
      { program: 3, step: 0, marks: [] },
      { program: 0, step: 99, marks: [] },
      { program: 1, step: 0, marks: [] },
      { program: 1, step: 0, marks: [1, 1, 7] },
      { program: 1, step: 0, marks: [1, 6, 9] },
      { program: 0, step: 1, marks: [0] },
    ]) {
      const s = structuredClone(completed);
      s.actors.vale.progress = progress;
      expect(() => validateWorld(s)).toThrow();
    }
    for (const patch of [
      { programId: "unknown" },
      { step: 99 },
      { level: 99 },
      { actorId: "missing" },
    ]) {
      const s = structuredClone(completed),
        e = s.log.find((e) => e.kind === "quest");
      Object.assign(e, patch);
      expect(() => decodeSave(JSON.stringify(s))).toThrow();
    }
  });
});
