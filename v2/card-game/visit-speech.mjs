const moved = (entry, id) =>
  !entry.generated &&
  entry.fromLocationId &&
  entry.fromLocationId !== entry.locationId &&
  (entry.actorId === id ||
    (entry.verb === "accompany" && entry.accepted && entry.targetId === id));
const ordinaryWait = (a) =>
  (a.kind === "wait" || a.verb === "wait") && !a.sleep && !a.guards;

export function visitSpeech(world, id) {
  const actor = world.actors[id];
  if (actor.waitSpeech?.place === actor.place) return actor.waitSpeech;
  // Earlier saves use the first retained Wait since their latest arrival.
  const arrival = world.log.findLast((e) => moved(e, id))?.seq ?? 0;
  const waited =
    !actor.waitSpeech &&
    world.log.find(
      (e) =>
        e.seq > arrival &&
        e.actorId === id &&
        e.locationId === actor.place &&
        !e.generated &&
        ordinaryWait(e),
    );
  return { place: actor.place, turn: waited ? waited.turn : null };
}

export function settleVisitSpeech(before, next, action) {
  for (const [id, actor] of Object.entries(next.actors)) {
    if (id !== action.actor && !actor.waitSpeech) continue;
    const left =
      before.actors[id]?.place !== actor.place ||
      next.log.some((e) => e.seq > before.eventSeq && moved(e, id));
    actor.waitSpeech = left
      ? { place: actor.place, turn: null }
      : visitSpeech(before, id);
    const waiting = id === action.actor && !left && ordinaryWait(action);
    if (waiting && actor.waitSpeech.turn === null)
      actor.waitSpeech = { place: actor.place, turn: next.turn };
  }
}

export function validVisitSpeech(actor, turn) {
  const saved = actor.waitSpeech;
  if (saved === undefined) return true;
  if (!saved || Object.keys(saved).sort().join() !== "place,turn") return false;
  const validTurn =
    saved.turn === null ||
    (Number.isSafeInteger(saved.turn) && saved.turn >= 0 && saved.turn <= turn);
  return (
    typeof saved.place === "string" && saved.place.length <= 128 && validTurn
  );
}
