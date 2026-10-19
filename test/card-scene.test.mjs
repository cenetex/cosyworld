import {
  narrativeContext,
  applyGeneratedText,
} from "../v2/card-game/narrative.mjs";
import { describe, it, expect } from "vitest";
import {
  createWorld,
  legalActions,
  play,
  decodeSave,
  encodeSave,
} from "../v2/card-game/world.mjs";
import {
  sceneCast,
  sceneLines,
  sceneStaging,
  currentScene,
  sceneScript,
} from "../v2/card-game/scene.mjs";
function gathered() {
  const s = createWorld();
  for (const actor of Object.values(s.actors)) actor.place = "station";
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
describe("JRPG scenes", () => {
  it("exports light at the current location", () => {
    let s = createWorld();
    for (let i = 0; i < 4; i++) s = act(s, "wait");
    expect(s.items.lamp.lit).toBe(true);
    expect(sceneScript(s).current).toMatchObject({
      locationId: "station",
      light: false,
    });
  });

  it("shows the recorded cast when reading an earlier line", () => {
    let s = act(createWorld(), "wait");
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
    s = act(act(s, "wait"), "wait");
    expect(s.actors.moth.place).toBe("pond");
    expect(currentScene(s, spoken).slots).toEqual(["vale", "moth", "keeper"]);
    expect(currentScene(s).slots).toEqual(["vale", null]);
  });
  it("lets an avatar refill its target lamp with reachable oil", () => {
    let s = createWorld();
    s.items.lamp.holder = "moth";
    s.items.lamp.fuel = 0;
    s.items.oil.holder = "moth";
    s = act(s, "wait");
    expect(s.items.oil.doses).toBeLessThan(3);
    expect(s.items.lamp.fuel).toBeGreaterThan(0);
    expect(s.log.some((e) => e.actorId === "moth" && e.verb === "refill")).toBe(
      true,
    );
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
    expect(reply.actors.map((a) => a.scale)).toEqual([1, 0.74, 0.64]);
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
      fuel: 8,
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
  it("restores earlier saves and assigns event order on the next action", () => {
    const s = createWorld();
    s.schema = 3;
    delete s.memories;
    delete s.eventSeq;
    s.log = s.log.map(({ turn, speaker, text }) => ({ turn, speaker, text }));
    const restored = decodeSave(JSON.stringify(s));
    expect(currentScene(restored).line).toBeNull();
    expect(sceneScript(restored).beats[0].locationId).toBe(null);
    const next = act(restored, "take", "lamp");
    expect(next.log.map((e) => e.seq)).toEqual(next.log.map((_, i) => i + 1));
    expect(decodeSave(encodeSave(next))).toEqual(next);
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
});
