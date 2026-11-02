import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import {
  applyGeneratedText,
  narrativeContext,
  voicesNobody,
} from "../v2/card-game/narrative.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { sharedContext } from "../v2/card-game/shared-narrator.mjs";

describe("occasional location atmosphere", () => {
  it("captions a place at the opening and on the avatar's first arrival only", () => {
    let world = createWorld();
    expect(narrativeContext(world)).toMatchObject({
      occasion: "opening",
      scenery: true,
    });
    const from = world.actors.vale.place;
    const travel = (to) =>
      play(
        world,
        legalActions(world).find(
          (a) => a.kind === "move" && (!to || a.target === to),
        ),
      ).state;
    world = travel();
    const first = narrativeContext(world);
    expect(first).toMatchObject({ occasion: "new_place", scenery: true });
    expect(first.speakers).toEqual([]);
    world = travel(from);
    // A return is routine travel: no caption and no request.
    expect(narrativeContext(world).scenery).toBe(false);
    expect(voicesNobody(narrativeContext(world))).toBe(true);
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

  it("keeps a quiet turn silent and leaves the room's saved words alone", () => {
    const world = createWorld();
    world.turn = world.revision = 1;
    const context = narrativeContext(world);
    expect(context.scenery).toBe(false);
    expect(voicesNobody(context)).toBe(true);
    // An older response can still carry a place description; this turn stays quiet.
    const response = {
      revision: context.revision,
      model: "fixture",
      entries: [{ id: context.location, text: "Dust lies across the boards." }],
      omitted: context.entities
        .filter((e) => e.id !== context.location)
        .map((e) => e.id),
    };
    const result = applyGeneratedText(world, context, response);
    expect(result.memories[context.location]).toEqual(
      world.memories[context.location],
    );
    expect(
      result.log.filter((e) => e.generated && e.entityId === context.location),
    ).toEqual([]);
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
