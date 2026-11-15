import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it, vi } from "vitest";
import { createWorld, play, questPreviews } from "../v2/card-game/world.mjs";
import { newWant } from "../v2/card-game/want.mjs";
import { settleArcana } from "../v2/card-game/world/arcana.mjs";
import { levelCard, questCards, questCaption, questPreviewCard } from "../v2/card-game/quest-card.mjs";

function pending() {
  const world = createWorld({ seed: 17 });
  world.actors.vale.pendingQuests = ["oil", "cloth"].map((id) => ({
    ...newWant("item", id, 0), from: "quest:box:greek-gate",
  }));
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
    world, play, selected: ["vale"], lastWait: { key: "vale", revision: world.revision },
    selectionBlocked: () => false, lastPlayAt: -Infinity, SETTLE_MS: 400,
    performance: { now: () => 1000 }, sharedSession: null, saveBlocked: false,
    saveCodec: {}, attemptPlay: (fn) => fn(), save: vi.fn(), render: vi.fn(),
    playQueue: { clear: vi.fn(), submit: vi.fn() },
    narrator: { invalidate: vi.fn(), changed: vi.fn() },
    exchange: { cancel: vi.fn() }, reveal: { finish: vi.fn() },
    speechSounds: { stop: vi.fn() }, notice: vi.fn(), count: vi.fn(),
    shownSceneLine: { text: "Keep this line." },
  };
  vm.createContext(context);
  vm.runInContext([body("rememberWait"), body("commitAction"), body("performAction")].join("\n"), context);
  context.commitAction(action, before.revision);
  expect(context.world.turn).toBe(before.turn);
  expect(context.lastWait).toMatchObject({ key: "vale", revision: context.world.revision });
  expect(context.world.items).toEqual(before.items);
  expect(context.shownSceneLine.text).toBe("Keep this line.");
  expect(context.save).toHaveBeenCalledOnce();
  for (const fn of [context.playQueue.submit, context.narrator.changed, context.narrator.invalidate,
    context.reveal.finish, context.speechSounds.stop, context.exchange.cancel]) expect(fn).not.toHaveBeenCalled();
  const accepted = JSON.stringify(context.world);
  const next = questPreviews(context.world).find((q) => q.kind === "pending").action;
  context.commitAction(next, context.world.revision, 1000);
  expect(JSON.stringify(context.world)).toBe(accepted);
  context.commitAction(action, before.revision);
  expect(JSON.stringify(context.world)).toBe(accepted);
  expect(context.notice).toHaveBeenCalled();
});
it("rearms a reviewed quest after Wait and after a later line is read", async () => {
  const { phase } = await import("../v2/card-game/presentation.mjs");
  const app = readFileSync(new URL("../v2/card-game/app.mjs", import.meta.url), "utf8");
  const at = app.indexOf("function presentPhase(");
  const context = { phase, selected: ["vale"], questOpen: false, rowCollapsed: false,
    questReviewId: null, restedChoice: null, queuedChoice: false, reviewing: false,
    stackView: {}, ownPlayInFlight: () => null, packPrompt: () => null,
    reveal: { complete: true }, exchange: { hasNext: false }, inscribing: new Set(),
    lingeringWords: () => false, queueMicrotask: vi.fn() };
  vm.createContext(context);
  vm.runInContext(app.match(/^const choiceKey = .+;$/mu)[0] + "\n" +
    app.slice(at, app.indexOf("\n}", at) + 2) + "\nglobalThis.choice = choiceKey;", context);
  context.restedChoice = context.choice();
  expect(context.presentPhase()).toBe("idle");
  context.questReviewId = "first-preview";
  expect(context.presentPhase()).toBe("choosing");
  context.restedChoice = context.choice();
  context.questReviewId = "next-preview";
  context.queuedChoice = true;
  context.reveal.complete = false;
  expect(context.presentPhase()).toBe("revealing");
  context.queuedChoice = false;
  context.reveal.complete = true;
  expect(context.presentPhase()).toBe("choosing");
});
it("forwards the exact shared Accept and refuses to refresh its stale revision", async () => {
  const app = readFileSync(new URL("../v2/card-game/app.mjs", import.meta.url), "utf8");
  const at = app.indexOf("async function submitSharedPlay(");
  const action = { key: "accept", offer: "preview", revision: 9 };
  const forwarded = vi.fn(async () => ({})), noop = () => {};
  const context = { world: { revision: 9, actors: { vale: { place: "attic" } } },
    sharedSending: false, sharedSession: { state: { queue: [] }, play: forwarded },
    currentActor: () => "vale", legalActions: () => [{ ...action }], selected: [],
    notice: vi.fn(), render: vi.fn(), heldSelection: noop, sharedNextLine: () => false,
    sharedLineSeq: null, crypto: { randomUUID: () => "test-play" }, playLabel: () => "Accept",
    reviewing: true, reviewBeat: { seq: 5 }, sharedAdvanceRequested: false,
    showSharedPlay: noop, hiddenFor: noop, encountered: new Set(), cardIsCovered: () => false,
    performance: { now: () => 1000 }, playQueue: {}, keepHeldSelection: vi.fn(),
    trackSharedPlay: noop, restoreHandFocus: noop };
  vm.createContext(context);
  vm.runInContext(app.slice(at, app.indexOf("\n}", at) + 2), context);
  await context.submitSharedPlay(action);
  expect(forwarded.mock.calls[0][0]).toBe(action);
  expect(context.keepHeldSelection).not.toHaveBeenCalled();
  expect(context.reviewing).toBe(true);
  expect(context.reviewBeat).toEqual({ seq: 5 });
  expect(context.sharedAdvanceRequested).toBe(false);
  context.world.revision++;
  await context.submitSharedPlay(action);
  expect(forwarded).toHaveBeenCalledOnce();
  expect(context.notice).toHaveBeenCalledWith("The table changed. Choose a current play.");
});
