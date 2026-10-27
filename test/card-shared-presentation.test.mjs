import { describe, expect, it } from "vitest";
import {
  sharedLiveLine,
  createSharedPlaybackClock,
  sharedNextActor,
  sharedSpeechState,
  hasSharedPlace,
} from "../v2/card-game/shared.mjs";
import { createWorld, currentActor } from "../v2/card-game/world.mjs";
import { availableCards } from "../v2/card-game/cards.mjs";
import {
  currentScene,
  isSceneText,
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
  it("keeps a viewer's line while a card pauses their reading clock", () => {
    const clock = createSharedPlaybackClock();
    expect(clock.now(state, 1200, "pond", true)).toBe(1200);
    expect(clock.now(state, 13200, "pond", true)).toBe(1200);
    const resumed = clock.now(state, 13200, "pond", false);
    expect(sharedLiveLine(state, resumed, "pond")).toEqual(first);
    expect(sharedLiveLine(state, 13200, "pond")).toEqual(second);
    expect(
      sharedLiveLine(state, clock.now(state, 16600, "pond", false), "pond"),
    ).toEqual(second);
    clock.reset();
    expect(clock.now(state, 17000, "pond", false)).toBe(17000);
  });
  it("finishes a paused scene before reading the next committed scene", () => {
    const clock = createSharedPlaybackClock();
    clock.now({ history: [] }, 900, "pond", true);
    expect(clock.now(state, 6000, "pond", true)).toBe(1000);
    expect(clock.now(state, 6000, "pond", false)).toBe(1000);
    const next = {
      history: [{ ...state.history[0], starts_at: 7000 }, ...state.history],
    };
    expect(clock.now(next, 7200, "pond", false)).toBe(2200);
    expect(clock.now(next, 7300, "pond", true)).toBe(2300);
    expect(clock.now(next, 9000, "pond", false)).toBe(2300);
    expect(clock.now(state, 9100, "station", false)).toBe(9100);
  });
  it("joins an older room scene at the current time after paused travel", () => {
    const clock = createSharedPlaybackClock();
    clock.now(state, 1200, "pond", true);
    expect(clock.now(state, 13200, "pond", true)).toBe(1200);
    expect(clock.now(state, 13200, "station", true)).toBe(13200);
    expect(clock.now(state, 14000, "station", false)).toBe(13200);
  });
  it("reads every queued scene when a late update contains two new replies", () => {
    const clock = createSharedPlaybackClock();
    const vale = {
      room: "pond",
      starts_at: 1000,
      play: "vale",
      lines: [first],
    };
    const mara = {
      room: "pond",
      starts_at: 6000,
      play: "mara",
      lines: [second],
    };
    const nellLine = {
      seq: 12,
      speaker: "Nell",
      text: "The leaves are bright.",
    };
    const nell = {
      room: "pond",
      starts_at: 11000,
      play: "nell",
      lines: [nellLine],
    };
    clock.now({ history: [vale] }, 1100, "pond", false);
    const late = { history: [nell, mara, vale] };
    const time = clock.now(late, 15000, "pond", false);
    expect(time).toBe(6000);
    expect(sharedLiveLine(late, time, "pond")).toEqual(second);
    expect(
      sharedLiveLine(late, clock.now(late, 16000, "pond", false), "pond"),
    ).toEqual(second);
    expect(
      sharedLiveLine(late, clock.now(late, 18500, "pond", false), "pond"),
    ).toEqual(nellLine);
    clock.reset();
    expect(
      sharedLiveLine(late, clock.now(late, 19000, "pond", false), "pond"),
    ).toEqual(nellLine);
  });
  it("reads the first arriving scene after observing an empty room", () => {
    const clock = createSharedPlaybackClock();
    clock.now({ history: [] }, 900, "pond", false);
    const late = {
      history: [
        { room: "pond", starts_at: 6000, lines: [second] },
        { room: "pond", starts_at: 1000, lines: [first] },
      ],
    };
    expect(
      sharedLiveLine(late, clock.now(late, 10000, "pond", false), "pond"),
    ).toEqual(first);
    expect(
      sharedLiveLine(late, clock.now(late, 13500, "pond", false), "pond"),
    ).toEqual(second);
    clock.reset();
    expect(
      sharedLiveLine(late, clock.now(late, 14000, "pond", false), "pond"),
    ).toEqual(second);
  });
  it("keeps all incoming scenes while a discovery pauses the reader", () => {
    const clock = createSharedPlaybackClock();
    const vale = {
      room: "pond",
      starts_at: 1000,
      play: "vale",
      lines: [first],
    };
    const mara = {
      room: "pond",
      starts_at: 6000,
      play: "mara",
      lines: [second],
    };
    clock.now({ history: [vale] }, 1200, "pond", true);
    const late = { history: [mara, vale] };
    expect(clock.now(late, 10000, "pond", true)).toBe(1200);
    expect(
      sharedLiveLine(late, clock.now(late, 10000, "pond", false), "pond"),
    ).toEqual(first);
    expect(
      sharedLiveLine(late, clock.now(late, 13300, "pond", false), "pond"),
    ).toEqual(second);
  });
  it("reads only the current room's scene", () => {
    expect(sharedLiveLine(state, 1100, "station").speaker).toBe("Keeper");
    expect(sharedLiveLine(state, 1100, "attic")).toBeNull();
  });
});

