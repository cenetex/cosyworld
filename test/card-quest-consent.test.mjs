import { expect, it } from "vitest";
import {
  createWorld, decodeSave, encodeSave, fillSeatWants, holdChoice, legalActions, play, questPreviews,
} from "../v2/card-game/world.mjs";
import { boxIdOpen } from "../v2/card-game/world/boxes.mjs";
import { heldOf, newWant } from "../v2/card-game/want.mjs";
import { levelAccepted } from "../v2/card-game/world/arcana.mjs";
import { dispatchShared, load } from "../v2/card-game/shared-world.mjs";
import { speechOccasions } from "../v2/card-game/speech-occasions.mjs";
import { dialogueCast } from "../v2/card-game/scene-cast.mjs";
import { reflectionContext } from "../v2/card-game/reflections.mjs";

const pendingTarot = (s) => {
  s.actors.vale.arcana = { proved: [], did: [], spread: [{ card: "arcanum-21", face: "up" }] };
  return s;
};
const wait = (s) => play(s, legalActions(s).find((a) => a.kind === "wait" && !a.sleep)).state;
const goal = (s, item = "oil") => ({ ...newWant("item", item, s.turn), from: "quest:box:greek-gate" });
const accept = (s, kind = "pending") => {
  const preview = questPreviews(s).find((q) => q.kind === kind);
  expect(preview?.action).toBeTruthy();
  const result = play(s, preview.action, s.revision);
  expect(result.ok, result.error).toBe(true);
  return result.state;
};

it("keeps old goals pending without changing earned world progress or closing them", () => {
  const old = createWorld({ seed: 17 });
  old.actors.vale.want = goal(old);
  old.actors.vale.under = [goal(old, "cloth")];
  delete old.actors.vale.pendingQuests;
  const saved = structuredClone(old);
  const loaded = decodeSave(JSON.stringify(old));
  expect(loaded.actors.vale.pendingQuests).toEqual(heldOf(saved.actors.vale));
  expect(heldOf(loaded.actors.vale)).toEqual([]);
  for (const field of ["items", "packs", "log", "opened", "revision", "turn"])
    expect(loaded[field]).toEqual(saved[field]);
  expect(loaded.actors.vale.closed).toEqual(saved.actors.vale.closed);
  expect(loaded.actors.vale.xp).toBe(saved.actors.vale.xp);
  expect(loaded.actors.vale.gaveUp).toBeUndefined();
  expect(decodeSave(encodeSave(loaded))).toEqual(loaded);
  const next = accept(loaded);
  expect(next.actors.vale.want).toEqual({ ...saved.actors.vale.want, accepted: true });
  expect(next.actors.vale.pendingQuests).toEqual(saved.actors.vale.under);
  expect(next.turn).toBe(loaded.turn);
  expect(next.revision).toBe(loaded.revision + 1);
});

for (const shared of [false, true]) it.each(["wait", "hold"])(
  `keeps an unmet recovered goal from an already-open box after %s (shared=${shared})`,
  (operation) => {
    const old = createWorld({ opening: true, seed: 17 });
    holdChoice(old, "vale", { item: null, revision: old.revision });
    const original = { ...newWant("item", "oil", old.turn), refusals: 2, from: "quest:box:pond" };
    old.actors.vale.want = original;
    delete old.actors.vale.pendingQuests;
    let s = decodeSave(JSON.stringify(old));
    expect(boxIdOpen(s, "pond", "vale")).toBe(true);
    s = accept(s);
    const accepted = { ...original, accepted: true };
    const closed = s.actors.vale.closed;
    const action = legalActions(s).find((a) => a.kind === "wait" && !a.sleep);
    const choice = { item: "lamp", revision: s.revision };
    if (shared) {
      const result = dispatchShared({ op: operation === "hold" ? "hold" : "play", world: s,
        actor: "vale", claimed: ["vale"], present: ["vale"], action, choice });
      expect(result.ok, result.error).toBe(true);
      s = result.world;
    } else if (operation === "hold") holdChoice(s, "vale", choice);
    else s = play(s, action).state;
    expect(boxIdOpen(s, "pond", "vale")).toBe(true);
    expect(s.actors.vale.want).toEqual(accepted);
    expect(s.actors.vale.closed).toEqual(closed);
    expect(decodeSave(encodeSave(s)).actors.vale.want).toEqual(accepted);
  },
);

