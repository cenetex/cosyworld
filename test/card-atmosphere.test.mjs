import { describe, expect, it } from "vitest";
import { createWorld, decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import {
  applyGeneratedText,
  narrativeContext,
  sceneryDue,
} from "../v2/card-game/narrative.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { sharedContext } from "../v2/card-game/shared-narrator.mjs";

describe("occasional location atmosphere", () => {
  it("chooses one varied turn per block with space between captions", () => {
    const selected = [];
    for (let turn = 0; turn < 2048; turn++)
      if (sceneryDue(turn)) selected.push(turn);
    expect(selected[0]).toBe(0);
    expect(selected).toHaveLength(512);
    const gaps = selected.slice(1).map((turn, i) => turn - selected[i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(3);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(5);
    expect(new Set(gaps).size).toBeGreaterThan(1);
    for (let block = 1; block < 512; block++)
      expect(
        selected.filter((turn) => Math.floor(turn / 4) === block),
      ).toHaveLength(1);
  });

  it("keeps the same choice through repeat requests, saved copies and shared clients", () => {
    const world = createWorld();
    for (let turn = 0; turn < 40; turn++) {
      world.turn = world.revision = turn;
      const choice = narrativeContext(world).scenery;
      expect(narrativeContext(world).scenery).toBe(choice);
      expect(narrativeContext({ ...world, revision: turn + 5 }).scenery).toBe(
        choice,
      );
      expect(narrativeContext(decodeSave(encodeSave(world))).scenery).toBe(
        choice,
      );
      const request = {
        world,
        actor: "vale",
        claimed: ["vale"],
        present: ["vale"],
      };
      // The authenticated host obtains the same context for the committed turn.
      expect(sharedContext(request).scenery).toBe(choice);
    }
  });

  it("keeps complete actor dialogue on quiet turns and leaves the room's saved words alone", () => {
    const world = createWorld();
    world.turn = world.revision = 1;
    const context = narrativeContext(world);
    expect(context.scenery).toBe(false);
    const response = {
      revision: context.revision,
      model: "fixture",
      entries: context.speakers.map((id) => ({
        id,
        text: "The lamp is within reach.",
      })),
      omitted: context.entities
        .filter((e) => !context.speakers.includes(e.id))
        .map((e) => e.id),
    };
    const result = applyGeneratedText(world, context, response);
    expect(result.log.at(-1).actorId).toBe("vale");
    expect(result.memories[context.location].text).toBe(
      world.memories[context.location].text,
    );
    expect(result.memories[context.location].turn).toBe(
      world.memories[context.location].turn,
    );
    expect(
      result.log.filter((e) => e.generated && e.entityId === context.location),
    ).toEqual([]);
    // An older response can still carry a place description; this turn stays quiet.
    response.entries.push({
      id: context.location,
      text: "Dust lies across the boards.",
    });
    response.omitted = response.omitted.filter((id) => id !== context.location);
    expect(
      applyGeneratedText(world, context, response).memories[context.location]
        .text,
    ).toBe(world.memories[context.location].text);
  });

  it("commits and reloads a shared actor-only reply", () => {
    const world = dispatchShared({ op: "create" }).world;
    const room = world.actors.vale.place;
    const line = {
      actorId: "vale",
      entityId: "vale",
      speaker: "Vale",
      text: "The boards feel cold.",
    };
    const request = {
      op: "speech",
      world,
      actor: "vale",
      claimed: ["vale"],
      present: ["vale"],
      room,
      lines: [line],
    };
    const result = dispatchShared(request);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({
      actorId: "vale",
      kind: "dialogue",
      text: line.text,
    });
    expect(decodeSave(encodeSave(result.world)).log.at(-1)).toEqual(
      result.lines[0],
    );
    expect(() =>
      dispatchShared({
        ...request,
        lines: [{ ...line, actorId: null, entityId: room }],
      }),
    ).toThrow();
    expect(() => dispatchShared({ ...request, lines: [] })).toThrow();
  });
});
