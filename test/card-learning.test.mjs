import { questing } from "./helpers/first-quest.mjs";
import { describe, it, expect } from "vitest";
import { rest } from "./fixtures/card-rest.mjs";
import {
  createWorld as baseCreateWorld,
  legalActions,
  play,
  plan,
  encodeSave,
  decodeSave,
  addLog,
} from "../v2/card-game/world.mjs";
// Play here starts past the pond, where the first quest begins.
const createWorld = (...args) => questing(baseCreateWorld(...args));
import { enableMotives } from "../v2/card-game/motives.mjs";
import {
  narrativeContext,
  applyGeneratedText,
} from "../v2/card-game/narrative.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { reconsiderPlan } from "../v2/card-game/learning.mjs";
function bargain() {
  const world = enableMotives(createWorld());
  world.actors.keeper.place = "station";
  world.items.lamp.holder = "vale";
  world.items.bell.holder = "keeper";
  // Vale wants the keeper's oil for the whole exchange.
  world.actors.vale.want = { kind: "item", target: "oil", since: 0, refusals: 0 };
  // The keeper wants nothing for now, so its side of the request holds still.
  world.actors.keeper.want = null;
  return world;
}
const askOil = (world) =>
  legalActions(world).find((a) => a.kind === "ask" && a.item === "oil");
