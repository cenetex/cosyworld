import { atticOpening } from "./fixtures/card-attic-opening.mjs";
import {
  narrativeContext,
  applyGeneratedText,
} from "../v2/card-game/narrative.mjs";
import { describe, it, expect } from "vitest";
import { dialogueCast } from "../v2/card-game/scene-cast.mjs";
import {
  createWorld,
  legalActions,
  play,
  decodeSave,
  encodeSave,
} from "../v2/card-game/world.mjs";
import {
  sceneCast,
  nextSpeaker,
  sceneLines,
  sceneStaging,
  selectedHandItem,
  movementCaption,
  currentScene,
  sceneScript,
} from "../v2/card-game/scene.mjs";
const wantPlace = (target) => ({
  kind: "place",
  target,
  since: 0,
  refusals: 0,
});
function gathered() {
  const s = createWorld();
  for (const id of ["vale", "moth", "keeper"]) s.actors[id].place = "station";
  return s;
}
function dialogue(s, id, extra = {}) {
  s.log.push({
    seq: ++s.eventSeq,
    turn: s.turn,
    kind: "dialogue",
    actorId: id,
    locationId: "station",
    speaker: id,
    text: "Hello.",
    ...extra,
  });
}
function act(s, kind, item, target) {
  return play(
    s,
    legalActions(s).find(
      (a) =>
        a.kind === kind &&
        (!item || a.item === item) &&
        (!target || a.target === target),
    ),
  ).state;
}
describe("the waiting speaker portrait", () => {
  it("names each speaker in display order", () => {
    const world = act(gathered(), "talk", null, "moth");
    const speakers = ["vale", "moth"];
    expect(nextSpeaker(world, { speakers })).toBe("vale");
    expect(nextSpeaker(world, { speakers, shown: ["vale"] })).toBe("moth");
    expect(
      nextSpeaker(world, { speakers, shown: ["vale", "moth"] }),
    ).toBeNull();
  });
  it("waits on the acting avatar at a shared table", () => {
    const world = act(gathered(), "talk", null, "moth");
    expect(nextSpeaker(world, { actor: "vale" })).toBe("vale");
    expect(nextSpeaker(world, { actor: "rue" })).toBeNull();
    expect(nextSpeaker(world, {})).toBeNull();
  });
});
describe("the presented physical snapshot", () => {
  it("uses current holdings while reviewing earlier speech", () => {
    const world = gathered();
    world.items.lamp.holder = "vale";
    dialogue(world, "vale", {
      generated: true,
      items: [{ id: "lamp", holder: "vale", lit: false, fuel: 8 }],
    });
    const line = world.log.at(-1);
    world.items.lamp.holder = "moth";
    const stage = sceneStaging(world, {
      line,
      currentState: true,
      review: true,
    });
    expect(
      stage.actors
        .find((actor) => actor.id === "vale")
        .items.some((item) => item.id === "lamp"),
    ).toBe(false);
    expect(
      stage.actors
        .find((actor) => actor.id === "moth")
        .items.some((item) => item.id === "lamp"),
    ).toBe(true);
    expect(stage.actors.every((actor) => actor.presence === "present")).toBe(
      true,
    );
    expect(line.items[0].holder).toBe("vale");
  });
});

