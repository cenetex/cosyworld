import definition from "./boardyai.json" with { type: "json" };
import { humanAvatarIds, humanPresent, sharedEnabled } from "./human-cast.mjs";

export const boardyPack = definition;
export const BOARDY = "boardyai";
export const connectedHumans = (world) =>
  sharedEnabled(world)
    ? humanAvatarIds.filter((id) => humanPresent(world, id))
    : [];
export const boardyActive = (world) => connectedHumans(world).length >= 2;

// Facts only: where Boardy's home is and where each human was last seen.
// His temperament lives in the persona, not in authored first-person lines.
export function boardyFacts(world, nameOf) {
  const here = world.actors[BOARDY].place;
  return [
    "My home is BoardyAI's Parlour. My calling card opens its door at Empty station, held or left there.",
    ...connectedHumans(world).map((id) =>
      world.actors[id].place === here
        ? `${nameOf(id)} is here with me.`
        : world.memories[BOARDY].seen?.[id]
          ? `I last saw ${nameOf(id)} at ${nameOf(world.memories[BOARDY].seen[id].place)}. They may have moved since then.`
          : `I have yet to find ${nameOf(id)}.`,
    ),
  ];
}