it.each(["drop", "hold"])("ends a live box goal when %s opens its source without consuming pending goals", (operation) => {
  let s = createWorld({ opening: true, seed: 17 });
  const pending = { ...goal(s), from: "quest:box:pond" };
  s.actors.vale.pendingQuests = [pending];
  expect(s.actors.vale.want).toBeNull();
  s = accept(s, "box");
  expect(s.actors.vale.want).toMatchObject({ kind: "place", target: "attic",
    step: { verb: "lay", items: ["lamp"] }, from: "quest:box:pond", accepted: true });
  expect(boxIdOpen(s, "pond", "vale")).toBe(false);
  if (operation === "hold") holdChoice(s, "vale", { item: null, revision: s.revision });
  else s = play(s, legalActions(s).find((a) => a.kind === "drop" && a.item === "lamp")).state;
  expect(boxIdOpen(s, "pond", "vale")).toBe(true);
  expect(s.actors.vale.want).toBeNull();
  expect(s.actors.vale.pendingQuests).toEqual([pending]);
});

it("migrates every claimed avatar while preserving unclaimed resident wants", () => {
  const old = dispatchShared({ op: "create", seed: 17 }).world;
  old.actors.vale.want = goal(old);
  old.actors.ash.want = goal(old, "cloth");
  for (const a of Object.values(old.actors)) delete a.pendingQuests;
  const npc = structuredClone(old.actors.mara.want);
  const loaded = load({ world: old, actor: "vale", claimed: ["vale", "ash"], present: ["vale"] });
  for (const id of ["vale", "ash"]) {
    expect(loaded.actors[id].want).toBeNull();
    expect(loaded.actors[id].pendingQuests).toEqual([old.actors[id].want]);
  }
  expect(loaded.actors.mara.want).toEqual(npc);
  expect(loaded.actors.mara.pendingQuests).toBeUndefined();
});

it("rejects malformed or oversized pending saves without silently repairing quests", () => {
  const s = createWorld({ seed: 17 });
  s.actors.vale.pendingQuests = Object.keys(s.items).slice(0, 10).map((id) => goal(s, id));
  expect(() => decodeSave(JSON.stringify(s))).toThrow();
  s.actors.vale.pendingQuests = [{ ...goal(s), kind: "place", target: "missing-place" }];
  expect(() => decodeSave(JSON.stringify(s))).toThrow();
  delete s.actors.vale.pendingQuests;
  s.actors.vale.under = [goal(s)];
  expect(() => decodeSave(JSON.stringify(s))).toThrow();
});

it("does not accept nearby source quests on arrival or Wait", () => {
  let s = createWorld({ seed: 17 });
  s.actors.vale.place = "greek-harbor";
  expect(questPreviews(s).some((q) => q.kind === "box")).toBe(true);
  s = wait(s);
  expect(heldOf(s.actors.vale)).toEqual([]);
  expect(questPreviews(s).some((q) => q.kind === "box")).toBe(true);
});

it("accepts a current source using its exact saved pending goal", () => {
  const s = createWorld({ seed: 17 });
  s.actors.vale.place = "greek-harbor";
  const q = questPreviews(s).find((p) => p.kind === "box" && p.action);
  s.actors.vale.pendingQuests = [structuredClone(q.quest)];
  s.actors.vale.residentWant = structuredClone(q.quest);
  expect(questPreviews(s).filter((p) => p.kind === "pending")).toHaveLength(1);
  s.turn = s.revision = 2;
  const current = questPreviews(s).find((p) => p.source === q.source && p.action);
  expect(current.quest).toEqual(q.quest);
  const next = play(s, current.action).state;
  expect(next.actors.vale.want).toEqual({ ...q.quest, accepted: true });
  expect(next.actors.vale.pendingQuests).toEqual([]);
  expect(next.actors.vale.residentWant).toBeUndefined();
});

it("revalidates stale, duplicate and full-stack acceptance atomically", () => {
  const s = createWorld({ seed: 17 });
  pendingTarot(s);
  s.actors.vale.pendingQuests = [goal(s)];
  const action = questPreviews(s)[0].action;
  expect(play(s, { key: action.key }, s.revision).ok).toBe(true);
  const next = accept(s);
  expect(play(next, action, s.revision).ok).toBe(false);
  expect(play(next, action, next.revision).ok).toBe(false);
  const changed = accept(s, "level");
  const stale = dispatchShared({ op: "play", world: changed, actor: "vale",
    claimed: ["vale"], present: ["vale"], action });
  expect(stale.ok).toBe(false);
  expect(stale.world.actors.vale.pendingQuests).toEqual([goal(s)]);
  const full = structuredClone(s);
  const held = Object.keys(full.items).filter((id) => id !== "oil").slice(0, 3)
    .map((id) => newWant("item", id, full.turn));
  full.actors.vale.want = held[0];
  full.actors.vale.under = held.slice(1);
  expect(questPreviews(full).find((q) => q.kind === "pending").action).toBeNull();
  expect(play(full, action).ok).toBe(false);
  expect(full.actors.vale.pendingQuests).toEqual([goal(s)]);
  full.actors.vale.place = "greek-harbor";
  expect(questPreviews(full).find((q) => q.kind === "box"))
    .toMatchObject({ action: null, reason: "Finish or discard a quest first." });
});

