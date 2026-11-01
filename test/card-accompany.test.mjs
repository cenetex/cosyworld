import { describe, expect, it } from "vitest";
import {
  createWorld,
  play,
  legalActions,
  matchingActions,
  accompanyDecision,
  encodeSave,
  decodeSave,
  itemPlace,
  rootHolder,
} from "../v2/card-game/world.mjs";
import { cardPlay, playLabel } from "../v2/card-game/cards.mjs";
import {
  narrativeContext,
  applyGeneratedText,
} from "../v2/card-game/narrative.mjs";
import { sceneScript } from "../v2/card-game/scene.mjs";
import { profiles } from "../v2/card-game/memory.mjs";
// Pip is at the station with Vale and wants to be at the pond.
function together() {
  const world = createWorld();
  world.actors.moth.place = "station";
  world.items.lamp.holder = "vale";
  world.actors.moth.want = { kind: "place", target: "pond", since: 0, refusals: 0 };
  return world;
}
// Pip's quest is the cloth the keeper holds at the pond, not anything Vale carries.
const wantsCloth = (world) => {
  world.items.cloth.holder = "keeper";
  world.actors.keeper.place = "pond";
  world.actors.keeper.want = null;
  world.actors.moth.want = { kind: "item", target: "cloth", since: 0, refusals: 0 };
  return world;
};
const wantsLamp = (world) => {
  world.actors.moth.want = { kind: "item", target: "lamp", since: 0, refusals: 0 };
  return world;
};
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
    expect(playLabel(trip)).toBe("Invite Pip along");
    expect(trip.text).toContain("asks Pip to accompany");
    expect(cardPlay(world, ["moth", "attic"]).action).toBeNull();
    accompanyDecision(world, "vale", "moth", "pond");
    expect(encodeSave(world)).toBe(before);
    expect(cardPlay(world, ["vale", "pond"]).action.kind).toBe("move");
    expect(cardPlay(world, ["vale", "station"]).action.kind).toBe("wait");
    expect(cardPlay(world, ["moth", "station"]).action).toBeFalsy();
  });
  it("takes one shared trip toward its want while the other avatar acts", () => {
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
  it("answers an unrelated trip with its current want and resumes that want next turn", () => {
    const start = wantsCloth(together());
    start.actors.vale.place = start.actors.moth.place = "pond";
    start.items.lamp.lit = true;
    const world = request(start, "moth", "attic");
    expect(reply(world).accepted).toBe(false);
    expect(reply(world).reason).toBe("wants-something-else");
    expect(world.actors.vale.place).toBe("pond");
    expect(world.actors.moth.place).toBe("pond");
    const next = wait(world);
    expect(
      next.log.some(
        (e) =>
          e.turn === 2 &&
          e.actorId === "moth" &&
          e.verb === "ask" &&
          e.itemId === "cloth",
      ),
    ).toBe(true);
  });
  it("asks to collect a wanted item here before leaving it behind", () => {
    const start = wantsLamp(together());
    start.items.lamp.holder = "station";
    const world = request(start, "moth", "pond");
    expect(reply(world).accepted).toBe(false);
    expect(world.items.lamp.holder).toBe("station");
    expect(wait(world).items.lamp.holder).toBe("moth");
  });
  it("joins a trip toward a distant wanted item", () => {
    const start = wantsLamp(together());
    start.actors.vale.place = start.actors.moth.place = "pond";
    start.items.lamp.lit = true;
    start.items.lamp.holder = "attic";
    const world = request(start, "moth", "attic");
    expect(reply(world).accepted).toBe(true);
    expect(wait(world).items.lamp.holder).toBe("moth");
  });
  it("crosses an open reflection with both inventories and advances fuel once", () => {
    // The lamp shining on the shore opens the pond's way back (#1600).
    const start = together();
    start.actors.vale.place = start.actors.moth.place = "pond";
    start.actors.moth.want.target = "attic";
    start.items.lamp.lit = true;
    start.items.lamp.fuel = 3;
    start.items.bell.holder = "moth";
    start.items.cloth.holder = "bell";
    const world = request(start, "moth", "attic");
    expect(world.actors.vale.crossed).toBe(1);
    expect(world.actors.moth.crossed).toBe(1);
    expect(world.items.lamp.fuel).toBe(2);
    expect(rootHolder(world, "cloth")).toBe("moth");
    expect(itemPlace(world, "cloth")).toBe("attic");
    expect(decodeSave(encodeSave(world))).toEqual(world);
    expect(request(decodeSave(encodeSave(start)), "moth", "attic")).toEqual(
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
    closed.items.lamp.lit = true;
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
  it("offers no trip while a standoff locks the room", () => {
    const start = together();
    const threat = legalActions(start).find(
      (a) => a.kind === "threaten" && a.target === "moth",
    );
    const standoff = play(start, threat).state;
    expect(standoff.standoffs).toHaveLength(1);
    expect(legalActions(standoff).some((a) => a.kind === "accompany")).toBe(
      false,
    );
  });
  it("gives the model the recorded refusal even after an earlier promise", () => {
    const start = wantsCloth(together());
    start.actors.vale.place = start.actors.moth.place = "pond";
    start.items.lamp.lit = true;
    const world = request(start, "moth", "attic");
    world.memories.moth.text = "I will go with you.";
    const context = narrativeContext(world);
    expect(context.action).toContain("Pip declines the trip");
    expect(context.speakers).toEqual(["vale", "moth"]);
    for (const id of ["vale", "moth"]) {
      const entity = context.entities.find((e) => e.id === id);
      expect(entity.facts[0]).toContain(
        "Pip declined Vale's invitation to Mirror attic",
      );
      expect(entity.facts.length).toBeLessThanOrEqual(16);
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
    expect(context.speakers).toEqual(["vale", "moth", "keeper"]);
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
    expect(next.log.slice(-3).map((e) => e.actorId)).toEqual(["vale", "moth", "keeper"]);
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
