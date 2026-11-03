import { describe, expect, it } from "vitest";
import speech from "../v2/card-game/speech.json" with { type: "json" };
import { dispatchShared } from "../v2/card-game/shared-world.mjs";

// A speech occasion may voice only the target (a threat, a refusal, a new
// companion) or only the place. The shared rules must publish those lines,
// and from rules 93 only the voices the committed play named, once each.
describe("shared speech from an occasion's own voices", () => {
  const seat = (actor) => ({ actor, claimed: [actor], present: [actor] });
  const scene = (setup = () => {}) => {
    const world = dispatchShared({ op: "create" }).world;
    world.actors.moth.place = world.actors.rue.place = "station";
    setup(world);
    return world;
  };
  // Rue plays a card; the speech that follows belongs to it.
  const played = (world, kind, target) => {
    const { actions } = dispatchShared({ op: "view", world, ...seat("rue") });
    const action = actions.find((a) => a.kind === kind && a.target === target);
    expect(action, `${kind} ${target}`).toBeTruthy();
    const result = dispatchShared({
      op: "play",
      world,
      ...seat("rue"),
      action,
    });
    expect(result.error).toBeUndefined();
    return result.world;
  };
  const request = (world, lines) => ({
    op: "speech",
    ...seat("rue"),
    world,
    room: "station",
    lines,
  });
  const pip = { actorId: "moth", entityId: "moth", text: "Keep your threats." };

  it("publishes Pip's lone reply when Rue squares up to him", () => {
    expect(speech.threatened).toEqual(["target"]);
    const result = dispatchShared(
      request(played(scene(), "threaten", "moth"), [pip]),
    );
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ actorId: "moth" });
  });

  it("publishes a lone place caption and a full occasion of voices", () => {
    // The opening voices Rue and the place; either may speak alone.
    expect(
      dispatchShared(
        request(scene(), [
          { entityId: "station", text: "Rain ticks on the platform roof." },
        ]),
      ).lines,
    ).toHaveLength(1);
    expect(
      dispatchShared(
        request(scene(), [
          { actorId: "rue", text: "This is my cloth." },
          { entityId: "station", text: "A bell rings once." },
        ]),
      ).lines,
    ).toHaveLength(2);
    // Talk voices Rue and Pip.
    expect(
      dispatchShared(
        request(played(scene(), "talk", "moth"), [
          { actorId: "rue", text: "This is my cloth." },
          { actorId: "moth", text: "It shines too well." },
        ]),
      ).lines,
    ).toHaveLength(2);
    // The room may caption any play.
    const threatened = played(scene(), "threaten", "moth");
    expect(
      dispatchShared(
        request(threatened, [
          pip,
          { entityId: "station", text: "A bell rings once." },
        ]),
      ).lines,
    ).toHaveLength(2);
  });

  it("refuses a voice the play never named, or one voice twice", () => {
    const threatened = played(
      scene((w) => (w.actors.vale.place = "station")),
      "threaten",
      "moth",
    );
    // Vale is present, but the threat voices only Pip and the room.
    for (const lines of [
      [{ actorId: "vale", text: "Both of you, breathe." }],
      [pip, { actorId: "vale", text: "Both of you, breathe." }],
      [{ actorId: "rue", text: "Give it here." }],
      [pip, pip],
      [
        { entityId: "station", text: "A bell rings once." },
        { entityId: "station", text: "A bell rings twice." },
      ],
    ])
      expect(() => dispatchShared(request(threatened, lines))).toThrow(
        "Each voice the play named speaks once.",
      );
  });

  it("keeps a defeat's host after a human enters before its speech", () => {
    // Mara is locked away at the pond, where Ada lives as a resident.
    const world = dispatchShared({ op: "create", absent: ["mara"] }).world;
    world.actors.moth.place = world.actors.rue.place = "station";
    world.actors.ada.place = world.actors.mara.place = "pond";
    world.items.lamp.holder = "rue";
    world.turn = world.revision = 2;
    const pair = (rue, moth) => ({ rue, moth });
    world.standoffs = [
      {
        ...{ challenger: "moth", defender: "rue", location: "station" },
        ...{ item: "lamp", opened: 1, answered: true, hitBy: { moth: "rue" } },
        resolve: pair(1, 4),
        guarding: pair(false, false),
        struck: pair(true, true),
        steppedBack: pair(false, false),
      },
    ];
    // Rue guards, is struck down and comes to at the pond: Ada hosts.
    const { actions } = dispatchShared({ op: "view", world, ...seat("rue") });
    const guard = actions.find((a) => a.kind === "guard");
    const beaten = dispatchShared({
      op: "play",
      world,
      ...seat("rue"),
      action: guard,
    });
    expect(beaten.world.actors.rue.place).toBe("pond");
    // Mara is claimed and arrives before the defeat's words come back.
    const both = { claimed: ["rue", "mara"], present: ["rue", "mara"] };
    const joined = dispatchShared({
      op: "join",
      world: beaten.world,
      actor: "mara",
      ...both,
    }).world;
    const result = dispatchShared({
      op: "speech",
      world: joined,
      actor: "rue",
      ...both,
      room: "pond",
      lines: [{ actorId: "ada", text: "Rest here a while." }],
    });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ actorId: "ada" });
  });

  it("still refuses an absent speaker or a fifth line", () => {
    expect(() =>
      dispatchShared(
        request(
          scene((w) => (w.actors.moth.place = "pond")),
          [pip],
        ),
      ),
    ).toThrow("speaks once");
    expect(() =>
      dispatchShared(
        request(scene(), Array(5).fill({ actorId: "rue", text: "Again." })),
      ),
    ).toThrow("one to four lines");
  });
});
