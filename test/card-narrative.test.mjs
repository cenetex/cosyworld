import { atticOpening } from "./fixtures/card-attic-opening.mjs";
import { rest } from "./fixtures/card-rest.mjs";
import { questing } from "./helpers/first-quest.mjs";
import { describe, it, expect, vi, afterEach } from "vitest";
afterEach(() => vi.useRealTimers());
import {
  createWorld as baseCreateWorld,
  addLog,
  legalActions,
  play,
  encodeSave,
  decodeSave,
} from "../v2/card-game/world.mjs";
// Play here starts past the pond, where the first quest begins.
const createWorld = (...args) => questing(baseCreateWorld(...args));
import {
  narrativeContext,
  turnOutcome,
  applyGeneratedText,
  createNarrator,
  requestNarrative,
  silentSpeakers,
  silentLines,
  SILENT_TEXT,
} from "../v2/card-game/narrative.mjs";
import { profiles } from "../v2/card-game/memory.mjs";
import { sceneScript, currentScene } from "../v2/card-game/scene.mjs";

const act = (world, kind, item, target) =>
  play(
    world,
    legalActions(world).find(
      (a) =>
        a.kind === kind &&
        (!item || a.item === item) &&
        (!target || a.target === target),
    ),
  ).state;
const response = (context) => ({
  revision: context.revision,
  model: "fixture-model",
  entries: context.entities.map(({ id }) => ({
    id,
    text: `${profiles[id].name} remembers the warm lamp.`,
  })),
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const wantPlace = (target) => ({ kind: "place", target, since: 0, refusals: 0 });
// Vale, Pip and the keeper at the station. Each named resident wants to be
// at the pond, so it leaves on the next play; the others stay put.
function leavingStation(...leavers) {
  const world = createWorld();
  for (const id of ["moth", "keeper"]) {
    world.actors[id].place = "station";
    world.actors[id].want = leavers.includes(id) ? wantPlace("pond") : null;
  }
  return world;
}

describe("entity memories and model text", () => {
  it("keeps the final Bell recipient and its later movement in the speech request", () => {
    const world = createWorld();
    world.actors.vale.place = "pond";
    world.items.lamp.holder = "vale";
    world.items.lamp.lit = true;
    world.actors.keeper.place = "pond";
    world.items.bell.holder = "vale";
    // The keeper heads home to the station; Vale's bell rides along.
    world.actors.keeper.want = wantPlace("station");
    const next = act(world, "give", "bell", "keeper");
    const outcome = narrativeContext(next).outcome;
    expect(outcome.card).toMatchObject({
      kind: "give",
      item: "bell",
      target: "keeper",
    });
    expect(outcome.items.find((item) => item.id === "bell")).toEqual({
      id: "bell",
      holder: "keeper",
      location: "station",
    });
    // The keeper carries the bell home.
    expect(
      outcome.avatars.find((actor) => actor.id === "keeper"),
    ).toMatchObject({
      holding: ["oil", "bell"],
      travel: { from: "pond", to: "station", companions: [] },
    });
    expect(narrativeContext(decodeSave(encodeSave(next))).outcome).toEqual(
      outcome,
    );
  });

  it("sends the final lamp state after refueling, lighting, covering and running dry", () => {
    let world = createWorld();
    world.actors.vale.place = "pond";
    world.items.lamp.holder = "vale";
    world.items.oil.holder = "pond";
    world.items.cloth.holder = "vale";
    world.items.lamp.fuel = 0;
    const lamp = (state) =>
      Object.fromEntries(
        narrativeContext(state).outcome.observations.map(({ id, value }) => [
          id,
          value,
        ]),
      );
    world = act(world, "take", "oil");
    expect(world.items.lamp.fuel).toBe(12);
    expect(lamp(world)).toMatchObject({
      "lamp-flame": false,
      "lamp-cover": false,
    });
    world = act(world, "light", "lamp");
    expect(lamp(world)).toMatchObject({
      "lamp-flame": true,
      "lamp-cover": false,
    });
    world = act(world, "cover", "cloth", "lamp");
    expect(lamp(world)).toMatchObject({
      "lamp-flame": true,
      "lamp-cover": true,
    });
    world.items.lamp.fuel = 1;
    world = act(world, "wait");
    expect(lamp(world)).toMatchObject({
      "lamp-flame": false,
      "lamp-cover": true,
    });
    expect(narrativeContext(world).events.join(" ")).toContain("runs dry");
    expect(lamp(decodeSave(encodeSave(world)))).toEqual(lamp(world));
  });

  it("reports an extinguished lamp when its last oil burns on the lighting turn", () => {
    const world = createWorld();
    world.items.lamp.holder = "vale";
    world.items.lamp.fuel = 1;
    const next = act(world, "light", "lamp");
    const context = narrativeContext(next);
    expect(context.outcome.card.kind).toBe("light");
    expect(context.outcome.observations).toContainEqual({
      id: "lamp-flame",
      value: false,
    });
    expect(context.events.join(" ")).toContain("runs dry");
  });

  it("records an event in its witnesses, item and place, including departures", () => {
    let world = act(createWorld(), "take", "lamp");
    for (const id of ["vale", "lamp", "station"])
      expect(
        world.memories[id].events.some((e) =>
          e.text.includes("Vale takes the Lamp"),
        ),
      ).toBe(true);
    expect(
      world.memories.keeper.events.some((e) =>
        e.text.includes("Vale takes the Lamp"),
      ),
    ).toBe(false);
    world = act(world, "move", null, "pond");
    for (const id of ["vale", "lamp", "station", "pond", "moth"])
      expect(
        world.memories[id].events.some((e) =>
          e.text.includes("Vale goes to Black pond"),
        ),
      ).toBe(true);
    expect(decodeSave(encodeSave(world))).toEqual(world);
  });

  it("sends current desires and per-entity memories and keeps generated text through reload", () => {
    const world = act(createWorld(), "take", "lamp");
    const context = narrativeContext(world, { item: "lamp" });
    expect(context.speakers).toEqual(["vale", "moth", "keeper"]);
    expect(context.action).toBe("Vale takes the Lamp.");
    // Taking the lamp met Vale's want; the card carries that outcome.
    expect(context.outcome.card.wantMet).toEqual({ kind: "item", target: "lamp" });
    // Another person's want reaches the scene only through Talk.
    expect(context.entities.find((e) => e.id === "moth").desire).toEqual({
      items: [],
      location: null,
      avatars: [],
    });
    expect(
      context.entities
        .find((e) => e.id === "lamp")
        .memories.some((e) => e.text.includes("Vale takes")),
    ).toBe(true);
    const vale = context.entities.find((e) => e.id === "vale");
    const want = world.actors.vale.want;
    expect(vale.desire).toEqual({
      items: want.kind === "item" ? [want.target] : [],
      location: want.kind === "place" ? want.target : null,
      avatars: want.kind === "person" ? [want.target] : [],
    });
    expect(context.entities.every((e) => e.facts.length <= 16)).toBe(true);
    context.scenery = true;
    const next = applyGeneratedText(world, context, response(context));
    expect(next.actors).toEqual(world.actors);
    expect(next.items).toEqual(world.items);
    expect(next.revision).toBe(world.revision);
    for (const id of ["station", "lamp", "vale", "moth"]) {
      expect(next.memories[id].text).toContain("remembers");
      expect(next.log.some((e) => e.entityId === id && e.generated)).toBe(true);
    }
    expect(currentScene(next).line.generated).toBe(true);
    expect(sceneScript(next).memories).toEqual(next.memories);
    expect(decodeSave(encodeSave(next))).toEqual(next);
  });

  it("gives Vale a line alone and starts a direct exchange with the chosen avatar", () => {
    expect(narrativeContext(createWorld()).speakers).toEqual(["vale"]);
    let world = act(createWorld(), "take", "lamp");
    world = act(world, "talk", null, "keeper");
    const context = narrativeContext(world, { target: "keeper" });
    expect(context.speakers).toEqual(["vale", "keeper"]);
    expect(context.action).toBe("Vale asks The keeper what they want.");
    const next = applyGeneratedText(world, context, response(context));
    expect(next.log.slice(-2).map((entry) => entry.actorId)).toEqual([
      "vale",
      "keeper",
    ]);
    expect(currentScene(next).previous.actorId).toBe("vale");
    expect(currentScene(next).line.actorId).toBe("keeper");
  });

  it("tells a noise-averse speaker when a handled bell stayed silent", () => {
    let s = act(createWorld(), "take", "lamp");
    s = act(s, "take", "bell");
    const trade = legalActions(s).find(
      (a) => a.kind === "trade" && a.item === "bell" && a.receive === "oil",
    );
    s = play(s, trade).state;
    const quiet = "The Bell made no sound this turn";
    const facts = (context, id) =>
      context.entities.find((e) => e.id === id).facts.join(" ");
    let context = narrativeContext(s, trade);
    expect(facts(context, "keeper")).toContain(quiet);
    expect(facts(context, "vale")).not.toContain(quiet);

    // A real ring keeps its noise, and so does its ringing afterwards.
    let rung = act(createWorld(), "take", "lamp");
    rung = act(rung, "take", "bell");
    rung = act(rung, "ring", "bell");
    context = narrativeContext(rung);
    expect(facts(context, "keeper")).not.toContain(quiet);
    rung = act(rung, "wait");
    expect(rung.items.bell.ringing).toBeGreaterThan(0);
    expect(facts(narrativeContext(rung), "keeper")).not.toContain(quiet);
  });

  it("gives each trader their own exchange before their current wants", () => {
    let s = act(createWorld(), "take", "lamp");
    s = act(s, "take", "bell");
    const trade = legalActions(s).find(
      (a) => a.kind === "trade" && a.item === "bell" && a.receive === "oil",
    );
    s = play(s, trade).state;
    const context = narrativeContext(s, trade);
    const vale = context.entities.find((e) => e.id === "vale");
    const keeper = context.entities.find((e) => e.id === "keeper");
    expect(vale.facts[0]).toContain(
      "you gave Bell to The keeper and received Oil flask",
    );
    expect(keeper.facts[0]).toContain(
      "you gave Oil flask to Vale and received Bell",
    );
    expect(keeper.facts[0]).toContain("The item you gained was Bell");
    expect(context.outcome.card).toMatchObject({
      kind: "trade",
      item: "bell",
      receive: "oil",
      target: "keeper",
    });
    expect(
      context.entities.every(
        (e) => e.facts.length <= 16 && e.facts.every((f) => f.length <= 240),
      ),
    ).toBe(true);
  });

  it("starts the earliest saves fresh and keeps item histories on reload", () => {
    const world = act(createWorld(), "take", "lamp");
    const old = structuredClone(world);
    old.schema = 3;
    delete old.memories;
    expect(() => decodeSave(JSON.stringify(old))).toThrow(/fresh start/);
    const restored = decodeSave(encodeSave(world));
    expect(restored.actors).toEqual(world.actors);
    expect(restored.items).toEqual(world.items);
    expect(
      restored.memories.lamp.events.some((e) => e.text.includes("Vale takes")),
    ).toBe(true);
    restored.memories.lamp.events[0].turn = 999;
    expect(() => decodeSave(JSON.stringify(restored))).toThrow();
  });

  it("rejects partial output and discards replies for older turns", () => {
    const world = act(createWorld(), "wait"),
      context = narrativeContext(world);
    const bad = response(context);
    bad.entries.pop();
    expect(() => applyGeneratedText(world, context, bad)).toThrow();
    const later = act(world, "wait");
    expect(applyGeneratedText(later, context, response(context))).toBeNull();
    const duplicate = response(context);
    duplicate.entries[0].id = duplicate.entries[1].id;
    expect(() => applyGeneratedText(world, context, duplicate)).toThrow();
  });

  it("keeps omitted cards unchanged and publishes only supplied speakers", () => {
    const world = act(createWorld(), "wait");
    const context = narrativeContext(world);
    const reply = response(context);
    const silent = context.speakers.at(-1);
    expect(context.speakers.length).toBeGreaterThan(1);
    reply.omitted = [silent];
    reply.entries = reply.entries.filter((entry) => entry.id !== silent);
    const next = applyGeneratedText(world, context, reply);
    expect(next.memories[silent].text).toEqual(world.memories[silent].text);
    expect(
      next.log
        .slice(world.log.length)
        .some((e) => e.generated && e.entityId === silent),
    ).toBe(false);
    // The quiet speaker is shown as "…" without saving or a memory change.
    const quiet = silentSpeakers(context, reply, next);
    expect(quiet).toEqual(
      profiles[silent].kind === "avatar" ? [silent] : [],
    );
    const shown = silentLines(next, quiet);
    expect(shown.every((line) => line.silent && line.text === SILENT_TEXT)).toBe(
      true,
    );
    expect(shown.every((line) => line.seq > next.eventSeq)).toBe(true);
    expect(next.log.some((entry) => entry.silent)).toBe(false);
    expect(silentSpeakers(context, response(context), next)).toEqual([]);
    const empty = response(context);
    empty.omitted = [...context.speakers];
    empty.entries = empty.entries.filter(
      (entry) => !empty.omitted.includes(entry.id),
    );
    expect(() => applyGeneratedText(world, context, empty)).toThrow();
  });

  it("coalesces fast plays and keeps reset worlds clear of late replies", async () => {
    let world = act(createWorld(), "wait");
    const requests = [],
      started = vi.fn(),
      apply = vi.fn((next) => {
        world = next;
      });
    const narrator = createNarrator({
      getWorld: () => world,
      apply,
      status: vi.fn(),
      started,
      request: (context) =>
        new Promise((resolve) => {
          expect(started).toHaveBeenLastCalledWith(context);
          requests.push({ context, resolve });
        }),
    });
    narrator.changed();
    world = act(world, "wait");
    narrator.changed();
    world = act(world, "wait");
    narrator.changed();
    expect(requests).toHaveLength(1);
    expect(started).toHaveBeenCalledTimes(1);
    requests[0].resolve(response(requests[0].context));
    await flush();
    expect(apply).not.toHaveBeenCalled();
    expect(requests).toHaveLength(2);
    expect(started).toHaveBeenCalledTimes(2);
    expect(requests[1].context.turn).toBe(3);
    narrator.invalidate();
    world = createWorld();
    requests[1].resolve(response(requests[1].context));
    await flush();
    expect(apply).not.toHaveBeenCalled();
    expect(world.turn).toBe(0);
  });

  it("retries a temporary provider failure on the same turn", async () => {
    vi.useFakeTimers();
    let world = act(createWorld(), "wait");
    const before = encodeSave(world);
    const status = vi.fn(),
      request = vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockImplementationOnce(async (context) => response(context));
    const narrator = createNarrator({
      getWorld: () => world,
      apply: (next) => {
        world = next;
      },
      status,
      request,
    });
    narrator.changed();
    await vi.advanceTimersByTimeAsync(0);
    expect(status).toHaveBeenLastCalledWith("pending");
    expect(encodeSave(world)).toBe(before);
    await vi.advanceTimersByTimeAsync(750);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map(([context]) => context.turn)).toEqual([1, 1]);
    expect(status).toHaveBeenLastCalledWith("ready");
    expect(world.turn).toBe(1);
    expect(world.memories.vale.turn).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("accepts a reply within the server's 25-second deadline", async () => {
    vi.useFakeTimers();
    let world = act(createWorld(), "wait");
    const status = vi.fn();
    const request = vi.fn(
      (context) =>
        new Promise((resolve) =>
          setTimeout(() => resolve(response(context)), 22_000),
        ),
    );
    const narrator = createNarrator({
      getWorld: () => world,
      apply: (next) => {
        world = next;
      },
      status,
      request,
    });
    narrator.changed();
    await vi.advanceTimersByTimeAsync(22_000);
    expect(request).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenLastCalledWith("ready");
    expect(world.memories.vale.turn).toBe(world.turn);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([29_250, 29_750])(
    "keeps a failure at %ims from retrying after the scene deadline",
    async (failedAt) => {
      vi.useFakeTimers();
      let world = act(createWorld(), "take", "lamp");
      const before = structuredClone(world);
      const error = new Error("Late transport failure.");
      const status = vi.fn();
      const request = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((_, reject) =>
              setTimeout(() => reject(error), failedAt),
            ),
        )
        .mockImplementationOnce(async (context) => response(context));
      const narrator = createNarrator({
        getWorld: () => world,
        apply: (next) => {
          world = next;
        },
        status,
        request,
      });
      narrator.changed({ kind: "take", item: "lamp" });
      await vi.advanceTimersByTimeAsync(failedAt);
      expect(status).toHaveBeenLastCalledWith("retry", error);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(30_001 - failedAt);
      expect(request).toHaveBeenCalledTimes(1);
      expect(world).toEqual(before);

      expect(narrator.retry()).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(request).toHaveBeenCalledTimes(2);
      expect(
        request.mock.calls.map(([context]) => [context.turn, context.focus]),
      ).toEqual([
        [1, "lamp"],
        [1, "lamp"],
      ]);
      expect(world.actors).toEqual(before.actors);
      expect(world.items).toEqual(before.items);
      expect(world.revision).toBe(before.revision);
      expect(status).toHaveBeenLastCalledWith("ready");
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("does not start a transport when its retry pause resumes past the deadline", async () => {
    vi.useFakeTimers();
    let world = act(createWorld(), "wait");
    const before = structuredClone(world);
    const status = vi.fn();
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("Offline."))
      .mockImplementationOnce(async (context) => response(context));
    const narrator = createNarrator({
      getWorld: () => world,
      apply: (next) => {
        world = next;
      },
      status,
      request,
    });
    narrator.changed();
    await vi.advanceTimersByTimeAsync(0);
    expect(status).toHaveBeenLastCalledWith("pending");
    expect(vi.getTimerCount()).toBe(1);

    // The browser can suspend while a still-affordable retry pause is pending.
    vi.setSystemTime(Date.now() + 30_000);
    await vi.advanceTimersByTimeAsync(750);
    expect(request).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenLastCalledWith(
      "retry",
      expect.objectContaining({ message: "Story request timed out." }),
    );
    expect(world).toEqual(before);
    expect(vi.getTimerCount()).toBe(0);

    expect(narrator.retry()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map(([context]) => context.turn)).toEqual([1, 1]);
    expect(world.actors).toEqual(before.actors);
    expect(world.items).toEqual(before.items);
    expect(world.revision).toBe(before.revision);
    expect(status).toHaveBeenLastCalledWith("ready");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases the hand when a request is rejected by its input or access rules", async () => {
    vi.useFakeTimers();
    const status = vi.fn();
    const request = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("rejected"), { retryable: false }),
      );
    const narrator = createNarrator({
      getWorld: createWorld,
      apply: vi.fn(),
      status,
      request,
    });
    narrator.changed();
    await vi.advanceTimersByTimeAsync(0);
    expect(status).toHaveBeenLastCalledWith(
      "retry",
      expect.objectContaining({ message: "rejected" }),
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports a 429 as not retryable with its Retry-After", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", { status: 429, headers: { "retry-after": "10" } }),
      ),
    );
    await expect(requestNarrative({ speakers: [] })).rejects.toMatchObject({
      retryable: false,
      retryAfter: 10_000,
    });
    vi.unstubAllGlobals();
  });

  it("never retries a 429 and holds the next request for its Retry-After", async () => {
    vi.useFakeTimers();
    let world = createWorld();
    const status = vi.fn();
    const busy = Object.assign(new Error("busy"), {
      retryable: false,
      retryAfter: 10_000,
    });
    const request = vi
      .fn()
      .mockRejectedValueOnce(busy)
      .mockImplementation(async (context) => response(context));
    const narrator = createNarrator({
      getWorld: () => world,
      apply: (next) => {
        world = next;
      },
      status,
      request,
    });
    narrator.changed();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(request).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenLastCalledWith("retry", busy);
    expect(narrator.retry()).toBe(true);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(request).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenLastCalledWith("pending");
    await vi.advanceTimersByTimeAsync(1_001);
    expect(request).toHaveBeenCalledTimes(2);
    expect(status).toHaveBeenLastCalledWith("ready");
  });

  it("keeps one request in flight for an unchanged scene", async () => {
    vi.useFakeTimers();
    const request = vi.fn(() => new Promise(() => {}));
    const narrator = createNarrator({
      getWorld: createWorld,
      apply: vi.fn(),
      status: vi.fn(),
      request,
    });
    narrator.changed();
    narrator.changed();
    narrator.changed();
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    narrator.invalidate();
  });

  it("releases a stalled transport within thirty seconds and accepts the next scene", async () => {
    vi.useFakeTimers();
    let world = createWorld();
    const status = vi.fn(),
      apply = vi.fn((next) => {
        world = next;
      });
    const requests = [];
    const narrator = createNarrator({
      getWorld: () => world,
      apply,
      status,
      request: (context, signal, progress) =>
        new Promise((resolve) =>
          requests.push({ context, signal, progress, resolve }),
        ),
    });
    narrator.changed();
    await vi.advanceTimersByTimeAsync(15_750);
    expect(requests).toHaveLength(1);
    expect(requests[0].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(14_250);
    expect(status).toHaveBeenLastCalledWith(
      "retry",
      expect.objectContaining({ message: "Story request timed out." }),
    );
    expect(apply).not.toHaveBeenCalled();
    expect(requests[0].signal.aborted).toBe(true);
    requests[0].progress([{ id: "vale", text: "Old words" }]);
    requests[0].resolve(response(requests[0].context));
    await vi.advanceTimersByTimeAsync(0);
    expect(apply).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    world = act(world, "wait");
    narrator.changed();
    requests[1].resolve(response(requests[1].context));
    await vi.advanceTimersByTimeAsync(0);
    expect(status).toHaveBeenLastCalledWith("ready");
    expect(world.memories.vale.turn).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries failed dialogue without a world turn, keeps its focus and rejects duplicate retries", async () => {
    vi.useFakeTimers();
    let world = act(createWorld(), "take", "lamp");
    const before = structuredClone(world);
    const status = vi.fn();
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementationOnce(async (context) => response(context));
    const narrator = createNarrator({
      getWorld: () => world,
      apply: (next) => {
        world = next;
      },
      status,
      request,
    });
    narrator.changed({ kind: "take", item: "lamp" });
    await vi.advanceTimersByTimeAsync(750);
    expect(status).toHaveBeenLastCalledWith("retry", expect.any(Error));
    expect(world).toEqual(before);
    expect(narrator.retry()).toBe(true);
    expect(narrator.retry()).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(3);
    expect(
      request.mock.calls.map(([context]) => [context.turn, context.focus]),
    ).toEqual([
      [1, "lamp"],
      [1, "lamp"],
      [1, "lamp"],
    ]);
    expect(world.actors).toEqual(before.actors);
    expect(world.items).toEqual(before.items);
    expect(world.turn).toBe(before.turn);
    expect(world.revision).toBe(before.revision);
    expect(status).toHaveBeenLastCalledWith("ready");
    expect(narrator.retry()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not retry a failure after the saved world changes", async () => {
    vi.useFakeTimers();
    let world = createWorld();
    const request = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("offline"), { retryable: false }),
      );
    const narrator = createNarrator({
      getWorld: () => world,
      apply: vi.fn(),
      status: vi.fn(),
      request,
    });
    narrator.changed();
    await vi.advanceTimersByTimeAsync(0);
    world = act(world, "wait");
    expect(narrator.retry()).toBe(false);
    narrator.invalidate();
    expect(narrator.retry()).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("cancels a retry pause when a saved world is replaced", async () => {
    vi.useFakeTimers();
    let world = act(createWorld(), "wait");
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementationOnce(async (context) => response(context));
    const apply = vi.fn((next) => {
      world = next;
    });
    const narrator = createNarrator({
      getWorld: () => world,
      apply,
      status: vi.fn(),
      request,
    });
    narrator.changed();
    await vi.advanceTimersByTimeAsync(0);
    narrator.invalidate();
    world = createWorld();
    narrator.changed();
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(2);
    expect(world.turn).toBe(0);
    expect(world.memories.vale.turn).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(request).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("witnessed departures and conversation continuity", () => {
  it("gives Vale the first reaction to each available kind of play", () => {
    const held = createWorld();
    held.actors.moth.place = held.actors.keeper.place = "station";
    for (const item of ["lamp", "cloth"]) held.items[item].holder = "vale";
    held.items.lamp.fuel = 2;
    const lit = structuredClone(held);
    lit.items.lamp.lit = true;
    const ground = structuredClone(held);
    ground.items.lamp.holder = "station";
    const oil = structuredClone(held);
    oil.items.cloth.holder = "moth";
    oil.items.oil.holder = "vale";
    const bell = structuredClone(ground);
    bell.items.bell.holder = "vale";
    const seen = new Set();
    for (const world of [held, lit, ground, oil, bell, createWorld()]) {
      for (const action of legalActions(world)) {
        const result = play(world, action);
        expect(result.ok).toBe(true);
        expect(
          narrativeContext(result.state, action).speakers[0],
          action.kind,
        ).toBe("vale");
        seen.add(action.kind);
      }
    }
    for (const kind of [
      "wait",
      "light",
      "snuff",
      "take",
      "drop",
      "cover",
      "ring",
      "talk",
      "move",
    ])
      expect(seen.has(kind), kind).toBe(true);
  });
  it("lets Vale speak on Stay when nobody departs", () => {
    const world = act(atticOpening(), "wait");
    const context = narrativeContext(world);
    expect(context.speakers).toEqual(["vale"]);
    const next = applyGeneratedText(world, context, response(context));
    expect(
      next.log
        .filter((e) => e.generated && e.kind === "dialogue")
        .map((e) => e.actorId),
    ).toEqual(["vale"]);
  });

  it("places a departed avatar's words at the destination, not the origin", () => {
    const start = leavingStation("moth");
    start.actors.keeper.place = "attic";
    let world = act(start, "wait");
    expect(world.actors.moth.place).toBe("pond");
    const context = narrativeContext(world);
    expect(context.speakers).toEqual(["vale", "moth"]);
    expect(
      context.events.some((text) => text.includes("Pip goes to Black pond")),
    ).toBe(true);
    const pip = context.entities.find((e) => e.id === "moth");
    expect(pip.facts.join(" ")).toContain(
      "Leaving Empty station for Black pond",
    );
    expect(pip.facts.join(" ")).toContain("Location now: Black pond");
    const next = applyGeneratedText(world, context, response(context));
    const lines = next.log.filter(
      (e) => e.turn === next.turn && e.generated && e.kind === "dialogue",
    );
    expect(lines.map((e) => e.actorId)).toEqual(["vale", "moth"]);
    // The departure action stays at the origin; the later words do not.
    const words = lines.at(-1);
    expect(words).toMatchObject({
      actorId: "moth",
      arrivalFrom: "station",
      locationId: "pond",
    });
    expect(words.departureTo).toBeUndefined();
    expect(words.cast).toContain("moth");
    expect(words.cast).not.toContain("vale");
    expect(lines[0]).toMatchObject({ actorId: "vale", locationId: "station" });
    expect(lines[0].cast).not.toContain("moth");
    // Vale at the origin never sees the line; someone at the pond does.
    const here = (w) =>
      w.log
        .filter(
          (e) =>
            e.generated &&
            e.kind === "dialogue" &&
            e.turn === w.turn &&
            e.locationId === w.actors.vale.place,
        )
        .map((e) => e.actorId);
    expect(here(next)).toEqual(["vale"]);
    const atPond = structuredClone(next);
    atPond.actors.vale.place = "pond";
    expect(here(atPond)).toEqual(["moth"]);
    expect(next.memories.moth.text).toBe(words.text);
    expect(decodeSave(encodeSave(next))).toEqual(next);
    const later = act(next, "wait");
    expect(narrativeContext(later).speakers).not.toContain("moth");
  });
  it("keeps same-route solo arrivals separate from an accepted accompany play", () => {
    const world = createWorld();
    world.turn = world.revision = 1;
    for (const id of ["vale", "keeper"]) {
      world.actors[id].place = "pond";
      addLog(
        world,
        profiles[id].name,
        `${profiles[id].name} goes to Black pond.`,
        {
          kind: "action",
          actorId: id,
          verb: "move",
          targetId: "pond",
          fromLocationId: "station",
          locationId: "pond",
        },
      );
    }
    const solo = narrativeContext(world);
    for (const id of ["vale", "keeper"])
      expect(solo.outcome.avatars.find((a) => a.id === id).travel).toEqual({
        from: "station",
        to: "pond",
        companions: [],
      });
    world.log = world.log.filter((e) => e.turn !== 1);
    addLog(
      world,
      "Vale",
      "Vale and The keeper travel together to Black pond.",
      {
        kind: "action",
        actorId: "vale",
        verb: "accompany",
        targetId: "keeper",
        accepted: true,
        destinationId: "pond",
        fromLocationId: "station",
        locationId: "pond",
      },
    );
    const shared = narrativeContext(world);
    expect(
      shared.outcome.avatars.find((a) => a.id === "vale").travel.companions,
    ).toEqual(["keeper"]);
    expect(
      shared.outcome.avatars.find((a) => a.id === "keeper").travel.companions,
    ).toEqual(["vale"]);
  });

  it("gives both arrivals a voice, with one ordered exchange for the next turn", () => {
    const start = createWorld();
    start.actors.moth.want = wantPlace("station");
    start.actors.keeper.want = wantPlace("station");
    let world = act(start, "wait");
    let context = narrativeContext(world);
    expect(context.speakers).toEqual(["vale", "moth", "keeper"]);
    world = applyGeneratedText(world, context, response(context));
    expect(
      world.log
        .filter((e) => e.arrivalFrom)
        .map((e) => [e.actorId, e.arrivalFrom]),
    ).toEqual([
      ["moth", "pond"],
      ["keeper", "pond"],
    ]);
    world = act(world, "talk", null, "keeper");
    context = narrativeContext(world);
    expect(context.conversation.map((e) => e.actorId)).toEqual([
      "vale",
      "moth",
      "keeper",
    ]);
    expect(context.speakers.slice(0, 2)).toEqual(["vale", "keeper"]);
    expect(
      context.entities.every(
        (e) =>
          e.facts.length <= 16 && e.facts.every((fact) => fact.length <= 240),
      ),
    ).toBe(true);
  });
  it("lets Vale lead Stay and keeps the chosen partner before departures", () => {
    const world = act(leavingStation("keeper"), "wait");
    expect(world.actors.moth.place).toBe("station");
    expect(world.actors.keeper.place).toBe("pond");
    expect(narrativeContext(world).speakers).toEqual(["vale", "keeper"]);
    expect(narrativeContext(world, { target: "moth" }).speakers).toEqual([
      "vale",
      "moth",
      "keeper",
    ]);
  });
  it("handles two departures and removes each speaker from later casts", () => {
    const world = act(leavingStation("moth", "keeper"), "wait");
    const context = narrativeContext(world);
    expect(context.speakers).toEqual(["vale", "moth", "keeper"]);
    // A partner who left after another avatar speaks after that departure,
    // so it never mentions someone gone who is still on screen.
    expect(narrativeContext(world, { target: "keeper" }).speakers).toEqual([
      "vale",
      "moth",
      "keeper",
    ]);
    const next = applyGeneratedText(world, context, response(context));
    const departed = next.log.filter((e) => e.generated && e.arrivalFrom);
    expect(departed.map((e) => [e.actorId, e.locationId])).toEqual([
      ["moth", "pond"],
      ["keeper", "pond"],
    ]);
    for (const line of departed)
      expect(line.cast).toEqual(expect.arrayContaining(["moth", "keeper"]));
    expect(
      next.log.filter(
        (e) => e.generated && e.turn === next.turn && e.locationId === "station",
      ).every((e) => !e.cast.includes("moth") && !e.cast.includes("keeper")),
    ).toBe(true);
  });
  it("includes a retreating opponent's answer with the witnessed result", () => {
    let world = createWorld();
    world.actors.moth.place = "station";
    world.items.lamp.holder = "moth";
    // Vale outranks Pip, so Pip braces rather than answering with words,
    // which would end the standoff.
    world.actors.vale.xp = 3;
    world = act(world, "threaten", null, "moth");
    world.standoffs[0].resolve.moth = 1;
    world = act(world, "attack", null, "moth");
    const context = narrativeContext(world);
    expect(context.speakers[0]).toBe("vale");
    expect(context.speakers).toContain("moth");
    expect(context.action).toContain("retreats");
    const next = applyGeneratedText(world, context, response(context));
    expect(
      next.log.findLast((e) => e.generated && e.actorId === "moth"),
    ).toMatchObject({ arrivalFrom: "station", locationId: "pond" });
  });
  it("validates saved movement captions and preserves old generated lines", () => {
    const world = createWorld(),
      context = narrativeContext(world);
    const next = applyGeneratedText(world, context, response(context));
    expect(decodeSave(encodeSave(next))).toEqual(next);
    for (const patch of [
      { departureTo: "wrong" },
      { departureTo: "station" },
      { departureTo: "pond", arrivalFrom: "attic" },
    ]) {
      const bad = structuredClone(next);
      Object.assign(bad.log.at(-1), patch);
      expect(() => decodeSave(JSON.stringify(bad))).toThrow();
    }
  });
});

describe("speech grounding in resolved card plays", () => {
  const avatar = (outcome, id) => outcome.avatars.find((a) => a.id === id);
  const choose = (world, predicate) => {
    const action = legalActions(world).find(predicate);
    expect(action).toBeTruthy();
    const result = play(world, action);
    expect(result.ok).toBe(true);
    return result.state;
  };
  // Pip wants to be at the pond, so a trip there is on Pip's way.
  const together = () => {
    const world = createWorld();
    world.actors.moth.place = "station";
    world.actors.moth.want = wantPlace("pond");
    world.items.lamp.holder = "vale";
    return world;
  };

  it("keeps a solo departure separate from a wish and an earlier spoken promise", () => {
    let world = leavingStation();
    world.actors.keeper.place = "attic";
    world = act(world, "wait");
    const context = narrativeContext(world),
      generated = response(context);
    generated.entries.find((e) => e.id === "moth").text =
      "I will go with you to the pond, Vale.";
    world = applyGeneratedText(
      world,
      { ...context, speakers: ["vale", "moth"] },
      generated,
    );
    world.actors.moth.want = wantPlace("pond");
    world = act(world, "wait");
    const next = narrativeContext(world),
      outcome = next.outcome;
    expect(
      next.conversation.some((line) => line.text.includes("go with you")),
    ).toBe(true);
    expect(outcome.card.kind).toBe("wait");
    expect(avatar(outcome, "vale")).toMatchObject({
      location: "station",
      travel: null,
    });
    expect(avatar(outcome, "moth")).toMatchObject({
      location: "pond",
      travel: { from: "station", to: "pond", companions: [] },
    });
    // Pip's want stays unsaid: nobody talked with Pip this turn.
    expect(next.entities.find((e) => e.id === "moth").desire.location).toBe(
      null,
    );
    expect(
      next.entities.find((e) => e.id === "moth").facts.join(" "),
    ).toContain("Location now: Black pond. Company now: alone.");
    expect(narrativeContext(decodeSave(encodeSave(world))).outcome).toEqual(
      outcome,
    );
  });

  it("records both travellers only when the accompany request was accepted", () => {
    const world = choose(
      together(),
      (a) =>
        a.kind === "accompany" &&
        a.target === "moth" &&
        a.destination === "pond",
    );
    const outcome = turnOutcome(world);
    expect(outcome.card).toMatchObject({
      kind: "accompany",
      target: "moth",
      destination: "pond",
      accepted: true,
    });
    expect(avatar(outcome, "vale").travel).toEqual({
      from: "station",
      to: "pond",
      companions: ["moth"],
    });
    expect(avatar(outcome, "moth").travel).toEqual({
      from: "station",
      to: "pond",
      companions: ["vale"],
    });
    const later = turnOutcome(act(world, "wait"));
    expect(later.card.kind).toBe("wait");
    expect(avatar(later, "vale").travel).toBeNull();
  });

  it("keeps a declined destination separate from both avatars' actual location", () => {
    const start = together();
    start.actors.vale.place = start.actors.moth.place = "pond";
    start.items.lamp.lit = true;
    const world = choose(
      start,
      (a) =>
        a.kind === "accompany" &&
        a.target === "moth" &&
        a.destination === "attic",
    );
    const outcome = turnOutcome(world);
    expect(outcome.card).toMatchObject({
      kind: "accompany",
      destination: "attic",
      accepted: false,
    });
    for (const id of ["vale", "moth"])
      expect(avatar(outcome, id)).toMatchObject({
        location: "pond",
        travel: null,
      });
  });

  it("keeps independent trips on the same route separate", () => {
    const start = together();
    start.actors.vale.place = start.actors.moth.place = "attic";
    start.items.lamp.holder = "moth";
    const outcome = turnOutcome(act(start, "move", null, "pond"));
    for (const id of ["vale", "moth"])
      expect(avatar(outcome, id).travel).toEqual({
        from: "attic",
        to: "pond",
        companions: [],
      });
    expect(outcome.card.kind).toBe("move");
  });

  it("uses final item ownership after a request and the cast's actions", () => {
    let world = act(createWorld(), "take", "lamp");
    world = act(world, "ask", "cloth", "moth");
    const outcome = turnOutcome(world);
    expect(outcome.card).toMatchObject({
      kind: "ask",
      item: "cloth",
      target: "moth",
    });
    for (const item of outcome.items) {
      expect(item.holder).toBe(world.items[item.id].holder);
    }
    for (const actor of outcome.avatars) {
      expect(actor.holding).toEqual(
        Object.keys(world.items).filter(
          (id) => world.items[id].holder === actor.id,
        ),
      );
    }
  });

  it("gives an opening state and includes actors outside the dialogue scene", () => {
    const outcome = turnOutcome(createWorld());
    expect(outcome.card.kind).toBe("arrive");
    expect(outcome.avatars).toHaveLength(3);
    // The forest's four things and the Hoppy Cat spool at the station (#1641).
    expect(outcome.items).toHaveLength(5);
    expect(avatar(outcome, "moth")).toMatchObject({
      location: "pond",
      travel: null,
    });
    expect(avatar(outcome, "keeper")).toMatchObject({
      location: "pond",
      travel: null,
    });
  });
});

describe("saved character inner lives", () => {
  it("saves separate model attribution, dreams and evolving personas and recalls them after reload", () => {
    const world = rest(act(createWorld(), "take", "lamp"), { dream: true });
    const context = narrativeContext(world);
    const generated = response(context);
    const vale = generated.entries.find((entry) => entry.id === "vale");
    vale.model = "vale-specific-model";
    vale.reflection = {
      thought: "Someone trusted me with their light.",
      persona: "I remain curious and proud, but gifts make me more patient.",
      dream: "A lamp became a tiny sun above the shore.",
    };
    const next = applyGeneratedText(world, context, generated);
    const restored = decodeSave(encodeSave(next));
    expect(restored.memories.vale.model).toBe("vale-specific-model");
    expect(restored.memories.vale.innerLife.persona).toContain(
      "gifts make me more patient",
    );
    expect(restored.memories.vale.innerLife.dreams).toEqual([
      { turn: world.turn, text: vale.reflection.dream },
    ]);
    expect(restored.memories.keeper.innerLife).toBeUndefined();
    const recalled = narrativeContext(restored).entities.find(
      (e) => e.id === "vale",
    );
    expect(recalled.inner_life).toEqual(restored.memories.vale.innerLife);
    expect(
      restored.memories.vale.events.some((event) =>
        event.text.includes("tiny sun"),
      ),
    ).toBe(false);
    expect(restored.log.some((entry) => entry.text.includes("tiny sun"))).toBe(
      false,
    );
  });

  it("rejects early repeated growth, invalid private text and reflections on scenery", () => {
    // Only the avatar who waited reflects; a first thought comes without a dream.
    const busy = act(createWorld(), "take", "lamp");
    const busyContext = narrativeContext(busy);
    const early = response(busyContext);
    early.entries.find((e) => e.id === "vale").reflection = {
      thought: "I felt welcome.",
      persona: "I am learning to share.",
    };
    expect(() => applyGeneratedText(busy, busyContext, early)).toThrow();
    const first = rest(busy);
    const firstContext = narrativeContext(first);
    const dreamy = response(firstContext);
    dreamy.entries.find((e) => e.id === "vale").reflection = {
      ...early.entries.find((e) => e.id === "vale").reflection,
      dream: "A lamp floated above the pond.",
    };
    expect(() => applyGeneratedText(first, firstContext, dreamy)).toThrow();
    let world = rest(busy, { dream: true });
    let context = narrativeContext(world);
    let generated = response(context);
    const reflection = {
      thought: "I felt welcome.",
      persona: "I am learning to share.",
      dream: "A lamp floated above the pond.",
    };
    generated.entries.find((e) => e.id === "vale").reflection = reflection;
    world = applyGeneratedText(world, context, generated);
    context = narrativeContext(world);
    generated = response(context);
    generated.entries.find((e) => e.id === "vale").reflection = reflection;
    expect(() => applyGeneratedText(world, context, generated)).toThrow();
    generated = response(context);
    generated.entries.find((e) => profiles[e.id].kind !== "avatar").reflection =
      reflection;
    expect(() => applyGeneratedText(world, context, generated)).toThrow();
    const corrupt = structuredClone(world);
    corrupt.memories.vale.innerLife.dreams[0].turn = world.turn + 1;
    expect(() => decodeSave(JSON.stringify(corrupt))).toThrow();
  });
});