it("preserves nine pending goals and quarantines a new resident wish on claim", () => {
  let world = dispatchShared({ op: "create", seed: 17 }).world;
  const a = world.actors.ash;
  a.pendingQuests = Object.keys(world.items).slice(0, 9).map((id) => goal(world, id));
  a.want = newWant("item", "oil", world.turn);
  const saved = structuredClone(a.pendingQuests), wish = structuredClone(a.want);
  world = dispatchShared({ op: "join", world, actor: "ash", claimed: ["vale"], present: ["vale"] }).world;
  expect(world.actors.ash.pendingQuests).toEqual(saved);
  expect(world.actors.ash.residentWant).toEqual(wish);
  expect(heldOf(world.actors.ash)).toEqual([]);
  world = dispatchShared({ op: "presence", world, actor: "vale", claimed: ["vale", "ash"], present: ["vale"] }).world;
  expect(world.actors.ash.pendingQuests).toEqual(saved);
  world.actors.ash.want = { ...goal(world, "cloth"), accepted: true };
  const accepted = structuredClone(world.actors.ash.want);
  world = dispatchShared({ op: "join", world, actor: "ash", claimed: ["vale"], present: ["vale"] }).world;
  expect(world.actors.ash.want).toEqual(accepted);
  expect(world.actors.ash.pendingQuests).toEqual(saved);
});

it("keeps a released avatar's latest autonomous wish separate from nine old goals", () => {
  let world = dispatchShared({ op: "create", seed: 17 }).world;
  world.actors.ash.pendingQuests = Object.keys(world.items).slice(0, 9).map((id) => goal(world, id));
  world = dispatchShared({ op: "join", world, actor: "ash", claimed: ["vale"], present: ["vale"] }).world;
  const pending = structuredClone(world.actors.ash.pendingQuests);
  world = load({ world, actor: "vale", claimed: ["vale"], present: ["vale"] });
  fillSeatWants(world);
  const wish = structuredClone(world.actors.ash.want);
  expect(wish).toBeTruthy();
  expect(world.actors.ash.residentWant).toBeUndefined();
  world = dispatchShared({ op: "join", world, actor: "ash", claimed: ["vale"], present: ["vale"] }).world;
  expect(world.actors.ash.want).toBeNull();
  expect(world.actors.ash.pendingQuests).toEqual(pending);
  expect(world.actors.ash.residentWant).toEqual(wish);
  const view = load({ world, actor: "ash", claimed: ["vale", "ash"], present: ["ash"] });
  const preview = questPreviews(view).find((q) => q.quest?.kind === wish.kind && q.quest?.target === wish.target);
  expect(preview).toMatchObject({ source: "ash", kind: "pending", quest: wish });
  expect(play(view, preview.action).state.actors.ash.want).toEqual({ ...wish, accepted: true });
});

it("keeps a remote obsolete resident goal visible without accepting or discarding it", () => {
  const s = createWorld({ seed: 17 });
  const old = { ...goal(s), from: "quest:from:moth", step: { verb: "give", to: "moth" } };
  s.actors.vale.pendingQuests = [old];
  s.actors.vale.place = "attic";
  const preview = questPreviews(s).find((q) => q.kind === "pending");
  expect(preview).toMatchObject({ source: "vale", quest: old, action: null,
    reason: "This person no longer asks for this." });
  expect(decodeSave(encodeSave(s)).actors.vale.pendingQuests).toEqual([old]);
});

it("accepts only the current level tracker without resetting its progress", () => {
  const s = createWorld({ seed: 17 });
  pendingTarot(s);
  const before = structuredClone(s.actors.vale.arcana);
  expect(levelAccepted(s, "vale")).toBe(false);
  const next = accept(s, "level");
  expect(next.actors.vale.arcana).toEqual({ ...before,
    spread: [{ ...before.spread[0], accepted: true }] });
  expect(levelAccepted(next, "vale")).toBe(true);
  expect(questPreviews(next).some((q) => q.kind === "level")).toBe(false);
});

it("keeps shared Accept silent after an earlier same-turn Wait", () => {
  const s = pendingTarot(wait(createWorld({ seed: 17 })));
  const action = questPreviews(s).find((p) => p.kind === "level").action;
  const result = dispatchShared({ op: "play", world: s, actor: "vale",
    claimed: ["vale"], present: ["vale"], action, revision: s.revision });
  expect(result.ok).toBe(true);
  expect(result.world.turn).toBe(s.turn);
  expect(result.world.actors.moth).toEqual(s.actors.moth);
  expect(result.world.speechVoices.vale).toEqual([]);
  expect(legalActions(result.world).some((a) => a.sleep)).toBe(true);
  expect(speechOccasions(result.world, dialogueCast(result.world)))
    .toEqual({ occasion: null, speakers: [], scenery: false });
  expect(reflectionContext(result.world).resting).toBeNull();
});
