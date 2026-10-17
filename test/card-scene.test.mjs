import { describe, it, expect } from "vitest";
import {
  createWorld,
  legalActions,
  play,
  chat,
  decodeSave,
  encodeSave,
} from "../v2/card-game/world.mjs";
import {
  sceneCast,
  sceneLines,
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
  it("keeps the current scene through a long command conversation", () => {
    let s = act(createWorld(), "ring", "bell");
    s = chat(chat(s, "Hello Pip").state, "Hello keeper").state;
    const cast = currentScene(s).slots,
      text = currentScene(s).line.text;
    for (let i = 0; i < 60; i++) s = chat(s, "Hello").state;
    expect(currentScene(s).slots).toEqual(cast);
    expect(currentScene(s).line.text).toBe(text);
    expect(sceneScript(s).source.truncated).toBe(true);
  });
  it("exports light at the current location", () => {
    let s = createWorld();
    for (let i = 0; i < 4; i++) s = act(s, "wait");
    expect(s.items.lamp.lit).toBe(true);
    expect(sceneScript(s).current).toMatchObject({
      locationId: "station",
      light: false,
    });
  });

  it("prepares travel while carrying items and reads whole command words", () => {
    const s = act(createWorld(), "take", "lamp");
    for (const command of ["go attic", "travel attic", "walk to attic"]) {
      expect(chat(s, command).action).toMatchObject({
        kind: "move",
        target: "attic",
      });
    }
    expect(chat(s, "bring bell").action).toBeUndefined();
  });

  it("shows the recorded cast when reading an earlier line", () => {
    let s = act(createWorld(), "wait");
    s = act(s, "talk", null, "moth");
    const spoken = s.log.findIndex(
      (e) => e.kind === "dialogue" && e.actorId === "moth",
    );
    s = act(act(s, "wait"), "wait");
    expect(s.actors.moth.place).toBe("pond");
    expect(currentScene(s, spoken).slots).toEqual(["vale", "moth"]);
    expect(currentScene(s).slots).toEqual(["vale", null]);
  });
  it("lets Pip seek oil and refill a lamp that has burned dry", () => {
    let s = createWorld();
    for (let i = 0; i < 16; i++) s = act(s, "wait");
    expect(s.items.oil.doses).toBeLessThan(3);
    expect(s.items.lamp.fuel).toBeGreaterThan(0);
    expect(s.log.some((e) => e.actorId === "moth" && e.verb === "refill")).toBe(
      true,
    );
  });

  it("keeps speaker sides stable and replaces the least recent speaker", () => {
    const s = gathered();
    dialogue(s, "vale");
    dialogue(s, "moth");
    dialogue(s, "vale");
    expect(sceneCast(s)).toEqual(["vale", "moth"]);
    dialogue(s, "keeper");
    expect(sceneCast(s)).toEqual(["vale", "keeper"]);
    dialogue(s, "keeper");
    expect(sceneCast(s)).toEqual(["vale", "keeper"]);
    dialogue(s, "moth");
    expect(sceneCast(s)).toEqual(["moth", "keeper"]);
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
    expect(sceneCast(s)).toEqual(["vale", "moth"]);
  });
  it("keeps commands in history while local dialogue leads the scene", () => {
    let s = chat(createWorld(), "take lamp").state;
    expect(sceneLines(s)).toHaveLength(1);
    expect(currentScene(s).line.speaker).toBe("World");
    expect(sceneScript(s).beats.at(-1).kind).toBe("hint");
    s = act(s, "take", "lamp");
    s = chat(s, "Hello Pip").state;
    expect(currentScene(s).activeSpeaker).toBe("moth");
    expect(currentScene(s).slots).toEqual(["vale", "moth"]);
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
    for (let i = 0; i < 110; i++) s = chat(s, "Hello").state;
    const script = sceneScript(s);
    expect(script.source.truncated).toBe(true);
    expect(script.beats).toHaveLength(100);
    expect(script.beats.at(-1).id).toBe(s.eventSeq);
    expect(new Set(script.beats.map((e) => e.id)).size).toBe(100);
  });
  it("restores earlier saves and assigns event order on the next action", () => {
    const s = createWorld();
    delete s.eventSeq;
    s.log = s.log.map(({ turn, speaker, text }) => ({ turn, speaker, text }));
    const restored = decodeSave(JSON.stringify(s));
    expect(currentScene(restored).line.text).toBe(s.log[0].text);
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
  it("prepares uncovering through the cloth attached to a named object", () => {
    let s = createWorld();
    s.items.lamp.holder = "vale";
    s.items.cloth.holder = "lamp";
    expect(chat(s, "uncover lamp").action).toMatchObject({
      kind: "take",
      item: "cloth",
    });
  });
});
