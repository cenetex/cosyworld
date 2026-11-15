import { expect, it } from "vitest";
import { createWorld, decodeSave, encodeSave, legalActions, play, questPreviews } from "../v2/card-game/world.mjs";
import { heldOf, holdQuest, newWant, slotsUsed } from "../v2/card-game/want.mjs";
import { neverBack } from "../v2/card-game/pack-registry.mjs";
import { levelCards } from "../v2/card-game/quest-card.mjs";
import { sells } from "../v2/card-game/world/arcana.mjs";

const sale = () => {
  const s = createWorld({ seed: 5 });
  s.actors.vale.place = s.actors.listener.place;
  s.actors.vale.upgrades = ["arcanum-0", "arcanum-12"];
  s.actors.vale.arcana = { proved: ["arcanum-0"], did: [], level: 1, sale: true };
  s.items.bell.holder = "vale";
  return s;
};
const apply = (s, pick) => {
  const action = legalActions(s).find(pick);
  expect(action).toBeTruthy();
  const result = play(s, action);
  expect(result.ok, result.error).toBe(true);
  return result.state;
};
const pay = (s) => apply(s, (a) => a.kind === "give" && a.item === "bell" && a.target === "listener");

it("pays a normal turn for pending spread offers without evicting three accepted goals", () => {
  const s = sale();
  for (const target of ["attic", "station", "forest-cottage"])
    holdQuest(s, "vale", { ...newWant("place", target, s.turn), accepted: true }, `quest:box:${target}`);
  const held = structuredClone(heldOf(s.actors.vale));
  const give = legalActions(s).find((a) => a.kind === "give" && a.item === "bell" && a.target === "listener");
  expect(give.offer).toBeUndefined();
  let next = pay(s);
  expect(next.turn).toBe(s.turn + 1);
  expect(neverBack(next, "bell")).toBe(true);
  expect(next.log.findLast((e) => e.verb === "give")).toMatchObject({ gone: ["bell"] });
  expect(heldOf(next.actors.vale)).toEqual(held);
  expect(next.actors.vale.arcana.proved).toEqual(s.actors.vale.arcana.proved);
  expect(next.actors.vale.upgrades).toEqual(s.actors.vale.upgrades);
  expect(levelCards(next)).toEqual([]);
  expect(slotsUsed(next.actors.vale)).toBe(3);
  expect(questPreviews(next).filter((q) => q.kind === "level").every((q) => !q.action)).toBe(true);
  next = apply(next, (a) => a.kind === "drop" && a.quest === 0 && !a.item);
  const before = structuredClone(next), preview = questPreviews(next).find((q) => q.kind === "level");
  next = play(next, preview.action).state;
  expect(next.turn).toBe(before.turn);
  expect(next.revision).toBe(before.revision + 1);
  expect(next.items).toEqual(before.items);
  expect(next.actors.vale.arcana.spread[preview.tarot]).toEqual({
    ...before.actors.vale.arcana.spread[preview.tarot], accepted: true,
  });
  expect(levelCards(next)).toHaveLength(1);
  expect(slotsUsed(next.actors.vale)).toBe(3);
  expect(sells({ ...next, actors: { ...next.actors,
    vale: { ...next.actors.vale, arcana: { ...next.actors.vale.arcana, sale: true } } } }, "vale")).toBe(false);
  expect(decodeSave(encodeSave(next))).toEqual(next);
});

it("preserves nine old goals and exact unaccepted spread progress through migration", () => {
  const old = sale();
  const goals = Object.keys(old.items).slice(0, 9).map((target) => ({
    ...newWant("item", target, old.turn), from: `quest:box:${target}`,
  }));
  old.actors.vale.want = goals[0];
  old.actors.vale.under = goals.slice(1);
  delete old.actors.vale.pendingQuests;
  old.actors.vale.arcana = { proved: ["arcanum-0"], did: ["old-proof"], level: 1,
    spread: [{ card: "arcanum-1", face: "up", base: { opened: 0 } }], need: ["arcanum-1"] };
  const record = structuredClone(old.actors.vale.arcana);
  const loaded = decodeSave(JSON.stringify(old));
  expect(loaded.actors.vale.pendingQuests).toEqual(goals);
  expect(heldOf(loaded.actors.vale)).toEqual([]);
  expect(loaded.actors.vale.arcana).toEqual({ ...record, dreamed: 1 });
  expect(levelCards(loaded)).toEqual([]);
  expect(slotsUsed(loaded.actors.vale)).toBe(0);
  expect(decodeSave(encodeSave(loaded))).toEqual(loaded);
});