function refused() {
  const s = bargain();
  return play(s, askOil(s)).state;
}
function speech(world) {
  const context = narrativeContext(world);
  const reflection = {
    thought: "I expected an easy gift. I should offer something useful.",
    persona: "I am learning to listen before I ask again.",
    dream: "A small boat carried a gift across the pond.",
    evidence: context.entities
      .find((e) => e.id === "vale")
      .memories.filter((m) => m.kind === "event")
      .map((m) => m.seq),
    models: {
      thought: "thought-model",
      persona: "persona-model",
      dream: "dream-model",
    },
  };
  return {
    context,
    response: {
      revision: context.revision,
      model: "voice-model",
      entries: context.entities.map((e) => ({
        id: e.id,
        text: "The shore feels quiet.",
        ...(e.id === "vale" ? { reflection } : {}),
      })),
    },
  };
}
describe("avatar learning", () => {
  it("records an unknown first estimate and the measured request outcome", () => {
    const world = refused();
    const lesson = world.memories.vale.learning.at(-1);
    expect(lesson).toMatchObject({
      version: 2,
      expected: { value: null, samples: 0, local: 0 },
      before: { met: false },
      after: { met: false },
      reward: -1,
      goal: { target: "keeper", item: "oil" },
    });
    expect(world.log.find((e) => e.seq === lesson.seq)).toMatchObject({
      verb: "ask",
      accepted: false,
      text: lesson.evidence,
    });
    expect(decodeSave(encodeSave(world))).toEqual(world);
    expect(
      narrativeContext(world)
        .entities.find((e) => e.id === "vale")
        .facts.join(" "),
    ).toContain("This was my first measured try at that approach.");
  });
  it("uses a saved lesson after the short action history has passed", () => {
    const world = refused();
    world.actors.keeper.place = "station";
    world.log = world.log.filter((e) => e.actorId !== "vale");
    const choice = plan(world);
    expect(choice.lessonSeq).toBe(world.memories.vale.learning.at(-1).seq);
    expect(["talk", "wait", "trade"]).toContain(choice.action.kind);
    expect(plan(decodeSave(encodeSave(world)))).toEqual(choice);
  });
  it("reconsiders a request when its conditions change", () => {
    const world = refused();
    world.actors.keeper.place = "station";
    const selected = { action: askOil(world), reason: "Ask for oil." };
    expect(
      reconsiderPlan(world, "vale", selected, legalActions(world)).lessonSeq,
    ).toBeDefined();
    world.actors.keeper.trust.vale = 2;
    const revised = reconsiderPlan(
      world,
      "vale",
      selected,
      legalActions(world),
    );
    expect(revised.learning.exploring).toBe(true);
    expect(revised.learning.expected.local).toBe(0);
  });
  it("rejects invented strategies and altered evidence", () => {
    for (const change of [
      (l) => (l.strategy = "take_by_force"),
      (l) => (l.evidence = "An invented agreement."),
      (l) => (l.after.met = true),
    ]) {
      const world = refused();
      change(world.memories.vale.learning[0]);
      expect(() => decodeSave(JSON.stringify(world))).toThrow();
    }
  });
  it("keeps source events, the earlier persona and each model", () => {
    const world = rest(refused(), { dream: true });
    const { context, response } = speech(world);
    const next = applyGeneratedText(world, context, response);
    const audit = next.memories.vale.reflections[0];
    expect(audit.previousPersona).toBe(null);
    expect(audit.sources.map((e) => e.seq)).toEqual(
      response.entries.find((e) => e.id === "vale").reflection.evidence,
    );
    expect(audit.models.persona).toBe("persona-model");
    expect(audit.models.thought).toBe("thought-model");
    expect(decodeSave(encodeSave(next))).toEqual(next);
    const altered = structuredClone(next);
    altered.memories.vale.reflections[0].sources[0].text =
      "An invented encounter.";
    expect(() => decodeSave(JSON.stringify(altered))).toThrow();
    response.entries.find((e) => e.id === "vale").reflection.evidence = [
      999999,
    ];
    expect(() => applyGeneratedText(world, context, response)).toThrow();
  });
  it("commits shared growth and keeps another player's inner life private", () => {
    let world = dispatchShared({
      op: "create",
      save: encodeSave(rest(refused(), { dream: true })),
    }).world;
    const entry = speech(world).response.entries.find((e) => e.id === "vale");
    world = dispatchShared({
      op: "speech",
      world,
      actor: "vale",
      claimed: ["vale"],
      present: ["vale"],
      room: world.actors.vale.place,
      lines: [{ actorId: "vale", text: entry.text }],
      entries: [{ ...entry, model: "voice-model" }],
    }).world;
    expect(world.memories.vale.reflections[0].models.persona).toBe(
      "persona-model",
    );
    const view = (actor) =>
      dispatchShared({
        op: "view",
        world,
        actor,
        claimed: ["vale", "mara"],
        present: ["vale", "mara"],
      }).world;
    expect(view("vale").memories.vale.innerLife.persona).toContain("listen");
    for (const key of ["innerLife", "reflections", "learning"])
      expect(view("mara").memories.vale[key]).toBeUndefined();
    expect(world.memories.vale.innerLife).toBeDefined();
  });
  it("rejects shared reflections assigned to a different speaker", () => {
    const world = dispatchShared({
      op: "create",
      save: encodeSave(refused()),
    }).world;
    const entry = speech(world).response.entries.find((e) => e.id === "vale");
    expect(() =>
      dispatchShared({
        op: "speech",
        world,
        actor: "vale",
        claimed: ["vale"],
        present: ["vale"],
        lines: [{ actorId: "vale", text: "I hear you." }],
        entries: [{ ...entry, id: "moth" }],
      }),
    ).toThrow();
  });
  it("marks conversation with its actual witnesses for later arrivals", () => {
    const world = createWorld();
    world.actors.moth.place = "attic";
    addLog(world, "Vale", "The keeper shared a quiet story.", {
      kind: "dialogue",
      generated: true,
      actorId: "vale",
      locationId: "station",
      cast: ["vale"],
    });
    world.turn = 1;
    world.revision = 1;
    world.actors.moth.place = "station";
    const context = narrativeContext(world);
    expect(context.conversation[0].witnesses).toEqual(["vale"]);
    expect(
      context.entities
        .find((e) => e.id === "moth")
        .memories.some((m) => m.text.includes("quiet story")),
    ).toBe(false);
  });
  it("keeps an absent shared player out of witnessed conversation", () => {
    const world = createWorld();
    world.sharedVersion = 1;
    world.controlledActors = ["vale", "mara"];
    world.presentActors = ["vale"];
    world.actors.mara.place = world.actors.vale.place;
    addLog(world, "Vale", "The keeper shared a quiet story.", {
      kind: "dialogue",
      generated: true,
      actorId: "vale",
    });
    world.turn = 1;
    world.revision = 1;
    const context = narrativeContext(world);
    expect(context.conversation[0].witnesses).toEqual(["vale"]);
    expect(
      world.memories.mara.events.some((e) => e.text.includes("quiet story")),
    ).toBe(false);
    expect(context.outcome.avatars.some((a) => a.id === "mara")).toBe(false);
  });
});
