import { describe, it, expect, vi, afterEach } from "vitest";
afterEach(() => vi.useRealTimers());
import {
  createWorld,
  legalActions,
  play,
  encodeSave,
  decodeSave,
} from "../v2/card-game/world.mjs";
import {
  narrativeContext,
  turnOutcome,
  applyGeneratedText,
  createNarrator,
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

describe("entity memories and model text", () => {
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
    expect(
      context.entities.find((e) => e.id === "moth").desire.items,
    ).toContain("lamp");
    expect(
      context.entities
        .find((e) => e.id === "lamp")
        .memories.some((e) => e.text.includes("Vale takes")),
    ).toBe(true);
    const vale = context.entities.find((e) => e.id === "vale");
    expect(vale.facts.join(" ")).toContain(
      "Wants Oil flask, currently with The keeper",
    );
    expect(context.entities.every((e) => e.facts.length <= 8)).toBe(true);
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

  it("migrates old saves and retains quest progress and item histories", () => {
    const world = act(createWorld(), "take", "lamp");
    const old = structuredClone(world);
    old.schema = 3;
    delete old.memories;
    const restored = decodeSave(JSON.stringify(old));
    expect(restored.schema).toBe(5);
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

  it("coalesces fast plays and keeps reset worlds clear of late replies", async () => {
    let world = act(createWorld(), "wait");
    const requests = [],
      apply = vi.fn((next) => {
        world = next;
      });
    const narrator = createNarrator({
      getWorld: () => world,
      apply,
      status: vi.fn(),
      request: (context) =>
        new Promise((resolve) => requests.push({ context, resolve })),
    });
    narrator.changed();
    world = act(world, "wait");
    narrator.changed();
    world = act(world, "wait");
    narrator.changed();
    expect(requests).toHaveLength(1);
    requests[0].resolve(response(requests[0].context));
    await flush();
    expect(apply).not.toHaveBeenCalled();
    expect(requests).toHaveLength(2);
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
    expect(status).toHaveBeenLastCalledWith("retry");
    expect(request).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
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
    expect(requests).toHaveLength(2);
    expect(requests[0].signal.aborted).toBe(true);
    requests[0].progress([{ id: "vale", text: "Old words" }]);
    requests[0].resolve(response(requests[0].context));
    await vi.advanceTimersByTimeAsync(14_250);
    expect(status).toHaveBeenLastCalledWith("retry");
    expect(apply).not.toHaveBeenCalled();
    expect(requests[1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    world = act(world, "wait");
    narrator.changed();
    requests[2].resolve(response(requests[2].context));
    await vi.advanceTimersByTimeAsync(0);
    expect(status).toHaveBeenLastCalledWith("ready");
    expect(world.memories.vale.turn).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
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
  it("keeps a departing avatar's farewell in the source scene and in memory", () => {
    let world = createWorld();
    for (let i = 0; i < 4; i++) world = act(world, "wait");
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
    expect(pip.facts.join(" ")).toContain("currently at Black pond");
    const next = applyGeneratedText(world, context, response(context));
    const farewell = next.log.at(-1);
    expect(farewell).toMatchObject({
      actorId: "moth",
      departureTo: "pond",
      locationId: "station",
      cast: ["vale", "moth"],
    });
    expect(currentScene(next, next.log.length - 1).slots).toEqual([
      "vale",
      "moth",
    ]);
    expect(currentScene(next).slots).toEqual(["vale", null]);
    expect(next.memories.vale.events.at(-1).text).toContain("Pip remembers");
    expect(sceneScript(next).beats.at(-1).departureTo).toBe("pond");
    expect(decodeSave(encodeSave(next))).toEqual(next);
    const later = act(next, "wait");
    expect(narrativeContext(later).speakers).not.toContain("moth");
  });
  it("gives both arrivals a voice, with one ordered exchange for the next turn", () => {
    let world = act(createWorld(), "wait");
    let context = narrativeContext(world);
    expect(context.speakers).toEqual(["vale", "moth", "keeper"]);
    world = applyGeneratedText(world, context, response(context));
    expect(
      world.log
        .filter((e) => e.arrivalFrom)
        .map((e) => [e.actorId, e.arrivalFrom]),
    ).toEqual([
      ["moth", "pond"],
      ["keeper", "attic"],
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
          e.facts.length <= 8 && e.facts.every((fact) => fact.length <= 240),
      ),
    ).toBe(true);
  });
  it("lets a departure lead a quiet turn and keeps an explicit partner first", () => {
    let world = createWorld();
    for (let i = 0; i < 3; i++) world = act(world, "wait");
    expect(world.actors.moth.place).toBe("station");
    expect(world.actors.keeper.place).toBe("attic");
    expect(narrativeContext(world).speakers).toEqual(["vale", "keeper"]);
    expect(narrativeContext(world, { target: "moth" }).speakers).toEqual([
      "vale",
      "moth",
      "keeper",
    ]);
  });
  it("handles two departures and removes each speaker from later casts", () => {
    let world = act(createWorld(), "wait");
    world.items.lamp.holder = "moth";
    world.items.lamp.lit = true;
    world.items.bell.holder = "keeper";
    world = act(world, "wait");
    const context = narrativeContext(world);
    expect(context.speakers).toEqual(["vale", "moth", "keeper"]);
    const next = applyGeneratedText(world, context, response(context));
    const farewells = next.log.filter((e) => e.departureTo);
    expect(farewells.map((e) => e.departureTo)).toEqual(["pond", "attic"]);
    expect(farewells[0].cast).toContain("moth");
    expect(farewells[1].cast).not.toContain("moth");
    expect(farewells[1].cast).toContain("keeper");
  });
  it("includes a retreating opponent's answer with the witnessed result", () => {
    let world = createWorld();
    world.actors.moth.place = "station";
    world.items.lamp.holder = "moth";
    world = act(world, "threaten", null, "moth");
    world.standoffs[0].resolve.moth = 1;
    world = act(world, "attack", null, "moth");
    const context = narrativeContext(world);
    expect(context.speakers).toContain("moth");
    expect(context.action).toContain("retreats");
    const next = applyGeneratedText(world, context, response(context));
    expect(
      next.log.findLast((e) => e.generated && e.actorId === "moth"),
    ).toMatchObject({ departureTo: "attic", locationId: "station" });
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
  const together = () => {
    const world = createWorld();
    world.actors.moth.place = "station";
    world.items.lamp.holder = "vale";
    return world;
  };

  it("keeps a solo departure separate from a wish and an earlier spoken promise", () => {
    let world = createWorld();
    for (let i = 0; i < 3; i++) world = act(world, "wait");
    const context = narrativeContext(world),
      generated = response(context);
    generated.entries.find((e) => e.id === "moth").text =
      "I will go with you to the pond, Vale.";
    world = applyGeneratedText(
      world,
      { ...context, speakers: ["vale", "moth"] },
      generated,
    );
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
    expect(next.entities.find((e) => e.id === "moth").desire.avatars).toContain(
      "vale",
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
    const world = choose(
      together(),
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
        location: "station",
        travel: null,
      });
  });

  it("keeps independent trips on the same route separate", () => {
    const start = together();
    start.actors.vale.place = start.actors.moth.place = "attic";
    start.items.lamp.holder = "moth";
    start.items.lamp.lit = true;
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
    expect(outcome.items).toHaveLength(4);
    expect(avatar(outcome, "moth")).toMatchObject({
      location: "pond",
      travel: null,
    });
    expect(avatar(outcome, "keeper")).toMatchObject({
      location: "attic",
      travel: null,
    });
  });
});
