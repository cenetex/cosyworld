import { legalActions, play, exits } from "../../v2/card-game/world.mjs";
import {
  entityActive,
  packDefinition,
} from "../../v2/card-game/pack-registry.mjs";
import { transportUnlocked } from "../../v2/card-game/pack-transport.mjs";
import { resolveReadingReplay } from "../../v2/card-game/reading-actions.mjs";
import { houseGo } from "./greek-house-of-blood.mjs";
import { homecomingJourney } from "./greek-homecoming.mjs";

export const COURT = "greek-viii-poets-court";
export const POETS = ["greek-viii-aeschylus", "greek-viii-euripides"];
export const FROGS = "greek-viii-frogs";
export function readingPlay(world, kind, fields = {}, actor = "vale") {
  const action =
    legalActions(world, actor).find(
      (candidate) =>
        candidate.kind === kind &&
        Object.entries(fields).every(
          ([key, value]) => candidate[key] === value,
        ),
    ) ||
    (fields.key && resolveReadingReplay(world, actor, fields.key));
  if (!action) throw Error(`Missing ${kind}: ${JSON.stringify(fields)}`);
  const result = play(world, action, world.revision, actor);
  if (!result.ok) throw Error(result.error);
  return result.state;
}
export function finishReading(world, siteId, actor = "vale") {
  world = readingPlay(world, "read", { readingOp: "start", siteId }, actor);
  const id = `site:${siteId}:${actor}`;
  while (!world.packs["greek-drama"].poemReadings.readings[id].complete)
    world = readingPlay(
      world,
      "read",
      { readingOp: "page", readingId: id },
      actor,
    );
  return world;
}
export function readingWalk(world, actor, destination, playStep = readingPlay) {
  const docks = transportUnlocked(world, "greek-ship")
    ? packDefinition("greek-drama").transports["greek-ship"].docks.filter(
        (id) => entityActive(world, id),
      )
    : [];
  const queue = [[world.actors[actor].place]],
    seen = new Set();
  while (queue.length) {
    const path = queue.shift(),
      here = path.at(-1);
    if (here === destination) {
      for (const target of path.slice(1)) {
        if (target === "greek-ship")
          for (
            let i = 0;
            i < 32 &&
            !legalActions(world, actor).some(
              (a) => a.kind === "move" && a.target === target,
            );
            i++
          )
            world = playStep(world, "wait", {}, actor);
        world = playStep(world, "move", { target }, actor);
      }
      return world;
    }
    if (seen.has(here)) continue;
    seen.add(here);
    const links = exits(world, here, actor);
    if (docks.includes(here)) links.push("greek-ship");
    if (here === "greek-ship") links.push(...docks);
    for (const to of new Set(links))
      if (!seen.has(to)) queue.push([...path, to]);
  }
  throw Error(`No reading route to ${destination}`);
}
export function readHome(world, prefix, item) {
  world = readingPlay(world, "take", { item });
  world = houseGo(world, "greek-courtyard");
  return finishReading(world, prefix + "-homecoming");
}
export function courtJourney(burden = "carry") {
  let world = homecomingJourney().world;
  world = readingPlay(world, "choose", { choiceId: "greek-vii-open-accounts" });
  world = houseGo(world, "greek-underworld");
  world = readingPlay(world, "take", { item: "greek-viii-travel-bag" });
  if (burden === "xanthias") {
    world = readingPlay(world, "give", {
      item: "greek-viii-travel-bag",
      target: "greek-viii-xanthias",
    });
    world = readingPlay(world, "choose", { choiceId: FROGS + "-share-burden" });
  }
  world = houseGo(world, COURT);
  if (burden === "carry")
    world = readingPlay(world, "choose", { choiceId: FROGS + "-carry-burden" });
  return readingPlay(world, "take", { item: "greek-viii-verse-scales" });
}
