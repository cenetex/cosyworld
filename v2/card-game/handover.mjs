// Capture the active demand before a Give changes custody or ends its battle.
export function pressureBeforeGive(s, a) {
  if (a.kind !== "give" || s.items[a.item]?.holder !== a.actor) return null;
  const c = s.standoffs.find(
    (c) =>
      c.defender === a.actor && c.challenger === a.target && c.item === a.item,
  );
  return c
    ? { kind: "pressure", openedTurn: c.opened, sourceSeq: c.sourceSeq ?? null }
    : null;
}

const sourceMatches = (s, seq, challenger, defender, item, turn, location) => {
  const e = s.log.find((e) => e.seq === seq);
  return (
    !e ||
    (e.kind === "action" &&
      !e.generated &&
      e.verb === "threaten" &&
      e.actorId === challenger &&
      e.targetId === defender &&
      e.itemId === item &&
      e.turn === turn &&
      e.locationId === location)
  );
};
const sequence = (seq, max) =>
  Number.isSafeInteger(seq) && seq > 0 && seq <= max;
export function validThreatSource(s, c) {
  return (
    c.sourceSeq === undefined ||
    (sequence(c.sourceSeq, s.eventSeq) &&
      sourceMatches(
        s,
        c.sourceSeq,
        c.challenger,
        c.defender,
        c.item,
        c.opened,
        c.location,
      ))
  );
}
export function validHandover(s, e) {
  const h = e.handover;
  return (
    h === undefined ||
    (h &&
      Object.keys(h).sort().join() === "kind,openedTurn,sourceSeq" &&
      h.kind === "pressure" &&
      e.kind === "action" &&
      !e.generated &&
      e.verb === "give" &&
      e.accepted === true &&
      s.items[e.itemId] &&
      s.actors[e.actorId] &&
      s.actors[e.targetId] &&
      e.actorId !== e.targetId &&
      sequence(e.seq, s.eventSeq) &&
      Number.isSafeInteger(h.openedTurn) &&
      h.openedTurn > 0 &&
      h.openedTurn <= e.turn &&
      (h.sourceSeq === null ||
        (sequence(h.sourceSeq, e.seq - 1) &&
          sourceMatches(
            s,
            h.sourceSeq,
            e.targetId,
            e.actorId,
            e.itemId,
            h.openedTurn,
            e.locationId,
          ))))
  );
}
