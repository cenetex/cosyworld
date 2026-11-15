import { expect, it } from "vitest";
import {
  createWorld, decodeSave, encodeSave, legalActions, play, questPreviews,
} from "../v2/card-game/world.mjs";
import { heldOf, newWant } from "../v2/card-game/want.mjs";
import { levelAccepted, settleArcana } from "../v2/card-game/world/arcana.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";

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
  expect(loaded.actors.vale.gaveUp).toBeUndefined();
  expect(decodeSave(encodeSave(loaded))).toEqual(loaded);
  const next = accept(loaded);
  expect(next.actors.vale.want).toEqual({ ...saved.actors.vale.want, accepted: true });
  expect(next.actors.vale.pendingQuests).toEqual(saved.actors.vale.under);
  expect(next.turn).toBe(loaded.turn);
  expect(next.revision).toBe(loaded.revision + 1);
});

it("does not accept nearby source quests on arrival or Wait", () => {
  let s = createWorld({ seed: 17 });
  s.actors.vale.place = "greek-harbor";
  expect(questPreviews(s).some((q) => q.kind === "box")).toBe(true);
  s = wait(s);
  expect(heldOf(s.actors.vale)).toEqual([]);
  expect(questPreviews(s).some((q) => q.kind === "box")).toBe(true);
});

it("revalidates stale, duplicate and full-stack acceptance atomically", () => {
  const s = createWorld({ seed: 17 });
  s.actors.vale.pendingQuests = [goal(s)];
  const action = questPreviews(s)[0].action;
  const next = accept(s);
  expect(play(next, action, s.revision).ok).toBe(false);
  expect(play(next, action, next.revision).ok).toBe(false);
  const full = structuredClone(s);
  const held = Object.keys(full.items).filter((id) => id !== "oil").slice(0, 9)
    .map((id) => newWant("item", id, full.turn));
  full.actors.vale.want = held[0];
  full.actors.vale.under = held.slice(1);
  expect(questPreviews(full).find((q) => q.kind === "pending").action).toBeNull();
  expect(play(full, action).ok).toBe(false);
  expect(full.actors.vale.pendingQuests).toEqual([goal(s)]);
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

it("accepts only the current level tracker without resetting its progress", () => {
  const s = createWorld({ seed: 17 });
  settleArcana(s, "vale");
  const before = structuredClone(s.actors.vale.arcana);
  expect(levelAccepted(s, "vale")).toBe(false);
  const next = accept(s, "level");
  expect(next.actors.vale.arcana).toEqual({ ...before, accepted: before.dealt });
  expect(levelAccepted(next, "vale")).toBe(true);
  expect(questPreviews(next).some((q) => q.kind === "level")).toBe(false);
});
