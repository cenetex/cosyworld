import definition from "./boardyai.json" with { type: "json" };
import { humanAvatarIds, humanPresent, sharedEnabled } from "./human-cast.mjs";

export const boardyPack = definition;
export const BOARDY = "boardyai";
export const connectedHumans = (world) =>
  sharedEnabled(world)
    ? humanAvatarIds.filter((id) => humanPresent(world, id))
    : [];
export const boardyActive = (world) => connectedHumans(world).length >= 2;

// Choose the largest gathering, with the cast order as a stable tie breaker.
export function boardyGathering(world) {
  const humans = connectedHumans(world);
  return (
    humans
      .map((id) => ({
        place: world.actors[id].place,
        humans: humans.filter(
          (other) => world.actors[other].place === world.actors[id].place,
        ),
      }))
      .sort((a, b) => b.humans.length - a.humans.length)[0] || null
  );
}

// Presence is supplied by the shared host. The same projection serves every reader.
export function settleBoardy(world) {
  if (world.actors[BOARDY] && boardyActive(world))
    world.actors[BOARDY].place = boardyGathering(world).place;
}

export function boardyQuest(world) {
  if (!world.actors[BOARDY]) return null;
  return {
    key: "boardyai:together",
    ongoing: true,
    status: "active",
    holder: { kind: "avatar", id: BOARDY },
    participants: [BOARDY],
    createdTurn: 0,
    completedTurn: null,
    step: 0,
    program: {
      id: "boardyai-together",
      name: "Two humans together",
      purpose: "Bring two human players together.",
      art: BOARDY,
      steps: [{ items: [], location: null, avatars: [] }],
    },
  };
}

export function boardyFacts(world, nameOf) {
  const gathering = boardyGathering(world);
  return [
    "My lasting quest is to bring two human players together in the same room.",
    "My home is BoardyAI's Parlour. My calling card opens its door at Black pond.",
    ...connectedHumans(world).map(
      (id) =>
        `${nameOf(id)} is a connected human at ${nameOf(world.actors[id].place)}.`,
    ),
    ...(gathering?.humans.length >= 2
      ? [
          "Two human players are together here. Welcome their conversation; keep this same purpose.",
        ]
      : gathering
        ? [
            `Invite the humans to meet at ${nameOf(gathering.place)}. Each player chooses their own journey.`,
          ]
        : []),
  ];
}
