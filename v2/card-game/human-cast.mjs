import cast from "./shared-cast.json" with { type: "json" };

export const humanAvatars = cast.avatars;
export const humanAvatarIds = humanAvatars.map((a) => a.id);
// The first avatar per id, as find would return, without a closure per call.
const avatarById = new Map();
for (const a of humanAvatars)
  if (!avatarById.has(a.id)) avatarById.set(a.id, a);
export const humanAvatar = (id) => avatarById.get(id) || null;
export const currentActor = (world) => world.playerActorId || "vale";
export const controlledByHuman = (world, id) =>
  world.controlledActors ? world.controlledActors.includes(id) : id === "vale";
export const humanPresent = (world, id) =>
  controlledByHuman(world, id) &&
  (!world.presentActors || world.presentActors.includes(id));
export const sharedEnabled = (world) => world.sharedVersion === 1;
// Passkey v2 (#1846): a shared world seats all eight avatars. A human steers
// an avatar only while present; a held avatar whose holder is away, and an
// unheld one, lives there as a resident. `heldActors` keeps the claims.
export function seatActors(world, claimed, present) {
  world.heldActors = [...claimed];
  world.controlledActors = [...present];
  world.presentActors = [...present];
  return world;
}
export const heldByHuman = (world, id) =>
  (world.heldActors || world.controlledActors || ["vale"]).includes(id);
// An avatar living as a resident of a shared world.
export const residentAvatar = (world, id) =>
  sharedEnabled(world) &&
  Boolean(humanAvatar(id)) &&
  !controlledByHuman(world, id);
export const roomHumanCount = (world, place) =>
  humanAvatarIds.filter(
    (id) => humanPresent(world, id) && world.actors[id]?.place === place,
  ).length;
export const humanRoomAvailable = (world, actor, place, count = 1) =>
  !sharedEnabled(world) ||
  !controlledByHuman(world, actor) ||
  world.actors[actor]?.place === place ||
  roomHumanCount(world, place) + count <= 4;

// These seven homes join the existing shore. Vale, the station, the attic,
// the pond and the lamp keep their original definitions and behavior.
const visitors = humanAvatars.filter((a) => a.id !== "vale");
export const humanHomeGates = Object.fromEntries(
  visitors.map((a) => [a.home.id, { item: a.item.id, rescue: "pond" }]),
);
export const humanHomePack = {
  schemaVersion: 1,
  id: "shared-homes",
  packId: "cosyworld.shared-homes",
  revision: 1,
  name: "Homes beside the shore",
  description:
    "Seven visitors bring their belongings and homes to the existing shore.",
  entry: visitors[0].home.id,
  bridge: {
    id: "shared-homes-shore",
    description: "A visitor's belonging opens the way to their home.",
  },
  choices: [],
  places: Object.fromEntries(
    visitors.map((a) => [
      a.home.id,
      {
        name: a.home.name,
        text: a.home.text,
        persona: a.home.text,
        requires: [{ kind: "shared_world" }],
        exits: [],
        backdrop: a.home.image,
      },
    ]),
  ),
  avatars: Object.fromEntries(
    visitors.map((a) => [
      a.id,
      {
        name: a.name,
        text: a.text,
        place: a.home.id,
        home: a.home.id,
        seed: a.seed,
        requires: [{ kind: "shared_world" }],
        portrait: a.image,
        standoffs: false,
        tastes: {
          likes: a.pleasure,
          sore: "Someone deciding for them",
          reason: a.pleasure,
        },
        values: { [a.item.id]: 8 },
      },
    ]),
  ),
  items: Object.fromEntries(
    visitors.map((a) => [
      a.item.id,
      {
        name: a.item.name,
        text: `${a.item.verb}. ${a.home.entrance.text}`,
        requires: [{ kind: "shared_world" }],
        persona: `${a.item.name}. ${a.item.effect}.`,
        // Keep the local-save seed stable; sharing settles unused items at home.
        holder: a.id,
        art: a.item.image,
      },
    ]),
  ),
  crossings: visitors.flatMap((a) => [
    {
      // Crossing IDs stay stable in earlier saves and recorded actions.
      id: `pond-${a.home.id}`,
      from: a.home.connection || "pond",
      to: a.home.id,
      travelers: "player",
      requires: [
        { kind: "shared_world" },
        {
          kind: "item_near",
          item: a.item.id,
          place: a.home.connection || "pond",
        },
      ],
      travel: `through ${a.home.entrance.name.toLowerCase()}`,
      scenery: { open: a.home.entrance.text, cardArt: a.home.image },
    },
    {
      id: `${a.home.id}-pond`,
      from: a.home.id,
      to: a.home.connection || "pond",
      travelers: "player",
      requires: [
        { kind: "shared_world" },
        { kind: "item_near", item: a.item.id, place: a.home.id },
        {
          kind: "not",
          condition: { kind: "item_at", item: a.item.id, place: a.home.id },
        },
      ],
      travel: a.home.returnTravel || "back to the shore",
    },
  ]),
};
