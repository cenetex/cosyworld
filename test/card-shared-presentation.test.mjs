import { describe, expect, it } from "vitest";
import {
  sharedLiveLine,
  sharedNextLine,
  sharedReadingLine,
  createSharedPlaybackClock,
  sharedSpeechState,
  sharedVoiceReference,
  hasSharedPlace,
  sharedSilentLines,
  SHARED_SILENT_TEXT,
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
  it("keeps Vale's solo viewpoint and uses the plain shared portrait", () => {
    const world = createWorld();
    expect(currentActor(world)).toBe("vale");
    expect(currentScene(world).background).toBe("./assets/station.png");
    expect(portrait("vale", null, world)).toBe(
      "./assets/shared/characters/vale.png",
    );
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
  it("references a committed scene line by play and position, not its words", () => {
    const line = { seq: 12, text: "Repeated words." };
    const state = {
      history: [{ play: "saved-play", lines: [{ seq: 11 }, line] }],
    };
    expect(sharedVoiceReference(state, line)).toEqual({
      play: "saved-play",
      line: 1,
    });
    expect(
      sharedVoiceReference(state, { seq: 13, text: line.text }),
    ).toBeUndefined();
    expect(
      sharedVoiceReference(state, { ...line, silent: true }),
    ).toBeUndefined();
  });
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
  it("reads each shared reply in order from the viewer’s last line", () => {
    expect(sharedNextLine(state, "pond", 0)).toEqual(first);
    expect(sharedNextLine(state, "pond", first.seq)).toEqual(second);
    expect(sharedNextLine(state, "pond", second.seq)).toBeUndefined();
    const recent = { ...state, world: { log: [second] } };
    expect(sharedNextLine(recent, "pond", 0)).toEqual(second);
  });
  it("starts a fresh reader at the first line and resumes their saved place", () => {
    expect(sharedReadingLine(state, "pond")).toEqual(first);
    const saved = { room: "pond", seq: first.seq };
    const later = { seq: 12, text: "A later reply." };
    const incoming = { ...state, history: [...state.history,
      { room: "pond", starts_at: 90000, lines: [later] }] };
    expect(sharedReadingLine(incoming, "pond", saved)).toEqual(first);
    expect(sharedReadingLine(incoming, "pond", { ...saved, seq: second.seq })).toEqual(second);
    expect(sharedReadingLine(incoming, "pond")).toEqual(later);
    expect(sharedReadingLine(incoming, "pond", { room: "station", seq: 10 })).toEqual(later);
    expect(sharedReadingLine({ ...incoming, world: { log: [second, later] } }, "pond", saved)).toEqual(second);
    expect(sharedReadingLine({ ...incoming, world: { run: { seed: 2 } } }, "pond", { ...saved, seed: 1 })).toEqual(later);
    expect(sharedReadingLine(incoming, "pond", { ...saved, seq: Infinity })).toEqual(later);
    expect(sharedReadingLine({ ...incoming, actor: "vale" }, "pond", { ...saved, actor: "mara" })).toEqual(later);
  });
  it("shows a silent reply speaker as … after the spoken line", () => {
    const spoken = {
      seq: 20,
      turn: 4,
      speaker: "Vale",
      text: "Is anyone there?",
      actorId: "vale",
      locationId: "pond",
    };
    const quiet = {
      history: [
        { room: "pond", starts_at: 1000, lines: [spoken], silent: ["pip"] },
      ],
    };
    const [silent] = sharedSilentLines(quiet, "pond");
    expect(silent).toMatchObject({
      seq: 20.1,
      text: SHARED_SILENT_TEXT,
      actorId: "pip",
      silent: true,
      locationId: "pond",
    });
    expect(isSceneText({ ...silent, speaker: "Pip" }, true)).toBe(true);
    expect(sharedLiveLine(quiet, 1100, "pond")).toEqual(spoken);
    expect(sharedLiveLine(quiet, 5000, "pond")).toEqual(silent);
    // A speaker with words, or a record without a list, adds nothing.
    quiet.history[0].silent = ["vale"];
    expect(sharedSilentLines(quiet, "pond")).toEqual([]);
    expect(sharedSilentLines(state, "pond")).toEqual([]);
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

describe("shared words that fail", () => {
  const failed = {
    play: "play1",
    actor: "vale",
    room: "pond",
    turn: 4,
    error: "busy",
  };
  const state = {
    actor: "vale",
    world: { turn: 4, log: [{ seq: 7, turn: 4 }] },
    queue: [],
    history: [failed],
  };
  it("never offer a retry: the room is ready or its words are on the way", () => {
    expect(sharedSpeechState(state, "pond")).toEqual({ status: "ready" });
    expect(
      sharedSpeechState({ ...state, queue: [{ status: "working" }] }, "pond")
        .status,
    ).toBe("pending");
  });
  it("shows the viewer's queued opening as pending", () => {
    const queue = [{ actor: "vale", opening: true, status: "retry" }];
    expect(sharedSpeechState({ ...state, queue }).status).toBe("pending");
    expect(sharedSpeechState({ ...state, actor: "mara", queue }).status).toBe(
      "ready",
    );
  });
  it("show a silent scene's speakers as … after the play's last event", () => {
    const silent = {
      play: "play2",
      actor: "vale",
      room: "pond",
      turn: 4,
      lines: [],
      silent: ["vale", "moth"],
      after: 7,
      starts_at: 10,
      until_at: 10,
    };
    const lines = sharedSilentLines({ ...state, history: [silent] }, "pond");
    expect(lines.map((line) => [line.actorId, line.text, line.seq])).toEqual([
      ["vale", "…", 7.1],
      ["moth", "…", 7.2],
    ]);
    expect(lines.every((line) => line.silent)).toBe(true);
  });
  it("show an older failed record as … for its player, never its error", () => {
    const old = { ...failed, lines: [], after: 7 };
    const lines = sharedSilentLines({ ...state, history: [old] }, "pond");
    expect(lines.map((line) => [line.actorId, line.text])).toEqual([
      ["vale", "…"],
    ]);
    // Without an anchor there is nothing to place: the caption stands alone.
    expect(sharedSilentLines(state, "pond")).toEqual([]);
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