describe("selected item in the avatar's hand", () => {
  it("previews the latest selected item and keeps the saved world intact", () => {
    const s = createWorld();
    s.items.lamp.holder = "vale";
    s.items.cloth.holder = "vale";
    const before = encodeSave(s);
    expect(selectedHandItem(s, ["lamp", "cloth"])).toBe("cloth");
    expect(selectedHandItem(s, ["lamp", "moth"])).toBe("lamp");
    expect(selectedHandItem(s, ["cloth"])).toBe("cloth");
    expect(selectedHandItem(s, [])).toBeNull();
    expect(selectedHandItem(s, ["vale", "station", "quest:test"])).toBeNull();
    expect(encodeSave(s)).toBe(before);
  });

  it("clears a transferred item and includes coverings on carried objects", () => {
    const s = createWorld();
    s.items.lamp.holder = "vale";
    s.items.cloth.holder = "lamp";
    s.actors.moth.place = "station";
    expect(selectedHandItem(s, ["cloth"])).toBe("cloth");
    s.items.lamp.holder = "moth";
    expect(selectedHandItem(s, ["lamp", "cloth"])).toBeNull();
    s.items.lamp.holder = "vale";
    expect(selectedHandItem(s, ["cloth"])).toBe("cloth");
    s.items.cloth.holder = "pond";
    expect(selectedHandItem(s, ["lamp", "cloth"])).toBe("lamp");
    s.items.lamp.holder = "station";
    expect(selectedHandItem(s, ["lamp"])).toBeNull();
  });

  it("follows the claimed shared avatar's belongings", () => {
    const s = createWorld();
    s.sharedVersion = 1;
    s.controlledActors = ["vale", "mara"];
    s.presentActors = ["vale", "mara"];
    s.playerActorId = "mara";
    s.actors.mara.place = "pond";
    s.items.lamp.holder = "vale";
    expect(selectedHandItem(s, ["lamp"])).toBeNull();
    s.items.lamp.holder = "mara";
    expect(selectedHandItem(s, ["lamp"])).toBe("lamp");
    expect(selectedHandItem(s, ["missing-item"])).toBeNull();
  });
});
describe("JRPG scenes", () => {
  it("distinguishes a follower, agreed company, and a waiting resident", () => {
    const s = gathered();
    s.actors.vale.place = s.actors.moth.place = "attic";
    // Pip wants the pond, so it follows Vale there or agrees to come along.
    s.actors.moth.want = wantPlace("pond");
    s.items.lamp.holder = "vale";
    s.items.lamp.lit = false;
    const followed = act(s, "move", null, "pond");
    expect(movementCaption(followed)).toContain(
      "Pip follows from Mirror attic.",
    );
    expect(movementCaption(decodeSave(encodeSave(followed)))).toBe(
      movementCaption(followed),
    );
    const invite = legalActions(s).find(
      (a) =>
        a.kind === "accompany" &&
        a.target === "moth" &&
        a.destination === "pond",
    );
    const shared = play(s, invite).state;
    expect(movementCaption(shared)).toContain("Pip travels with Vale.");
    const waiting = atticOpening();
    waiting.items.lamp.lit = false;
    waiting.locations.attic.anchored = true;
    expect(movementCaption(act(waiting, "move", null, "pond"))).toBe(
      "Pip is waiting here.",
    );
  });

  it("explains a quiet departure and clears it on the following turn", () => {
    const s = gathered();
    s.actors.moth.want = wantPlace("pond");
    s.actors.keeper.want = null;
    const left = act(s, "wait");
    expect(movementCaption(left)).toContain("Pip leaves for Black pond.");
    expect(movementCaption(act(left, "wait"))).not.toContain(
      "Pip leaves for Black pond.",
    );
  });

  it("starts a fresh scene on return and keeps earlier visits available for replay", () => {
    // Travel is silent; the whole cast speaks here so each visit has lines.
    const write = (s) => {
      const context = {
        ...narrativeContext(s),
        speakers: dialogueCast(s).speakers,
      };
      return applyGeneratedText(s, context, {
        revision: s.revision,
        model: "fixture",
        entries: context.entities.map(({ id }) => ({
          id,
          text: `${id} speaks on turn ${s.turn}.`,
        })),
      });
    };
    let s = write(createWorld());
    const earlier = currentScene(s).line;
    s = act(s, "move", null, "pond");
    expect(currentScene(s).line).toBeNull();
    s = write(s);
    s = act(s, "move", null, "station");
    expect(currentScene(s)).toMatchObject({ line: null, previous: null });
    expect(currentScene(s, earlier.index).line).toEqual(earlier);
    s = write(s);
    expect(currentScene(s).line.turn).toBe(2);
    expect(currentScene(s).previous.turn).toBe(2);
  });
  it("holds the same reply when a long saved game trims earlier events", () => {
    const write = (s) => {
      const context = narrativeContext(s);
      return applyGeneratedText(s, context, {
        revision: s.revision,
        model: "fixture",
        entries: context.entities.map(({ id }) => ({
          id,
          text: `${id} watches turn ${s.turn}.`,
        })),
      });
    };
    let s = createWorld();
    for (let turn = 0; turn < 95; turn++) s = act(write(s), "wait");
    s = decodeSave(encodeSave(write(s)));
    expect(s.turn).toBe(95);
    expect(s.log.filter((e) => !e.generated)).toHaveLength(100);
    expect(s.log.filter((e) => e.generated).length).toBeLessThanOrEqual(100);
    const old = currentScene(s).line;
    s = act(s, "wait");
    expect(currentScene(s, null, { seq: old.seq, hold: true }).line.seq).toBe(
      old.seq,
    );
    s = write(s);
    const held = currentScene(s, null, { seq: old.seq, hold: true });
    expect(held.line.seq).toBe(old.seq);
    expect(held.line.text).toBe(old.text);
    expect(held.line.index).not.toBe(old.index);
    expect(currentScene(s).line.turn).toBe(96);
  });

  it("holds new words until the entrance is ready while keeping a chosen earlier reply", () => {
    let s = act(createWorld(), "wait");
    const context = narrativeContext(s);
    s = applyGeneratedText(s, context, {
      revision: s.revision,
      model: "fixture",
      entries: context.entities.map(({ id }) => ({
        id,
        text: `${id} has arrived.`,
      })),
    });
    const reply = currentScene(s).line;
    expect(currentScene(s, null, { hold: true }).line).toBeNull();
    expect(currentScene(s, reply.index, { hold: true }).line).toEqual(reply);
  });
  it("exports light at the current location", () => {
    const s = createWorld();
    s.items.lamp.holder = "moth";
    s.items.lamp.lit = true;
    expect(sceneScript(s).current).toMatchObject({
      locationId: "station",
      light: false,
    });
    s.actors.vale.place = "pond";
    expect(sceneScript(s).current).toMatchObject({
      locationId: "pond",
      light: true,
    });
  });

  it("shows the recorded cast when reading an earlier line", () => {
    let s = gathered();
    s.actors.moth.want = s.actors.keeper.want = null;
    s = act(s, "talk", null, "moth");
    const context = narrativeContext(s, { target: "moth" });
    s = applyGeneratedText(s, context, {
      revision: s.revision,
      model: "fixture",
      entries: context.entities.map(({ id }) => ({
        id,
        text: `${id} remembers the meeting.`,
      })),
    });
    const spoken = s.log.findIndex(
      (e) => e.kind === "dialogue" && e.actorId === "moth",
    );
    s.actors.moth.want = wantPlace("pond");
    s.actors.keeper.place = "pond";
    s = act(act(s, "wait"), "wait");
    expect(s.actors.moth.place).toBe("pond");
    expect(currentScene(s, spoken).slots).toEqual(["vale", "moth", "keeper"]);
    expect(currentScene(s).slots).toEqual(["vale", null]);
  });
  it("keeps all three characters in stable seats through each reply", () => {
    const s = gathered();
    dialogue(s, "vale");
    dialogue(s, "moth");
    dialogue(s, "vale");
    expect(sceneCast(s)).toEqual(["vale", "moth", "keeper"]);
    dialogue(s, "keeper");
    expect(sceneCast(s)).toEqual(["vale", "moth", "keeper"]);
    dialogue(s, "keeper");
    expect(sceneCast(s)).toEqual(["vale", "moth", "keeper"]);
    dialogue(s, "moth");
    expect(sceneCast(s)).toEqual(["vale", "moth", "keeper"]);
  });
  it("keeps the cast still through narration, input and actions", () => {
    const s = gathered();
    dialogue(s, "keeper");
    dialogue(s, "moth");
    const cast = sceneCast(s);
    dialogue(s, "vale", { kind: "input" });
    dialogue(s, "vale", { kind: "action", verb: "take" });
    dialogue(s, null, { kind: "narration" });
    expect(sceneCast(s)).toEqual(cast);
  });
  it("uses local speakers and resets the stage on travel", () => {
    const s = gathered();
    dialogue(s, "keeper");
    dialogue(s, "moth");
    s.actors.keeper.place = "attic";
    expect(sceneCast(s)).toEqual(["vale", "moth"]);
    dialogue(s, "keeper", { locationId: "attic" });
    expect(sceneCast(s)).toEqual(["vale", "moth"]);
    s.actors.keeper.place = "station";
    dialogue(s, "vale", { kind: "action", verb: "move" });
    expect(sceneCast(s)).toEqual(["vale", "moth", "keeper"]);
  });
  it("faces the addressed actor while keeping seats and depth through the reply", () => {
    const s = gathered();
    dialogue(s, "vale", { kind: "action", verb: "talk", targetId: "keeper" });
    dialogue(s, "vale");
    const first = sceneStaging(s);
    dialogue(s, "keeper");
    const reply = sceneStaging(s);
    expect(
      first.actors.map(({ id, x, scale, depth }) => ({ id, x, scale, depth })),
    ).toEqual(
      reply.actors.map(({ id, x, scale, depth }) => ({ id, x, scale, depth })),
    );
    expect(first.actors.find((a) => a.id === "vale")).toMatchObject({
      facing: "right",
      gazeTargetId: "keeper",
    });
    expect(reply.actors.find((a) => a.id === "keeper")).toMatchObject({
      facing: "left",
      gazeTargetId: "vale",
    });
    expect(reply.actors.map((a) => a.scale)).toEqual([1, 0.84, 0.76]);
  });
  it("turns fighters in a standoff toward each other over the speaker", () => {
    const s = gathered();
    dialogue(s, "keeper");
    const place = s.actors.vale.place;
    const resolve = { vale: 4, moth: 4 };
    s.standoffs = [
      { challenger: "vale", defender: "moth", location: place, resolve },
    ];
    const stage = sceneStaging(s);
    expect(stage.actors.find((a) => a.id === "vale")).toMatchObject({
      gazeTargetId: "moth",
      facing: "right",
    });
    expect(stage.actors.find((a) => a.id === "moth")).toMatchObject({
      gazeTargetId: "vale",
      facing: "left",
    });
  });
  it("brings a battle's latest exchange to the front between plays", () => {
    const s = gathered();
    const place = s.actors.vale.place;
    const resolve = { vale: 4, moth: 4, keeper: 4 };
    s.standoffs = [
      { challenger: "vale", defender: "moth", location: place, resolve },
    ];
    dialogue(s, "keeper", { kind: "action", verb: "attack", targetId: "moth" });
    const actors = sceneStaging(s).actors;
    const by = (id) => actors.find((a) => a.id === id);
    expect(actors.map((a) => a.id).slice(0, 2)).toEqual(["keeper", "moth"]);
    expect([by("keeper").depth, by("moth").depth, by("vale").depth]).toEqual([
      "foreground",
      "middle",
      "back",
    ]);
    expect(by("keeper").gazeTargetId).toBe("moth");
    expect(by("moth").gazeTargetId).toBe("keeper");
    expect(by("vale").gazeTargetId).toBe("keeper");
  });
  it("mirrors the whole composition at a scene entrance", () => {
    const s = gathered();
    dialogue(s, "vale", {
      kind: "action",
      verb: "move",
      fromLocationId: "pond",
    });
    dialogue(s, "keeper");
    const stage = sceneStaging(s);
    expect(stage.layout).toBe("foreground-right");
    expect(stage.actors.map((a) => a.x)).toEqual([78, 41, 19]);
    expect(stage.actors.find((a) => a.id === "keeper")).toMatchObject({
      facing: "right",
      flip: false,
      cutout: "./assets/keeper-right.png",
    });
    expect(stage.actors.find((a) => a.id === "vale").flip).toBe(true);
  });
  it("sizes shared players by recent plays with a Fibonacci falloff and history review", () => {
    const s = gathered();
    const cast = ["vale", "mara", "ash", "nell", "keeper"];
    s.controlledActors = ["vale", "mara", "ash", "nell"];
    s.presentActors = [...s.controlledActors];
    for (const id of cast) s.actors[id].place = "station";
    const stage = (extra = {}) => sceneStaging(s, { cast, ...extra });
    const ranked = (value) =>
      value.actors.toSorted((a, b) => b.scale - a.scale).map((a) => a.id);
    dialogue(s, "vale", { kind: "action", verb: "wait" });
    dialogue(s, "mara", { kind: "action", verb: "wait" });
    const earlier = s.log.length - 1;
    dialogue(s, "ash", { kind: "action", verb: "wait" });
    dialogue(s, "ash", { kind: "action", verb: "wait" });
    dialogue(s, "nell", { kind: "action", locationId: "pond" });
    dialogue(s, "keeper", { kind: "action", verb: "wait" });
    dialogue(s, "vale", { generated: true });
    const current = stage();
    expect(ranked(current)).toEqual(["ash", "mara", "vale", "nell", "keeper"]);
    expect(
      current.actors
        .map((a) => Math.round(a.scale ** 2 * 13))
        .sort((a, b) => b - a),
    ).toEqual([13, 8, 5, 3, 2]);
    expect(ranked(stage({ through: earlier }))).toEqual(ranked(current));
    expect(
      ranked(stage({ through: earlier, review: true })).slice(0, 2),
    ).toEqual(["mara", "vale"]);
    s.playerActorId = "nell";
    expect(ranked(stage())).toEqual(ranked(current));
    s.turn++;
    dialogue(s, null, {
      kind: "narration",
      text: "Nell waits. The cast takes a turn.",
    });
    const sharedPlays = [{ actor: "nell", room: "station", turn: s.turn }];
    expect(ranked(stage({ sharedPlays })).slice(0, 3)).toEqual([
      "nell",
      "ash",
      "mara",
    ]);
    expect(
      ranked(stage({ sharedPlays, through: earlier, review: true })).slice(
        0,
        2,
      ),
    ).toEqual(["mara", "vale"]);
    dialogue(s, "nell", { kind: "action", verb: "wait" });
    expect(ranked(stage()).slice(0, 3)).toEqual(["nell", "ash", "mara"]);
    expect(
      ranked(stage({ cast: cast.filter((id) => id !== "ash") })).slice(0, 2),
    ).toEqual(["nell", "mara"]);
  });
  it("lets the two smaller actors face each other for their own trade", () => {
    const s = gathered();
    dialogue(s, "moth", { kind: "action", verb: "trade", targetId: "keeper" });
    dialogue(s, "moth");
    const stage = sceneStaging(s);
    expect(stage.actors.find((a) => a.id === "moth")).toMatchObject({
      facing: "right",
      gazeTargetId: "keeper",
    });
    expect(stage.actors.find((a) => a.id === "keeper")).toMatchObject({
      facing: "left",
      gazeTargetId: "moth",
    });
  });
  it("keeps departure seats for the whole exchange and exports solo travel", () => {
    const s = gathered();
    dialogue(s, "moth", {
      kind: "action",
      verb: "move",
      fromLocationId: "station",
      locationId: "pond",
    });
    s.actors.moth.place = "pond";
    dialogue(s, "moth", {
      generated: true,
      departureTo: "pond",
      cast: ["vale", "moth", "keeper"],
    });
    const farewell = s.log.length - 1;
    dialogue(s, "keeper", { generated: true, cast: ["vale", "keeper"] });
    expect(currentScene(s, farewell).slots).toEqual(
      currentScene(s, s.log.length - 1).slots,
    );
    expect(
      sceneScript(s)
        .beats.at(-1)
        .performance.staging.actors.find((a) => a.id === "moth").presence,
    ).toBe("departed");
    const beat = sceneScript(s).beats[farewell];
    expect(
      beat.performance.staging.actors.find((a) => a.id === "moth"),
    ).toMatchObject({
      presence: "departing",
      movement: { kind: "leave", from: "station", to: "pond", companions: [] },
    });
  });
  it("records both partners in a shared entrance and exact item custody", () => {
    const s = gathered();
    dialogue(s, "vale", {
      kind: "action",
      verb: "accompany",
      targetId: "moth",
      accepted: true,
      fromLocationId: "attic",
      destinationId: "station",
      cast: ["vale", "moth", "keeper"],
      items: [
        { id: "lamp", holder: "vale", lit: true, fuel: 4 },
        { id: "cloth", holder: "lamp" },
        { id: "oil", holder: "keeper" },
      ],
    });
    dialogue(s, "moth", { generated: true, cast: ["vale", "moth", "keeper"] });
    const stage = sceneStaging(s);
    expect(
      sceneStaging(s, { line: null }).actors.find((a) => a.id === "vale")
        .movement,
    ).toEqual(stage.actors.find((a) => a.id === "vale").movement);
    expect(stage.actors.find((a) => a.id === "vale")).toMatchObject({
      movement: { kind: "arrive", companions: ["moth"] },
      items: [{ id: "lamp", lit: true, fuel: 4 }, { id: "cloth" }],
    });
    expect(stage.actors.find((a) => a.id === "moth")).toMatchObject({
      movement: { companions: ["vale"] },
      items: [],
    });
    expect(
      stage.actors.find((a) => a.id === "keeper").items.map((i) => i.id),
    ).toEqual(["oil"]);
    expect(
      sceneScript(decodeSave(encodeSave(s))).beats.at(-1).performance.staging,
    ).toEqual(stage);
  });
  it("keeps action records in the export while generated dialogue leads the scene", () => {
    let s = createWorld();
    for (const kind of ["input", "hint"]) {
      s.log.push({
        seq: ++s.eventSeq,
        turn: 0,
        kind,
        actorId: null,
        locationId: "station",
        speaker: "You",
        text: "take lamp",
      });
    }
    dialogue(s, "keeper", {
      speaker: "The keeper",
      text: "I want to hold Black cloth at Mirror attic.",
    });
    s = decodeSave(encodeSave(s));
    expect(sceneLines(s)).toHaveLength(0);
    expect(currentScene(s).line).toBeNull();
    expect(sceneScript(s).beats.some((beat) => beat.kind === "hint")).toBe(
      true,
    );
    s = act(s, "take", "lamp");
    s = act(s, "talk", null, "moth");
    const context = narrativeContext(s, { target: "moth" });
    s = applyGeneratedText(s, context, {
      revision: s.revision,
      model: "fixture",
      entries: context.entities.map(({ id }) => ({
        id,
        text: `${id} remembers the meeting.`,
      })),
    });
    const spoken = s.log.findLastIndex((e) => e.kind === "dialogue");
    expect(currentScene(s, spoken).activeSpeaker).toBe("moth");
    expect(
      sceneLines(s).some((e) => e.actorId === "moth" && e.kind === "dialogue"),
    ).toBe(true);
    expect(currentScene(s).slots).toEqual(["vale", "moth", "keeper"]);
    const scene = currentScene(s);
    expect(scene.previous.actorId).toBe("vale");
    expect(scene.previous.generated).toBe(true);
    expect(scene.line.actorId).toBe("moth");
    expect(sceneLines(s).every((line) => line.generated)).toBe(true);
    const restored = decodeSave(encodeSave(s));
    expect(currentScene(restored).previous).toEqual(scene.previous);
    expect(currentScene(restored).line).toEqual(scene.line);
    const pending = act(s, "wait");
    expect(currentScene(pending).line).toEqual(scene.line);
    expect(currentScene(pending, scene.previous.index).line).toEqual(
      scene.previous,
    );
  });
  it("exports ordered acts, local cast, object custody and image references", () => {
    const s = act(createWorld(), "take", "lamp");
    const script = sceneScript(s);
    const take = script.beats.find(
      (e) => e.verb === "take" && e.actorId === "vale",
    );
    expect(take).toMatchObject({
      kind: "action",
      locationId: "station",
      itemId: "lamp",
      cast: ["vale"],
      light: false,
    });
    expect(take.items.find((i) => i.id === "lamp")).toMatchObject({
      holder: "vale",
      fuel: 12,
      lit: false,
    });
    expect(
      script.beats.find((e) => e.actorId === "moth" && e.verb === "move"),
    ).toMatchObject({ locationId: "station", cast: ["vale", "moth"] });
    expect(script.source.truncated).toBe(false);
    expect(script.locations.find((p) => p.id === "station").background).toBe(
      "./assets/station.png",
    );
    expect(script.avatars.find((p) => p.id === "moth").cutout).toBe(
      "./assets/moth.png",
    );
    expect(sceneScript(decodeSave(encodeSave(s)))).toEqual(script);
  });
  it("keeps sequence numbers when history reaches its limit", () => {
    let s = createWorld();
    for (let i = 0; i < 110; i++) s = act(s, "wait");
    const script = sceneScript(s);
    expect(script.source.truncated).toBe(true);
    expect(script.beats).toHaveLength(100);
    expect(script.beats.at(-1).id).toBe(s.eventSeq);
    expect(new Set(script.beats.map((e) => e.id)).size).toBe(100);
  });
  it("validates scene metadata in saved games", () => {
    for (const patch of [
      { kind: "wrong" },
      { actorId: "wrong" },
      { locationId: "wrong" },
      { seq: -1 },
      { cast: ["vale", "vale"] },
      { items: [{ id: "lamp", holder: "wrong" }] },
    ]) {
      const s = createWorld();
      Object.assign(s.log[0], patch);
      expect(() => decodeSave(JSON.stringify(s))).toThrow();
    }
  });
  it("keeps generated words from shortening the history rules read", () => {
    const write = (s) => {
      const context = narrativeContext(s);
      return applyGeneratedText(s, context, {
        revision: s.revision,
        model: "fixture",
        entries: context.entities.map(({ id }) => ({ id, text: "Words." })),
      });
    };
    const events = (s) =>
      JSON.stringify(s.log.filter((e) => !e.generated).map((e) => e.text));
    let plain = createWorld();
    let spoken = createWorld();
    for (let turn = 0; turn < 120; turn++) {
      const kind = turn % 3 ? "wait" : "talk";
      const choose = (s) =>
        legalActions(s).find((a) => a.kind === kind) ||
        legalActions(s).find((a) => a.kind === "wait");
      plain = play(plain, choose(plain)).state;
      spoken = write(play(spoken, choose(spoken)).state);
      expect(events(spoken)).toBe(events(plain));
    }
    expect(spoken.log.filter((e) => !e.generated)).toHaveLength(100);
    expect(spoken.log.some((e) => e.generated)).toBe(true);
    expect(() => decodeSave(encodeSave(spoken))).not.toThrow();
  });
  it("faces Vale from her arrival after the arrival leaves the history", () => {
    let s = act(
      act(createWorld(), "move", null, "pond"),
      "move",
      null,
      "station",
    );
    const arrived = sceneStaging(s);
    expect(arrived.layout).toBe("foreground-right");
    for (let turn = 0; turn < 120; turn++) s = act(s, "wait");
    expect(s.log.some((e) => e.actorId === "vale" && e.verb === "move")).toBe(
      false,
    );
    expect(s.arrival).toMatchObject({
      fromLocationId: "pond",
      locationId: "station",
    });
    const later = decodeSave(encodeSave(s));
    expect(sceneStaging(later).layout).toBe("foreground-right");
    expect(sceneStaging(later).actors.find((a) => a.id === "vale").facing).toBe(
      arrived.actors.find((a) => a.id === "vale").facing,
    );
  });
  it("replays an earlier line without returning a departed avatar", () => {
    const s = gathered();
    const cast = ["vale", "moth", "keeper"];
    dialogue(s, "moth", { generated: true, cast });
    const earlier = s.log.at(-1);
    dialogue(s, "moth", { generated: true, departureTo: "pond", cast });
    s.actors.moth.place = "pond";
    dialogue(s, "keeper", { generated: true, cast: ["vale", "keeper"] });
    // Without review, the recorded exchange still seats the leaving avatar.
    expect(currentScene(s, null, { seq: earlier.seq }).slots).toContain("moth");
    // Read again replays the earlier line with the avatars present now.
    const scene = currentScene(s, null, { seq: earlier.seq, review: true });
    expect(scene.line.seq).toBe(earlier.seq);
    expect(scene.activeSpeaker).toBe("moth");
    expect(scene.slots).not.toContain("moth");
    const staging = sceneStaging(s, {
      through: scene.line.index,
      cast: scene.slots,
      line: scene.line,
      activeSpeaker: scene.activeSpeaker,
      review: true,
    });
    expect(staging.actors.map((a) => a.id)).toEqual(["vale", "keeper"]);
    expect(staging.actors.every((a) => a.presence === "present")).toBe(true);
  });
});
