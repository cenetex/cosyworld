import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it, vi } from "vitest";
import { createWorld, play, questPreviews } from "../v2/card-game/world.mjs";
import { newWant } from "../v2/card-game/want.mjs";
import { settleArcana } from "../v2/card-game/world/arcana.mjs";
import { levelCard, questCards, questCaption, questPreviewCard } from "../v2/card-game/quest-card.mjs";

function pending() {
  const world = createWorld({ seed: 17 });
  world.actors.vale.pendingQuests = [{ ...newWant("item", "oil", 0), from: "quest:box:greek-gate" }];
  return world;
}
it("previews a remote old goal without adding a hand card and hides unknown names", () => {
  const world = pending(), before = JSON.stringify(world);
  const preview = questPreviews(world).find((q) => q.kind === "pending");
  expect(preview.source).toBe("vale");
  const card = questPreviewCard(world, preview);
  expect(card).toMatchObject({ actor: "vale", kind: "item", target: "oil", index: -1 });
  expect(questCaption(card, false, null, () => false)).not.toMatch(/Oil/u);
  expect(questCards(world)).toEqual([]);
  expect(JSON.stringify(world)).toBe(before);
  const next = play(world, preview.action, world.revision).state;
  expect(questCards(next)).toHaveLength(1);
});
it("keeps an unaccepted level tracker in previews until explicit Accept", () => {
  const world = settleArcana(createWorld({ seed: 17 }), "vale");
  const preview = questPreviews(world).find((q) => q.kind === "level");
  const before = structuredClone(world.actors.vale.arcana);
  expect(levelCard(world)).toBeNull();
  expect(questPreviewCard(world, preview)).toMatchObject({ kind: "arcanum", target: before.dealt });
  expect(world.actors.vale.arcana).toEqual(before);
  const next = play(world, preview.action, world.revision).state;
  expect(levelCard(next)).toMatchObject({ target: before.dealt });
});
it("commits local Accept quietly and rejects a stale second click", () => {
  const app = readFileSync(new URL("../v2/card-game/app.mjs", import.meta.url), "utf8");
  const body = (name) => {
    const at = app.indexOf(`function ${name}(`);
    return app.slice(at, app.indexOf("\n}", at) + 2);
  };
  const world = pending(), before = structuredClone(world);
  const action = questPreviews(world).find((q) => q.kind === "pending").action;
  const context = {
    world, play, selectionBlocked: () => false, lastPlayAt: -Infinity, SETTLE_MS: 400,
    performance: { now: () => 1000 }, sharedSession: null, saveBlocked: false,
    saveCodec: {}, attemptPlay: (fn) => fn(), save: vi.fn(), render: vi.fn(),
    playQueue: { clear: vi.fn(), submit: vi.fn() },
    narrator: { invalidate: vi.fn(), changed: vi.fn() },
    exchange: { cancel: vi.fn() }, reveal: { finish: vi.fn() },
    speechSounds: { stop: vi.fn() }, notice: vi.fn(), count: vi.fn(),
    shownSceneLine: { text: "Keep this line." },
  };
  vm.createContext(context);
  vm.runInContext([body("commitAction"), body("performAction")].join("\n"), context);
  context.commitAction(action, before.revision);
  expect(context.world.turn).toBe(before.turn);
  expect(context.world.items).toEqual(before.items);
  expect(context.shownSceneLine.text).toBe("Keep this line.");
  expect(context.save).toHaveBeenCalledOnce();
  for (const fn of [context.playQueue.submit, context.narrator.changed, context.narrator.invalidate,
    context.reveal.finish, context.speechSounds.stop, context.exchange.cancel]) expect(fn).not.toHaveBeenCalled();
  const accepted = JSON.stringify(context.world);
  context.commitAction(action, before.revision);
  expect(JSON.stringify(context.world)).toBe(accepted);
  expect(context.notice).toHaveBeenCalled();
});
