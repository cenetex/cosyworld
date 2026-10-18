import { describe, it, expect, vi } from "vitest";
import {
  createWorld,
  legalActions,
  play,
  encodeSave,
  decodeSave,
} from "../v2/card-game/world.mjs";
import {
  narrativeContext,
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
    for (const id of ["station", "lamp", "moth"]) {
      expect(next.memories[id].text).toContain("remembers");
      expect(next.log.some((e) => e.entityId === id && e.generated)).toBe(true);
    }
    expect(currentScene(next).line.generated).toBe(true);
    expect(sceneScript(next).memories).toEqual(next.memories);
    expect(decodeSave(encodeSave(next))).toEqual(next);
  });

  it("migrates old saves and retains quest progress and item histories", () => {
    const world = act(createWorld(), "take", "lamp");
    const old = structuredClone(world);
    old.schema = 3;
    delete old.memories;
    const restored = decodeSave(JSON.stringify(old));
    expect(restored.schema).toBe(4);
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

  it("keeps play available after a provider failure and tries the next play", async () => {
    let world = act(createWorld(), "wait");
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
    await flush();
    expect(status).toHaveBeenLastCalledWith("retry");
    world = act(world, "wait");
    narrator.changed();
    await flush();
    expect(status).toHaveBeenLastCalledWith("ready");
    expect(world.memories.station.turn).toBe(2);
  });
});
