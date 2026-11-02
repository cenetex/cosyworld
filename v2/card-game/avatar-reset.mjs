import { createWorld, fillSeatWants } from "./world.mjs";
import { enableMotives } from "./motives.mjs";

// A shared world's owner frees a seat, or its holder releases it (#1825). The
// avatar starts over as a fresh level-1 starter at its starting place: its
// level, experience, quest, memory, learning and routes go, and everything it
// held is dropped where it stood. The world keeps the dropped things.
export function resetAvatar(world, id) {
  // The fresh record is a new shared world's, where it lives as a resident
  // with a want (#1846).
  const fresh = enableMotives(createWorld({ opening: true }));
  fresh.sharedVersion = 1;
  fillSeatWants(fresh);
  const actor = world.actors[id];
  if (!actor || !fresh.actors[id]) throw new Error("Choose a human avatar.");
  const stood = actor.place;
  for (const item of Object.values(world.items))
    if (item.holder === id) item.holder = stood;
  world.actors[id] = structuredClone(fresh.actors[id]);
  // Everyone's trust in the newcomer starts at nothing, as theirs in others.
  for (const other of Object.values(world.actors))
    if (other.trust && Object.hasOwn(other.trust, id)) other.trust[id] = 0;
  world.memories[id] = structuredClone(fresh.memories[id]);
  if (world.life?.actors) {
    if (fresh.life?.actors?.[id])
      world.life.actors[id] = structuredClone(fresh.life.actors[id]);
    else delete world.life.actors[id];
  }
  if (world.knowledge?.known) delete world.knowledge.known[id];
  // A telling a Talk reserved for or by the avatar goes with what it knew,
  // or the world would hold a speaker who no longer knows the fact.
  if (Array.isArray(world.knowledge?.pending))
    world.knowledge.pending = world.knowledge.pending.filter(
      (p) => p.speaker !== id && p.listener !== id,
    );
  if (world.routeKnowledge) {
    if (fresh.routeKnowledge?.[id])
      world.routeKnowledge[id] = structuredClone(fresh.routeKnowledge[id]);
    else delete world.routeKnowledge[id];
  }
  if (world.motives?.grievances?.[id]) world.motives.grievances[id] = [];
  if (world.invitedPlaces) delete world.invitedPlaces[id];
  world.peaceUntil[id] = 0;
  if (world.defeats) delete world.defeats[id];
  world.standoffs = world.standoffs.filter(
    (c) => c.challenger !== id && c.defender !== id,
  );
  world.controlledActors = world.controlledActors.filter((a) => a !== id);
  world.presentActors = world.presentActors.filter((a) => a !== id);
  if (world.heldActors)
    world.heldActors = world.heldActors.filter((a) => a !== id);
  world.revision += 1;
  return world;
}
