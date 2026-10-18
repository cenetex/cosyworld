import { describe, expect, it } from "vitest";
import {
  createWorld,
  play,
  legalActions,
  matchingActions,
  accompanyDecision,
  encodeSave,
  decodeSave,
  validateWorld,
  itemPlace,
  rootHolder,
  places,
  things,
} from "../v2/card-game/world.mjs";
import { cardPlay, playLabel } from "../v2/card-game/cards.mjs";
import {
  narrativeContext,
  applyGeneratedText,
} from "../v2/card-game/narrative.mjs";
import { sceneScript } from "../v2/card-game/scene.mjs";
import { profiles } from "../v2/card-game/memory.mjs";
import {
  generateProgram,
  hand,
  hold,
  at,
  withAvatars,
  either,
  sequence,
  desireFor,
  levelOf,
} from "../v2/card-game/quests.mjs";

function together() {
  const world = createWorld();
  world.actors.moth.place = "station";
  world.items.lamp.holder = "vale";
  return world;
}
function ongoingPip(world) {
  world.turn = world.revision = 8;
  const progress = (world.actors.moth.progress = {
    program: 2,
    step: 0,
    marks: [1, 2, 3, 4],
    completedHands: 4,
    recent: [],
  });
  progress.current = generateProgram(world, "moth", places, things);
  return progress;
}
function request(world, avatar, destination) {
  const { action } = cardPlay(world, [avatar, destination]);
  expect(action).toMatchObject({
    kind: "accompany",
    target: avatar,
    destination,
  });
  const result = play(world, action, world.revision);
  expect(result.ok).toBe(true);
  return result.state;
}
const reply = (world) => world.log.findLast((e) => e.verb === "accompany");
const wait = (world) => play(world, legalActions(world)[0]).state;

