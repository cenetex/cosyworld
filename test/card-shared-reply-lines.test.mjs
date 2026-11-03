import { describe, expect, it } from "vitest";
import speech from "../v2/card-game/speech.json" with { type: "json" };
import { dispatchShared } from "../v2/card-game/shared-world.mjs";

// A speech occasion may voice only the target (a threat, a refusal, a new
// companion) or only the place. The shared rules must publish those lines.
describe("shared speech from an occasion's own voices", () => {
  const scene = () => {
    const world = dispatchShared({ op: "create" }).world;
    world.actors.moth.place = world.actors.rue.place = "station";
    return world;
  };
  const request = (world, lines) => ({
    op: "speech",
    actor: "rue",
    claimed: ["rue"],
    present: ["rue"],
    world,
    room: "station",
    lines,
  });

  it("publishes Pip's lone reply when Rue squares up to him", () => {
    expect(speech.threatened).toEqual(["target"]);
    const result = dispatchShared(
      request(scene(), [
        { actorId: "moth", entityId: "moth", text: "Keep your threats, Rue." },
      ]),
    );
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ actorId: "moth" });
  });

  it("publishes a lone place caption and a full occasion of voices", () => {
    expect(
      dispatchShared(
        request(scene(), [
          { entityId: "station", text: "Rain ticks on the platform roof." },
        ]),
      ).lines,
    ).toHaveLength(1);
    const world = scene();
    world.actors.vale.place = "station";
    expect(
      dispatchShared(
        request(world, [
          { actorId: "rue", text: "This is my cloth." },
          { actorId: "moth", text: "It shines too well." },
          { actorId: "vale", text: "Both of you, breathe." },
          { entityId: "station", text: "A bell rings once." },
        ]),
      ).lines,
    ).toHaveLength(4);
  });

  it("still refuses an absent speaker or a fifth line", () => {
    const world = scene();
    world.actors.moth.place = "pond";
    expect(() =>
      dispatchShared(
        request(world, [{ actorId: "moth", text: "I am not here." }]),
      ),
    ).toThrow("present speaker");
    expect(() =>
      dispatchShared(
        request(scene(), Array(5).fill({ actorId: "rue", text: "Again." })),
      ),
    ).toThrow("one to four lines");
  });
});
