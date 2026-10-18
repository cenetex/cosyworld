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