describe("accompany card requests", () => {
  it("previews either card order freely and keeps each destination distinct", () => {
    const world = together(),
      before = encodeSave(world);
    const trip = cardPlay(world, ["moth", "pond"]).action;
    expect(cardPlay(world, ["pond", "moth"]).action).toEqual(trip);
    expect(matchingActions(world, ["moth", "pond"])).toEqual([trip]);
    expect(playLabel(trip)).toBe("Accompany");
    expect(trip.text).toContain("asks Pip to accompany");
    expect(trip.key).not.toBe(cardPlay(world, ["moth", "attic"]).action.key);
    accompanyDecision(world, "vale", "moth", "pond");
    expect(encodeSave(world)).toBe(before);
    expect(cardPlay(world, ["vale", "pond"]).action.kind).toBe("move");
    expect(cardPlay(world, ["vale", "station"]).action.kind).toBe("wait");
    expect(cardPlay(world, ["moth", "station"]).action).toBeFalsy();
  });
  it("takes one shared trip toward a target hand while the other avatar acts", () => {
    const start = together(),
      before = encodeSave(start);
    const world = request(start, "moth", "pond");
    expect(world.turn).toBe(1);
    expect(world.revision).toBe(1);
    expect(world.actors.vale.place).toBe("pond");
    expect(world.actors.moth.place).toBe("pond");
    expect(world.actors.keeper.place).toBe("station");
    expect(world.items.lamp.holder).toBe("vale");
    expect(world.items.cloth.holder).toBe("moth");
    expect(reply(world)).toMatchObject({
      accepted: true,
      destinationId: "pond",
      fromLocationId: "station",
    });
    expect(
      world.log.filter(
        (e) => e.turn === 1 && e.kind === "action" && e.actorId === "moth",
      ),
    ).toHaveLength(0);
    expect(encodeSave(start)).toBe(before);
  });
  it("answers an unrelated trip with its current goal and resumes that goal next turn", () => {
    const world = request(together(), "moth", "attic");
    expect(reply(world).accepted).toBe(false);
    expect(reply(world).text).toContain("Black pond");
    expect(world.actors.vale.place).toBe("station");
    expect(world.actors.moth.place).toBe("station");
    const next = wait(world);
    expect(
      next.log.some(
        (e) =>
          e.turn === 2 &&
          e.actorId === "moth" &&
          e.verb === "ask" &&
          e.itemId === "lamp",
      ),
    ).toBe(true);
  });
  it("asks to collect a wanted item here before leaving it behind", () => {
    const start = together();
    start.items.lamp.holder = "station";
    const world = request(start, "moth", "pond");
    expect(reply(world).accepted).toBe(false);
    expect(world.items.lamp.holder).toBe("station");
    expect(wait(world).items.lamp.holder).toBe("moth");
  });
  it("counts both target hands at the same arrival and remembers their own items", () => {
    const start = createWorld();
    start.turn = start.revision = 1;
    start.actors.keeper.place = "station";
    start.actors.vale.progress = { program: 0, step: 1, marks: [1] };
    start.items.oil.holder = "vale";
    start.items.bell.holder = "keeper";
    const world = request(start, "keeper", "attic");
    expect(world.actors.vale.progress.step).toBe(2);
    expect(world.actors.keeper.progress.step).toBe(1);
    const fulfilled = world.log.filter((e) => e.kind === "quest");
    expect(fulfilled.map((e) => e.actorId)).toEqual(
      expect.arrayContaining(["vale", "keeper"]),
    );
    for (const entry of fulfilled)
      expect(entry.fulfillment.location).toBe("attic");
    expect(world.items.oil.history.at(-1)).toContain(
      "Vale carried it to Mirror attic",
    );
    expect(world.items.bell.history.at(-1)).toContain(
      "The keeper carried it to Mirror attic",
    );
    for (const id of ["vale", "keeper", "station", "attic", "oil", "bell"])
      expect(
        world.memories[id].events.some((e) =>
          e.text.includes("travel together"),
        ),
      ).toBe(true);
  });
  it("earns a level when a joint arrival completes the whole quest program", () => {
    const start = createWorld();
    start.turn = start.revision = 1;
    start.actors.keeper.place = "station";
    start.actors.keeper.progress = { program: 0, step: 1, marks: [1] };
    start.actors.moth.place = "attic";
    start.items.lamp.holder = "moth";
    start.items.cloth.holder = "keeper";
    const world = request(start, "keeper", "attic");
    expect(levelOf(world, "keeper")).toBe(2);
    expect(
      world.log.findLast((e) => e.kind === "quest" && e.actorId === "keeper"),
    ).toMatchObject({
      level: 2,
      fulfillment: { location: "attic", avatars: ["vale", "moth"] },
    });
  });
  it("joins a trip toward a distant wanted item before its final location", () => {
    const start = together();
    start.items.lamp.holder = "attic";
    const world = request(start, "moth", "attic");
    expect(reply(world).accepted).toBe(true);
    expect(wait(world).items.lamp.holder).toBe("moth");
  });
  it("joins wanted company when the hand allows any location", () => {
    const start = together();
    const progress = ongoingPip(start);
    start.actors.keeper.place = "pond";
    progress.current.steps = sequence(
      hand(hold("cloth"), withAvatars("keeper")),
      hand(hold("bell"), at("station")),
    );
    const world = request(start, "moth", "pond");
    expect(reply(world).accepted).toBe(true);
    expect(
      world.log.findLast((e) => e.kind === "quest" && e.actorId === "moth")
        .fulfillment.avatars,
    ).toContain("keeper");
  });
  it("uses every composable choice when deciding to join", () => {
    const start = together();
    const progress = ongoingPip(start);
    progress.current.steps = sequence(
      either(
        hand(hold("cloth"), at("attic"), withAvatars("vale")),
        hand(hold("cloth"), at("pond"), withAvatars("vale")),
      ),
      hand(hold("bell"), at("station")),
    );
    expect(desireFor(start, "moth").location).toBe("attic");
    validateWorld(start);
    const world = request(start, "moth", "pond");
    expect(reply(world).accepted).toBe(true);
    expect(
      world.log.findLast((e) => e.kind === "quest" && e.actorId === "moth")
        .target.location,
    ).toBe("pond");
  });
  it("crosses an open reflection with both inventories and advances fuel once", () => {
    const start = together();
    start.actors.vale.place = start.actors.moth.place = "attic";
    start.items.lamp.lit = true;
    start.items.lamp.fuel = 3;
    start.items.bell.holder = "moth";
    start.items.cloth.holder = "bell";
    const world = request(start, "moth", "pond");
    expect(world.actors.vale.crossed).toBe(1);
    expect(world.actors.moth.crossed).toBe(1);
    expect(world.items.lamp.fuel).toBe(2);
    expect(rootHolder(world, "cloth")).toBe("moth");
    expect(itemPlace(world, "cloth")).toBe("pond");
    expect(decodeSave(encodeSave(world))).toEqual(world);
    expect(request(decodeSave(encodeSave(start)), "moth", "pond")).toEqual(
      world,
    );
  });
  it("uses present avatars and open paths, and checks stale or forged requests", () => {
    const start = together(),
      action = cardPlay(start, ["moth", "pond"]).action;
    const later = wait(start),
      before = encodeSave(later);
    expect(play(later, action, start.revision).ok).toBe(false);
    expect(play(later, { ...action, key: action.key + ":forged" }).ok).toBe(
      false,
    );
    expect(encodeSave(later)).toBe(before);
    const closed = together();
    closed.actors.vale.place = closed.actors.moth.place = "attic";
    expect(cardPlay(closed, ["moth", "pond"]).action).toBeFalsy();
    expect(cardPlay(createWorld(), ["moth", "pond"]).action).toBeFalsy();
    const agreed = request(start, "moth", "pond");
    for (const patch of [
      { accepted: "yes" },
      { destinationId: "elsewhere" },
      { actorId: null },
      { targetId: "lamp" },
      { locationId: "station" },
    ]) {
      const broken = structuredClone(agreed);
      Object.assign(reply(broken), patch);
      expect(() => decodeSave(JSON.stringify(broken))).toThrow();
    }
  });
  it("answers a trip during a standoff before travelling", () => {
    const start = together();
    const threat = legalActions(start).find(
      (a) => a.kind === "threaten" && a.target === "moth",
    );
    const standoff = play(start, threat).state;
    const world = request(standoff, "moth", "pond");
    expect(reply(world).accepted).toBe(false);
    expect(reply(world).text).toContain("standoff");
    expect(world.actors.vale.place).toBe("station");
    expect(world.standoffs).toHaveLength(1);
    expect(world.standoffs[0].guarding.moth).toBe(false);
  });
  it("gives the model the recorded refusal even after an earlier promise", () => {
    const world = request(together(), "moth", "attic");
    world.memories.moth.text = "I will go with you.";
    const context = narrativeContext(world);
    expect(context.action).toContain("Pip declines the trip");
    expect(context.speakers).toEqual(["vale", "moth"]);
    for (const id of ["vale", "moth"]) {
      const entity = context.entities.find((e) => e.id === id);
      expect(entity.facts[0]).toContain(
        "Pip declined Vale's invitation to Mirror attic",
      );
      expect(entity.facts.length).toBeLessThanOrEqual(8);
      expect(entity.facts.every((fact) => fact.length <= 240)).toBe(true);
    }
    expect(context.entities.find((e) => e.id === "moth").previous).toContain(
      "will go",
    );
  });
  it("generates both speakers from the agreed result and exports the joint trip", () => {
    const world = request(together(), "moth", "pond");
    const context = narrativeContext(world);
    expect(context.location).toBe("pond");
    expect(context.speakers).toEqual(["vale", "moth"]);
    expect(context.action).toContain("Pip agrees");
    expect(context.entities.find((e) => e.id === "moth").facts[0]).toContain(
      "Pip agreed to Vale's invitation to Black pond",
    );
    const next = applyGeneratedText(world, context, {
      revision: world.revision,
      model: "fixture-model",
      entries: context.entities.map(({ id }) => ({
        id,
        text: `${profiles[id].name} recalls the joint trip.`,
      })),
    });
    expect(next.log.slice(-2).map((e) => e.actorId)).toEqual(["vale", "moth"]);
    expect(
      sceneScript(next).beats.find((e) => e.verb === "accompany"),
    ).toMatchObject({
      targetId: "moth",
      destinationId: "pond",
      accepted: true,
      performance: { pose: "walk" },
    });
    expect(decodeSave(encodeSave(next))).toEqual(next);
  });
});
