import "./helpers/no-dwell.mjs";
import { expect, it } from "vitest";
import { createWorld, legalActions, play } from "../v2/card-game/world.mjs";
import { entityActive } from "../v2/card-game/pack-registry.mjs";
import { perception, listenerOf } from "../v2/card-game/perception.mjs";
import {
  assistantRoleScenes,
  perceptionScenes,
} from "./fixtures/card-voice-eval-cases.mjs";

const scene = (cases, name) => cases.find((c) => c.name === name).context;
const seen = (context, id) =>
  context.entities.find((e) => e.id === id).perception;

it("ranks this moment's changes by how much they involve the speaker", () => {
  const harbor = scene(assistantRoleScenes(), "harbor wait with Myrto");
  // Pip's request names Vale and Pip; Vale's own Wait is not a change.
  expect(harbor.events[seen(harbor, "vale").changes[0]]).toBe(
    "Pip asks Vale for the Lamp. Vale keeps it for now.",
  );
  expect(seen(harbor, "vale").changes).toHaveLength(1);
  const crowd = scene(perceptionScenes(), "P1 crowded station");
  const [first, second] = seen(crowd, "moth").changes;
  expect(crowd.events[first]).toMatch(/^Pip asks Vale for the Lamp/);
  expect(crowd.events[second]).toMatch(/^The keeper/);
  // Only speakers carry a view; places and things never do.
  expect(crowd.entities.filter((e) => e.perception).map((e) => e.id)).toEqual(
    crowd.speakers,
  );
});

it("compares an arrival with the visit before it, once", () => {
  const cases = perceptionScenes();
  expect(seen(scene(cases, "P2 back at the pond"), "vale").arrival).toEqual({
    came: "bell",
  });
  expect(seen(scene(cases, "P4 alone at the pond"), "vale").arrival).toEqual({
    gone: "moth",
  });
  // A speaker leaving this place has no arrival here.
  expect(seen(scene(cases, "P3 the pond pulls"), "keeper").arrival).toBeNull();
});

it("pulls only toward a wanted place one path away", () => {
  const world = createWorld();
  const view = (location) =>
    perception(world, "vale", {
      speakers: ["vale"],
      entries: [],
      actor: "vale",
      present: ["vale"],
      desire: { items: [], location, avatars: [] },
      location: world.actors.vale.place,
    });
  expect(view("pond").pull).toBe("pond");
  expect(view("greek-harbor").pull).toBeUndefined();
  expect(listenerOf(["vale", "moth"], "moth", "vale")).toBe("vale");
  expect(listenerOf(["vale", "moth"], "vale", "vale")).toBe("moth");
});

it("does not count a thing that is out of play as newly come", () => {
  const act = (s, kind, target) =>
    play(
      s,
      legalActions(s).find(
        (a) =>
          a.kind === kind &&
          !a.sleep &&
          !a.guards &&
          (!target || a.target === target),
      ),
    ).state;
  const world = createWorld();
  world.actors.moth.place = world.actors.keeper.place = "pond";
  world.actors.moth.want = world.actors.keeper.want = null;
  const home = world.actors.vale.place;
  const hidden = Object.keys(world.items).find(
    (id) => world.items[id].holder === home && !entityActive(world, id),
  );
  expect(hidden).toBeTruthy();
  const back = act(act(act(act(world, "move"), "move", home), "move"), "move", home);
  const view = perception(back, "vale", {
    speakers: ["vale"],
    entries: [],
    actor: "vale",
    present: ["vale"],
    desire: null,
    location: home,
  });
  expect(view.arrival?.came).not.toBe(hidden);
});
