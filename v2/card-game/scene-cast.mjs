// Who is in a scene and who speaks after a committed play. These are rules,
// not presentation: the shared speech reducer checks committed reflections
// against this cast, so it belongs to the shared engine while scene staging
// and dialogue wording stay outside it.
// See docs/design/pack-content-outside-the-engine.md.
import { currentActor, itemPlace } from "./world.mjs";
import { entityActive } from "./pack-registry.mjs";
import { knownActors } from "./want.mjs";
import { hasTemperament } from "./pack-rules.mjs";

// Residents who arrived at or left the player's place this turn.
export function sceneChanges(world) {
  const here = world.actors[currentActor(world)].place;
  return world.log
    .filter(
      (entry) =>
        entry.turn === world.turn &&
        !entry.generated &&
        entry.actorId &&
        entry.actorId !== currentActor(world) &&
        entityActive(world, entry.actorId) &&
        entry.fromLocationId &&
        entry.locationId !== entry.fromLocationId &&
        (entry.locationId === here || entry.fromLocationId === here) &&
        world.actors[entry.actorId].place === entry.locationId,
    )
    .map((entry) => ({
      actorId: entry.actorId,
      from: entry.fromLocationId,
      to: entry.locationId,
      leaving: entry.fromLocationId === here,
    }));
}

// Keep a few lasting encounters beside fresh facts. Speech stays secondary to
// witnessed events. Hidden puzzle bookkeeping is not dialogue material.
export function speechMemories(memory, { expressions = true } = {}) {
  const concrete = (e) =>
    e.kind === "event" &&
    !/completes hand|finds a new purpose:| Level \d/u.test(e.text);
  const recent = memory.events.filter(concrete).slice(-4);
  const lasting = (memory.landmarks || [])
    .filter(concrete)
    .filter((e) => !recent.some((r) => r.seq === e.seq))
    .slice(-2);
  const said = expressions
    ? memory.events.filter((e) => e.kind === "expression").slice(-2)
    : [];
  return [...lasting, ...recent, ...said]
    .sort((a, b) => a.seq - b.seq)
    .map(({ seq, turn, kind, text }) => ({ seq, turn, kind, text }));
}

// The resident who beat the player this turn, when the player came to here.
export function defeatedBy(world, location) {
  const actor = currentActor(world);
  const moved = world.log.findLast(
    (e) =>
      e.turn === world.turn &&
      !e.generated &&
      e.actorId === actor &&
      e.locationId === location &&
      e.fromLocationId &&
      e.fromLocationId !== location &&
      (["retreat", "sent-home"].includes(e.verb) ||
        (!e.verb && /after yielding to/u.test(e.text || ""))),
  );
  const blow =
    moved &&
    world.log.findLast(
      (e) =>
        e.turn === world.turn &&
        e.verb === "attack" &&
        e.targetId === actor &&
        e.seq < moved.seq,
    );
  return blow ? blow.actorId : null;
}

// The log is long; a Wait is recorded among this turn's newest entries.
function waitedThisTurn(world) {
  const actor = currentActor(world);
  for (let i = world.log.length - 1; i >= 0; i--) {
    const entry = world.log[i];
    if (entry.turn !== world.turn) return false;
    if (entry.verb === "wait" && entry.actorId === actor) return entry;
  }
  return false;
}

// The scene's place, audience, speakers and the entities it describes.
export function dialogueCast(world, action = null) {
  const location = world.actors[currentActor(world)].place;
  // Earlier opening text could include the authored solution. Keep those lines
  // in the save while grounding this unrevealed scene in observations.
  const beforeFirstLight = Boolean(
    world.opening?.version === 1 && !world.locations.attic.anchored,
  );
  const known = knownActors(world);
  const present = Object.keys(world.actors).filter(
    (id) =>
      known.includes(id) &&
      entityActive(world, id) &&
      world.actors[id].place === location &&
      (!world.controlledActors?.includes(id) ||
        world.presentActors?.includes(id)),
  );
  const localItems = Object.keys(world.items).filter(
    (id) => entityActive(world, id) && itemPlace(world, id) === location,
  );
  const changes = sceneChanges(world);
  const departing = changes
    .filter((change) => change.leaving)
    .map((change) => change.actorId);
  const awake = (id) => !hasTemperament(id) || world.actors[id].awake;
  const introductions = present.filter(
    (id) =>
      id !== currentActor(world) &&
      awake(id) &&
      world.opening?.met[id] === world.turn,
  );
  const audience = [...new Set([...present, ...departing])];
  const focus = localItems.includes(action?.item) ? action.item : null;
  const played = world.log.findLast(
    (entry) =>
      entry.turn === world.turn &&
      entry.kind === "action" &&
      entry.actorId === currentActor(world),
  );
  const target = action?.target || played?.targetId;
  const directPartner =
    audience.includes(target) &&
    target !== currentActor(world) &&
    awake(target);
  const partner = directPartner
    ? target
    : introductions[0] ||
      departing[0] ||
      present.find((id) => id !== currentActor(world) && awake(id));
  const movers = changes.map((change) => change.actorId);
  const chosen = new Set(
    [currentActor(world), partner, ...introductions, ...movers].filter(
      (id) => id && awake(id),
    ),
  );
  // After a defeat only one voice speaks: a resident here, or else the avatar.
  const defeat = defeatedBy(world, location);
  const host =
    defeat && present.find((id) => id !== currentActor(world) && awake(id));
  // Vale responds to every play. Other travellers keep their movement order.
  const speakers = defeat
    ? [host || currentActor(world)]
    : [
        currentActor(world),
        ...[...chosen].filter(
          (id) => id !== currentActor(world) && !movers.includes(id),
        ),
        ...movers.filter((id) => id !== currentActor(world) && chosen.has(id)),
      ].slice(0, 3);
  // Model requests stay bounded as the pack catalog grows. The actual chosen
  // card and every speaker take priority over incidental objects in a room.
  const ids = [
    ...new Set([
      location,
      ...speakers,
      focus,
      target,
      ...audience,
      ...localItems,
    ]),
  ]
    .filter(
      (id) =>
        id &&
        (id === location || audience.includes(id) || localItems.includes(id)),
    )
    .slice(0, 8);
  // Only the avatar who chose to wait turns inward this turn.
  const waited =
    speakers[0] === currentActor(world) &&
    (played?.verb === "wait" ? played : !played && waitedThisTurn(world));
  const resting = waited ? currentActor(world) : null;
  // Waking from a long rest at a sanctuary brings a dream.
  const rest = waited?.rest === "long" ? "long" : null;
  return {
    location,
    beforeFirstLight,
    known,
    present,
    localItems,
    changes,
    audience,
    focus,
    played,
    target,
    defeat,
    speakers,
    ids,
    resting,
    rest,
  };
}