it("puts the next player's face on the live control and keeps a face while quiet", () => {
  const state = {
    actor: "vale",
    queue: [
      { actor: "vale", status: "playing" },
      { actor: "mara", status: "waiting" },
    ],
    history: [
      {
        actor: "vale",
        room: "pond",
        starts_at: 1000,
        lines: [
          { actorId: "vale", text: "Here is a light." },
          { actorId: "moth", text: "Let me see." },
        ],
      },
    ],
  };
  expect(sharedNextActor(state, 1100, "pond")).toBe("mara");
  state.queue = [{ actor: "nell", status: "working" }];
  expect(sharedNextActor(state, 1100, "pond")).toBe("nell");
  state.queue = [];
  expect(sharedNextActor(state, 1100, "pond")).toBe("moth");
  expect(sharedNextActor(state, 90000, "pond")).toBe("moth");
  state.history[0].lines[1] = {
    actorId: null,
    text: "A ripple reaches the shore.",
  };
  expect(sharedNextActor(state, 90000, "pond")).toBe("vale");
  expect(sharedNextActor(state, 90000, "station")).toBe("vale");
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

describe("shared room detail lines", () => {
  it("shows the timed switch from speech to a room detail and keeps both in review", () => {
    const world = shared();
    const lines = [
      {
        seq: 100,
        kind: "dialogue",
        generated: true,
        actorId: "mara",
        speaker: "Mara",
        text: "The water is still.",
        locationId: "station",
        turn: world.turn,
      },
      {
        seq: 101,
        kind: "narration",
        generated: true,
        entityId: "station",
        speaker: "The station",
        text: "A leaf turns beside the platform.",
        locationId: "station",
        turn: world.turn,
      },
    ];
    world.log.push(...lines);
    const state = { history: [{ room: "station", starts_at: 1000, lines }] };
    for (const [time, expected] of [
      [1100, lines[0]],
      [4600, lines[1]],
    ]) {
      const live = sharedLiveLine(state, time, "station");
      const scene = currentScene(world, null, { seq: live.seq, review: true });
      expect(scene.line.text).toBe(expected.text);
      expect(isSceneText(scene.line, true)).toBe(true);
      expect(
        scene.lines
          .filter((entry) => isSceneText(entry, true))
          .map((entry) => entry.seq),
      ).toEqual([100, 101]);
    }
    expect(isSceneText(lines[1], false)).toBe(false);
    expect(isSceneText({ ...lines[1], generated: false }, true)).toBe(false);
  });
});

it("holds play controls while a returning avatar waits for a room place", () => {
  expect(hasSharedPlace({ actor: "vale", present: [1, 0] })).toBe(true);
  expect(hasSharedPlace({ actor: "mara", present: [1, 0] })).toBe(false);
  expect(hasSharedPlace({ actor: null })).toBe(false);
});
