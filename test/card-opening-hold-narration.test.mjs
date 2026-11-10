import { readFileSync } from "node:fs";
import vm from "node:vm";
import { afterEach, expect, it, vi } from "vitest";
import { createWorld, holdChoice } from "../v2/card-game/world.mjs";
import { createNarrator } from "../v2/card-game/narrative.mjs";

const app = readFileSync(
  new URL("../v2/card-game/app.mjs", import.meta.url),
  "utf8",
);
const functions =
  app.slice(
    app.indexOf("async function persistHeldChoice("),
    app.indexOf("function heldSelection()"),
  ) +
  app.slice(
    app.indexOf("function hasCurrentWords()"),
    app.indexOf("// No line is scripted for a waking avatar"),
  );
function table({
  pending = true,
  ordinary = false,
  partial = false,
  shared = false,
} = {}) {
  const world = createWorld({ opening: true });
  if (ordinary) world.turn = 1;
  if (partial)
    world.log.push({
      generated: true,
      kind: "dialogue",
      turn: 0,
      locationId: "attic",
      text: "Already spoken.",
    });
  const context = vm.createContext({
    world,
    storyStatus: pending ? "pending" : "ready",
    saveBlocked: false,
    sharedSession: shared
      ? { command: vi.fn(async () => {}), sync: vi.fn() }
      : null,
    narrator: { changed: vi.fn() },
    holdChoice,
    currentActor: () => "vale",
    isSceneText: (entry) => entry.kind === "dialogue",
    heldItem: () => "lamp",
    selected: [],
    save: vi.fn(),
    notice: vi.fn(),
    queueDiscoveries: vi.fn(),
    render: vi.fn(),
  });
  vm.runInContext(
    `const localWordsPending = () => !sharedSession && storyStatus === "pending";\n${functions}`,
    context,
  );
  return context;
}
afterEach(() => vi.useRealTimers());

it.each([
  [{}, true],
  [{ pending: false }, false],
  [{ ordinary: true }, false],
  [{ partial: true }, false],
  [{ shared: true }, false],
])(
  "refreshes only a pending unpublished local opening: %j",
  async (options, refresh) => {
    const t = table(options);
    await t.persistHeldChoice(null);
    expect(t.narrator.changed).toHaveBeenCalledTimes(refresh ? 1 : 0);
    if (!options.shared) {
      expect(t.world.actors.vale.heldItem).toBeNull();
      expect(t.world.items.lamp.lit).toBe(false);
      expect(t.world.turn).toBe(options.ordinary ? 1 : 0);
    } else expect(t.sharedSession.command).toHaveBeenCalledTimes(1);
  },
);
it("does not restart after a rejected quiet choice or a line committed during save", async () => {
  const failed = table();
  failed.holdChoice = () => {
    throw new Error("stale choice");
  };
  await failed.persistHeldChoice(null);
  expect(failed.narrator.changed).not.toHaveBeenCalled();
  const published = table();
  published.save = () =>
    published.world.log.push({
      generated: true,
      kind: "dialogue",
      turn: 0,
      locationId: "attic",
    });
  await published.persistHeldChoice(null);
  expect(published.narrator.changed).not.toHaveBeenCalled();
});
it("coalesces held/stowed opening changes, rejects old replies and saves Awake once", async () => {
  vi.useFakeTimers();
  const t = table();
  const requests = [],
    apply = vi.fn((next) => {
      t.world = next;
    });
  t.narrator = createNarrator({
    getWorld: () => t.world,
    apply,
    status: (value) => {
      t.storyStatus = value;
    },
    request: (context, signal, progress) =>
      new Promise((resolve) =>
        requests.push({ context, signal, progress, resolve }),
      ),
  });
  const reply = (request) => ({
    revision: request.context.revision,
    model: "fixture",
    entries: request.context.entities.map(({ id }) => ({ id, text: "Awake." })),
  });
  t.narrator.changed();
  await t.persistHeldChoice(null);
  await t.persistHeldChoice("lamp");
  await t.persistHeldChoice(null);
  await vi.advanceTimersByTimeAsync(0);
  expect(requests[0].signal.aborted).toBe(true);
  const latest = requests.at(-1);
  expect(latest.context.revision).toBe(t.world.revision);
  expect(latest.context.turn).toBe(0);
  for (const old of requests.slice(0, -1)) {
    old.progress([{ id: "vale", text: "Stale." }]);
    old.resolve(reply(old));
  }
  await vi.advanceTimersByTimeAsync(0);
  expect(apply).not.toHaveBeenCalled();
  latest.resolve(reply(latest));
  await vi.advanceTimersByTimeAsync(0);
  expect(apply).toHaveBeenCalledTimes(1);
  expect(
    t.world.log.filter(
      (entry) =>
        entry.generated && entry.kind === "dialogue" && entry.text === "Awake.",
    ),
  ).toHaveLength(1);
  expect(t.world.actors.vale.heldItem).toBeNull();
  expect(t.world.items.lamp.lit).toBe(false);
  expect(t.world.turn).toBe(0);
  const count = requests.length;
  await t.persistHeldChoice("lamp");
  await vi.advanceTimersByTimeAsync(0);
  expect(requests).toHaveLength(count);
});
it("fences replacement worlds against the refreshed opening's late response", async () => {
  vi.useFakeTimers();
  const t = table(),
    requests = [],
    apply = vi.fn();
  t.narrator = createNarrator({
    getWorld: () => t.world,
    apply,
    status: (value) => {
      t.storyStatus = value;
    },
    request: (context, signal) =>
      new Promise((resolve) => requests.push({ context, signal, resolve })),
  });
  t.narrator.changed();
  await t.persistHeldChoice(null);
  await vi.advanceTimersByTimeAsync(0);
  t.narrator.invalidate();
  t.world = createWorld({ opening: true });
  for (const r of requests)
    r.resolve({
      revision: r.context.revision,
      model: "fixture",
      entries: [{ id: "vale", text: "Old world." }],
    });
  await vi.advanceTimersByTimeAsync(0);
  expect(apply).not.toHaveBeenCalled();
  expect(t.world.log.some((entry) => entry.generated)).toBe(false);
  expect(requests.every((r) => r.signal.aborted)).toBe(true);
});

it("does not refresh or reinterpret an already-published early opening", async () => {
  vi.useFakeTimers();
  const t = table(),
    requests = [];
  t.narrator = createNarrator({
    getWorld: () => t.world,
    early: true,
    apply: (next) => {
      t.world = next;
    },
    status: (value) => {
      t.storyStatus = value;
    },
    request: (context, signal, progress) =>
      new Promise((resolve) =>
        requests.push({ context, signal, progress, resolve }),
      ),
  });
  t.narrator.changed();
  requests[0].progress([{ id: "vale", text: "Original committed words." }]);
  const log = structuredClone(t.world.log),
    memories = structuredClone(t.world.memories);
  expect(
    log.some(
      (entry) => entry.generated && entry.text === "Original committed words.",
    ),
  ).toBe(true);
  await t.persistHeldChoice(null);
  await vi.advanceTimersByTimeAsync(0);
  expect(requests).toHaveLength(1);
  expect(requests[0].signal.aborted).toBe(false);
  expect(t.world.log).toEqual(log);
  expect(t.world.memories).toEqual(memories);
  t.narrator.invalidate();
});
