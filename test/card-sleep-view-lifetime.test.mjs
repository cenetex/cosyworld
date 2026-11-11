import { heldItem } from "../v2/card-game/held-item.mjs";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSleepView } from "../v2/card-game/sleep-view.mjs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { questXp } from "../v2/card-game/want.mjs";

function rest(eventSeq = 1) {
  let world = createWorld();
  world.actors.vale.place = "attic";
  world.turn = world.revision = 30;
  world.eventSeq = eventSeq;
  world.actors.vale.xp = questXp(2);
  world.actors.vale.level = 1;
  world.actors.moth.want = world.actors.keeper.want = null;
  for (const sleep of [false, true]) {
    const action = legalActions(world, "vale").find((a) =>
      sleep ? a.sleep : a.kind === "wait",
    );
    world = play(world, action, world.revision, "vale").state;
  }
  return world;
}
const element = () => ({
  dataset: {},
  children: [],
  hidden: false,
  style: {
    setProperty() {},
    getPropertyValue() {
      return "";
    },
  },
  setAttribute() {},
  addEventListener() {},
  append() {},
  insertBefore() {},
  querySelector() {
    return null;
  },
  querySelectorAll() {
    return [];
  },
});
function view(reduced = false) {
  const root = element(),
    stage = element(),
    dealt = vi.fn(),
    shown = vi.fn();
  const v = createSleepView({
    root,
    stage,
    speechRow: element(),
    hand: element(),
    reducedMotion: { matches: reduced },
    dealQuests: dealt,
    showWake: shown,
  });
  const start = (world = rest()) => {
    v.observe(createWorld(), "vale");
    v.observe(world, "vale");
    return world;
  };
  const dream = () => {
    v.tap();
    v.tap();
    v.tap();
  };
  const quest = () => {
    v.words("failed");
    v.revealed(JSON.stringify(`dream:${shown.mock.lastCall[0].seq}`));
    v.tap();
  };
  return { v, root, stage, dealt, shown, start, dream, quest };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("document", { createElement: element, addEventListener() {} });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

for (const reduced of [false, true]) {
  for (const phase of ["fade", "dreaming", "quest", "done"]) {
    it(`resets ${phase} and forgets the outgoing dream (reduced=${reduced})`, () => {
      const { v, root, stage, dealt, start, dream, quest } = view(reduced);
      const old = start();
      if (phase !== "fade") dream();
      if (["quest", "done"].includes(phase)) quest();
      if (phase === "done") vi.advanceTimersByTime(10_000);
      const count = dealt.mock.calls.length;
      v.reset(createWorld(), "vale");
      expect(v.active).toBe(false);
      expect(v.dream()).toBeNull();
      expect(v.dreamTap).toBeNull();
      expect(root.dataset.sleep).toBeUndefined();
      expect(stage.dataset.sleep).toBeUndefined();
      expect(root.dataset.sleepDream).toBe("false");
      expect(
        v.hidesLine({ generated: true, turn: old.turn, actorId: "vale" }),
      ).toBe(false);
      expect(v.light(5)).toEqual({ turn: 5, cut: false });
      v.tap();
      vi.advanceTimersByTime(100_000);
      expect(dealt).toHaveBeenCalledTimes(count);
      // A new run may use exactly the same event/turn identity.
      v.observe(old, "vale");
      expect(v.active).toBe(true);
    });
  }
}
it("seeds an adopted wake without replaying it, then plays its next wake", () => {
  const { v, shown } = view();
  const adopted = rest();
  v.reset(adopted, "vale");
  v.observe(adopted, "vale");
  expect(v.active).toBe(false);
  expect(shown).not.toHaveBeenCalled();
  v.observe(rest(100), "vale");
  expect(v.active).toBe(true);
  expect(shown).toHaveBeenCalledTimes(1);
});
it("does not let an earlier words check fail a later wake", () => {
  const { v, start, dream } = view();
  start();
  dream();
  v.words("pending");
  v.words("ready");
  v.observe(rest(100), "vale");
  dream();
  vi.advanceTimersByTime(0);
  expect(v.dream().beat.pending).toBe(true);
});
for (const reject of [false, true]) {
  it(`ignores an old reflection after reset (reject=${reject})`, async () => {
    const { v, start, dream } = view();
    start();
    dream();
    const pending = Promise.withResolvers();
    v.reflect(() => pending.promise)({}, new AbortController().signal);
    v.reset(createWorld(), "vale");
    v.observe(rest(), "vale");
    dream();
    if (reject) pending.reject(new Error("old request"));
    else pending.resolve({});
    await Promise.resolve();
    vi.advanceTimersByTime(0);
    expect(v.dream().beat.pending).toBe(true);
  });
}
it("ordinary observation preserves the dream and deals its quest once", () => {
  const { v, start, dream, quest, dealt, shown } = view();
  const world = start();
  dream();
  v.observe(structuredClone(world), "vale");
  expect(shown).toHaveBeenCalledTimes(1);
  quest();
  expect(v.dream()).not.toBeNull();
  v.tap();
  vi.advanceTimersByTime(10_000);
  expect(dealt).toHaveBeenCalledTimes(1);
  expect(v.active).toBe(false);
  expect(v.dream()).not.toBeNull();
  expect(
    v.hidesLine({ generated: true, turn: world.turn, actorId: "vale" }),
  ).toBe(true);
});

// Execute the shipping reset and storage handlers with peripheral UI/IO
// stubbed. This verifies their owner boundary, not a browser or full app boot.
function appBoundary(sleepView, world) {
  const source = readFileSync(
    new URL("../v2/card-game/app.mjs", import.meta.url),
    "utf8",
  );
  const code = source.slice(
    source.indexOf('$("confirm-reset").onclick'),
    source.indexOf(
      "\npauseSpeech();",
      source.indexOf('$("confirm-reset").onclick'),
    ),
  );
  const noop = () => {};
  const context = {
    world,
    sleepView,
    decodeSave,
    heldItem,
    enableMotives: (w) => w,
    freshWorld: createWorld,
    currentActor: () => "vale",
    SAVE_KEY: "save",
    accountStorageKey: (key) => `epoch:${key}`,
    sharedSession: null,
    startingPip: false,
    selected: [],
    expandedHolders: new Set(),
    completedSpeech: new Set(),
    seenCaptions: new Set(),
    localStorage: { getItem: () => null },
    playQueue: { clear: noop },
    exchange: { cancel: noop },
    reveal: { cancel: noop },
    speechSounds: { stop: noop },
    narrator: { invalidate: () => sleepView.words("ready") },
    $: () => ({ close: noop }),
    window: {
      addEventListener: (_, fn) => {
        context.storage = fn;
      },
    },
  };
  for (const key of [
    "cancelPipTransition",
    "releaseGhosts",
    "cancelTravel",
    "rememberWords",
    "loadSeen",
    "notice",
    "save",
    "playNewWorldIntro",
    "holdMusicForTitle",
    "nameTitleWaker",
    "nameOf",
    "selectCards",
    "render",
  ])
    context[key] = noop;
  context.availableCards = () => [];
  context.resumeScene = () => sleepView.observe(context.world, "vale");
  vm.runInNewContext(code, context);
  return context;
}
for (const action of ["reset", "storage"]) {
  it(`the app's ${action} boundary releases the old dream and seeds the replacement`, () => {
    const { v, start, dream, dealt } = view();
    const old = start();
    dream();
    v.words("pending");
    const app = appBoundary(v, old),
      replacement = rest(100);
    if (action === "reset") app.resetTable(replacement);
    else app.storage({ key: "epoch:save", newValue: encodeSave(replacement) });
    expect(v.active).toBe(false);
    expect(v.dream()).toBeNull();
    vi.advanceTimersByTime(100_000);
    expect(dealt).not.toHaveBeenCalled();
    expect(app.world.turn).toBe(replacement.turn);
  });
}
it("a refused storage save keeps the current world and does not reset its dream", () => {
  const { v, start, dream } = view();
  const old = start();
  dream();
  const app = appBoundary(v, old);
  app.storage({ key: "epoch:save", newValue: "invalid" });
  expect(app.world).toBe(old);
  expect(v.active).toBe(true);
});

it("ignores a storage event from a retired account epoch", () => {
  const { v, start, dream } = view();
  const old = start();
  dream();
  const app = appBoundary(v, old);
  app.storage({ key: "save", newValue: encodeSave(rest(100)) });
  expect(app.world).toBe(old);
  expect(v.active).toBe(true);
});
