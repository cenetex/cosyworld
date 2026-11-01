import { createWorld, legalActions, play } from "../../v2/card-game/world.mjs";
import { summonTransport } from "../../v2/card-game/pack-transport.mjs";
import { isNight } from "../../v2/card-game/daylight.mjs";

export const argosPaintings = [
  ["greek-argos-palace", "aeschylus", "house-atreus-palace"],
  ["greek-argos-tomb", "aeschylus", "house-atreus-tomb"],
  ["greek-mycenae-palace", "sophocles", "house-atreus-mycenae"],
  ["greek-argive-farm", "euripides", "house-atreus-farmhouse"],
];

export function paintedStep(world, kind, fields = {}) {
  const action = legalActions(world).find(
    (a) =>
      a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  if (!action) throw new Error(`Missing ${kind} ${JSON.stringify(fields)}`);
  const result = play(world, action);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function atNight(world, night) {
  while (isNight(world) !== night) world = paintedStep(world, "wait");
  return world;
}

export function argosPaintingWorld(place, account, night) {
  let world = createWorld({ packScopes: { "greek-drama": "full" } });
  world.actors.vale.place = "greek-argolid-road";
  world.actors["greek-rhapsode"].place = "greek-argolid-road";
  world = paintedStep(world, "choose", { choiceId: `greek-atreid-${account}` });
  // The art fixture visits the selected account's place without releasing Argos.
  world.actors.vale.place = place;
  return atNight(world, night);
}

export function shipPaintingWorld(phase, night) {
  let world = createWorld();
  world.actors.vale.place = "pond";
  world = atNight(world, night);
  summonTransport(world, "greek-ship", "pond");
  world.crossings["pond-greek-harbor"].discovered = true;
  world = paintedStep(world, "move", { target: "greek-ship" });
  if (phase !== "docked")
    world = paintedStep(world, "course", { target: "greek-harbor" });
  if (phase === "arrived") world = paintedStep(world, "wait");
  if (world.transports["greek-ship"].phase !== phase)
    throw new Error(
      `Expected ${phase}, got ${world.transports["greek-ship"].phase}`,
    );
  return world;
}
