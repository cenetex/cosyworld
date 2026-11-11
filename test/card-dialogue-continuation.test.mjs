import { afterEach, expect, it, vi } from "vitest";
import {
  createWorld,
  legalActions,
  play,
  holdChoice,
  encodeSave,
  decodeSave,
} from "../v2/card-game/world.mjs";
import {
  createNarrator,
  narrativeContext,
  applyGeneratedText,
} from "../v2/card-game/narrative.mjs";
import {
  signedRequest,
  withSignatures,
  forgetSigned,
} from "../v2/card-game/signed-words.mjs";

const line = "Would you stay here with me, Pip?";
function talking() {
  const world = createWorld();
  world.items.lamp.holder = "vale";
  world.actors.moth.place = world.actors.vale.place;
  return play(
    world,
    legalActions(world).find((a) => a.kind === "talk" && a.target === "moth"),
  ).state;
}
function table(world = talking()) {
  const requests = [],
    status = vi.fn(),
    apply = vi.fn((next) => {
      world = next;
    });
  const narrator = createNarrator({
    getWorld: () => world,
    apply,
    status,
    early: true,
    request: (context, signal, progress) =>
      new Promise((resolve) =>
        requests.push({ context, signal, progress, resolve }),
      ),
  });
  return {
    requests,
    narrator,
    apply,
    status,
    get world() {
      return world;
    },
    hold(item) {
      holdChoice(world, "vale", { item, revision: world.revision });
      narrator.continuePending();
    },
  };
}
const reply = ({ context }, text = "I will stay here with you.") => ({
  revision: context.revision,
  model: "fixture",
  entries: context.entities.map(({ id }) => ({ id, text })),
});
afterEach(() => {
  vi.useRealTimers();
  forgetSigned();
});

it("continues only unspoken voices through repeated changes and fences stale streaming", async () => {
  vi.useFakeTimers();
  const t = table();
  t.narrator.changed();
  t.requests[0].progress([{ id: "vale", text: line }]);
  const spoken = structuredClone(t.world.log.filter((e) => e.generated));
  const memory = structuredClone(t.world.memories.vale);
  const turn = t.world.turn;
  t.hold("lamp");
  t.hold(null);
  await vi.advanceTimersByTimeAsync(0);
  const latest = t.requests.at(-1);
  expect(t.requests).toHaveLength(2);
  expect(latest.context.speakers).toEqual(["moth"]);
  expect(latest.context.entities.map((e) => e.id)).toContain("vale");
  expect(latest.context.conversation.at(-1)).toMatchObject({
    actorId: "vale",
    text: line,
  });
  expect(
    latest.context.outcome.avatars.find((a) => a.id === "vale").heldItem,
  ).toBeNull();
  t.requests[0].progress([{ id: "moth", text: "Stale light." }]);
  t.requests[0].resolve(reply(t.requests[0], "Rewritten words."));
  await vi.advanceTimersByTimeAsync(0);
  expect(t.world.log.filter((e) => e.generated)).toEqual(spoken);
  expect(t.world.memories.vale).toEqual(memory);
  latest.progress([{ id: "moth", text: "I will stay here with you." }]);
  latest.resolve(reply(latest));
  await vi.advanceTimersByTimeAsync(0);
  expect(
    t.world.log.filter((e) => e.generated && e.actorId === "vale"),
  ).toEqual(spoken);
  expect(
    t.world.log.filter((e) => e.generated && e.actorId === "moth"),
  ).toHaveLength(1);
  expect(t.world.memories.vale).toMatchObject({
    text: memory.text,
    model: memory.model,
    turn: memory.turn,
  });
  expect(t.world.memories.vale.events.slice(0, memory.events.length)).toEqual(
    memory.events,
  );
  expect(t.world.turn).toBe(turn);
  expect(t.world.actors.vale.heldItem).toBeNull();
  expect(t.status).toHaveBeenLastCalledWith("ready");
  const count = t.requests.length;
  t.hold("lamp");
  expect(t.requests).toHaveLength(count);
});

it("restores a partial exchange from its save without repeating or changing its original line", async () => {
  vi.useFakeTimers();
  let world = talking();
  const context = narrativeContext(world);
  world = applyGeneratedText(
    world,
    context,
    {
      revision: world.revision,
      model: "first",
      entries: [{ id: "vale", text: line }],
      omitted: context.entities.filter((e) => e.id !== "vale").map((e) => e.id),
    },
    { incremental: true },
  );
  holdChoice(world, "vale", { item: null, revision: world.revision });
  const restored = decodeSave(encodeSave(world)),
    t = table(restored);
  t.narrator.changed(null, { remaining: true });
  expect(t.requests[0].context.speakers).toEqual(["moth"]);
  t.requests[0].resolve(reply(t.requests[0]));
  await vi.advanceTimersByTimeAsync(0);
  expect(
    t.world.log.filter((e) => e.generated && e.actorId === "vale"),
  ).toEqual(world.log.filter((e) => e.generated));
  expect(t.world.memories.vale).toMatchObject({
    text: world.memories.vale.text,
    model: world.memories.vale.model,
    turn: world.memories.vale.turn,
  });
  expect(
    t.world.memories.vale.events.slice(0, world.memories.vale.events.length),
  ).toEqual(world.memories.vale.events);
});

it("saves streamed signatures before completion so the continuation can quote original words", async () => {
  const signed = { claims: { kind: "line" }, sig: "fixture" };
  const context = narrativeContext(talking());
  const send = signedRequest(async (context, signal, progress) => {
    progress([{ id: "vale", text: line, signed }]);
    throw new Error("cancelled after publication");
  });
  await expect(send(context)).rejects.toThrow("cancelled");
  expect(
    withSignatures({
      ...context,
      conversation: [{ actorId: "vale", text: line }],
    }).conversation,
  ).toEqual([{ actorId: "vale", text: line, signed }]);
});

it("keeps the original roster before a delayed transport and across coalesced changes", async () => {
  vi.useFakeTimers();
  let world = talking();
  let narrator;
  const saved = [],
    requests = [];
  narrator = createNarrator({
    getWorld: () => world,
    apply: () => {},
    status: (value) => {
      if (value === "pending") saved.push(narrator.pendingCast());
    },
    request: (context) => {
      requests.push(context);
      return Promise.reject(
        Object.assign(new Error("busy"), { retryAfter: 60_000 }),
      );
    },
  });
  narrator.changed();
  await vi.advanceTimersByTimeAsync(0);
  const original = saved[0];
  expect(original.speakers).toEqual(["vale", "moth"]);
  // A new pending request respects the earlier service throttle.
  world = talking();
  world.revision += 1;
  narrator.changed(null, { remaining: original });
  holdChoice(world, "vale", { item: "lamp", revision: world.revision });
  narrator.continuePending();
  holdChoice(world, "vale", { item: null, revision: world.revision });
  narrator.continuePending();
  await vi.advanceTimersByTimeAsync(0);
  expect(requests).toHaveLength(1);
  expect(saved.at(-1)).toEqual(original);
  expect(narrator.pendingCast()).toEqual(original);
  narrator.invalidate();
});
