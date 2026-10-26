import { describe, expect, it } from "vitest";
import { sharedLiveLine, sharedSpeechState } from "../v2/card-game/shared.mjs";
import { createWorld, currentActor } from "../v2/card-game/world.mjs";
import { availableCards } from "../v2/card-game/cards.mjs";
import {
  currentScene,
  sceneCast,
  sceneStaging,
  portrait,
} from "../v2/card-game/scene.mjs";
function shared() {
  const world = createWorld();
  world.sharedVersion = 1;
  world.controlledActors = ["vale", "mara", "ash", "nell", "tavi"];
  world.presentActors = [...world.controlledActors];
  world.playerActorId = "mara";
  for (const id of world.controlledActors) {
    world.actors[id] ||= structuredClone(world.actors.vale);
    world.actors[id].place = "station";
  }
  return world;
}

describe("the existing card table seen by a shared avatar", () => {
  it("keeps Vale's solo viewpoint and original art", () => {
    const world = createWorld();
    expect(currentActor(world)).toBe("vale");
    expect(currentScene(world).background).toBe("./assets/station.png");
    expect(portrait("vale", null, world)).toBe("./assets/vale.png");
  });
  it("uses the claimed person's room without changing Vale's location", () => {
    const world = shared();
    world.actors.mara.place = "pond";
    expect(currentScene(world).background).toBe("./assets/pond.png");
    expect(availableCards(world)).toContain("mara");
    expect(availableCards(world)).not.toContain("vale");
    expect(world.actors.vale.place).toBe("station");
    expect(portrait("mara", null, world)).toContain(
      "assets/shared/characters/mara.png",
    );
  });
  it("hides a full linked room and restores its card when a place opens", () => {
    const world = shared();
    world.actors.mara.place = "pond";
    expect(availableCards(world)).not.toContain("station");
    world.presentActors = world.presentActors.filter((id) => id !== "tavi");
    expect(availableCards(world)).toContain("station");
  });
  it("keeps four present humans on stage and leaves offline avatars out", () => {
    const world = shared();
    world.presentActors = ["vale", "mara", "ash", "nell"];
    const cast = sceneCast(world).filter(Boolean);
    for (const id of world.presentActors) expect(cast).toContain(id);
    expect(cast).not.toContain("tavi");
    const staging = sceneStaging(world);
    expect(staging.actors.map((a) => a.id)).toEqual(
      expect.arrayContaining(world.presentActors),
    );
    for (const actor of staging.actors)
      expect(Number.isFinite(actor.x)).toBe(true);
  });
});

describe("shared room dialogue clock", () => {
  const first = { seq: 10, speaker: "Vale", text: "Here is a light." };
  const second = { seq: 11, speaker: "Mara", text: "Then let us see." };
  const state = {
    history: [
      { room: "pond", starts_at: 1000, lines: [first, second] },
      {
        room: "station",
        starts_at: 1000,
        lines: [{ speaker: "Keeper", text: "Welcome." }],
      },
    ],
  };
  it("chooses the same line for clients using the same server time", () => {
    expect(sharedLiveLine(state, 1100, "pond")).toEqual(first);
    expect(sharedLiveLine(state, 4600, "pond")).toEqual(second);
    expect(sharedLiveLine(state, 90000, "pond")).toEqual(second);
  });
  it("reads only the current room's scene", () => {
    expect(sharedLiveLine(state, 1100, "station").speaker).toBe("Keeper");
    expect(sharedLiveLine(state, 1100, "attic")).toBeNull();
  });
});

describe("shared speech recovery", () => {
  const failed = {
    play: "play1",
    actor: "vale",
    room: "pond",
    turn: 4,
    error: "busy",
  };
  const state = {
    actor: "vale",
    world: { turn: 4 },
    queue: [],
    history: [failed],
  };
  it("offers the actor a server retry for the saved play", () => {
    expect(sharedSpeechState(state, "pond")).toEqual({
      status: "retry",
      retryKey: "play1",
    });
  });
  it("keeps recovery tied to the room, actor, turn and queue", () => {
    expect(sharedSpeechState(state, "station").status).toBe("ready");
    expect(
      sharedSpeechState({ ...state, actor: "mara" }, "pond").retryKey,
    ).toBeNull();
    expect(
      sharedSpeechState({ ...state, world: { turn: 5 } }, "pond").retryKey,
    ).toBeNull();
    expect(
      sharedSpeechState({ ...state, queue: [{ status: "waiting" }] }, "pond")
        .retryKey,
    ).toBeNull();
    expect(
      sharedSpeechState({ ...state, queue: [{ status: "working" }] }, "pond")
        .status,
    ).toBe("pending");
  });
});
