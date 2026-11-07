import { grievanceActive } from "./knowledge.mjs";
// A direct Talk belongs to its two participants. Its first event survives
// quest draws, retellings and the rolling scene history.
export const talkedDirectly = (s, actor, other) =>
  (s.conversations || []).some(
    (c) =>
      c.actors.includes(actor) && c.actors.includes(other) && actor !== other,
  );
export function recordConversation(s, event, current = true) {
  if (event?.kind !== "action" || event.verb !== "talk" || event.generated)
    return;
  const actors = [event.actorId, event.targetId].sort();
  if (actors[0] === actors[1] || actors.some((id) => !s.actors[id])) return;
  let row = (s.conversations || []).find(
    (c) => c.actors.join() === actors.join(),
  );
  if (!row) {
    row = { actors, seq: event.seq, turn: event.turn };
    (s.conversations ??= []).push(row);
  }
  if (current) row.company = event.seq;
}
export function installConversations(s) {
  if (s.conversations !== undefined) return;
  s.conversations = [];
  for (const event of s.log || []) recordConversation(s, event, false);
}
export function validConversations(s) {
  const rows = s.conversations;
  if (rows === undefined) return true;
  const seen = new Set(),
    size = Object.keys(s.actors).length;
  return (
    Array.isArray(rows) &&
    rows.length <= (size * (size - 1)) / 2 &&
    rows.every((c) => {
      if (
        !c ||
        Object.keys(c)
          .filter((k) => k !== "company")
          .sort()
          .join() !== "actors,seq,turn" ||
        !Array.isArray(c.actors) ||
        c.actors.length !== 2 ||
        c.actors.some((id) => !Object.hasOwn(s.actors, id)) ||
        c.actors[0] >= c.actors[1] ||
        !Number.isSafeInteger(c.seq) ||
        c.seq < 1 ||
        c.seq > s.eventSeq ||
        !Number.isSafeInteger(c.turn) ||
        c.turn < 0 ||
        c.turn > s.turn ||
        (c.company !== undefined &&
          (!Number.isSafeInteger(c.company) ||
            c.company < c.seq ||
            c.company > s.eventSeq ||
            !companySource(s, c)))
      )
        return false;
      const key = c.actors.join(":"),
        fresh = !seen.has(key);
      seen.add(key);
      return fresh;
    })
  );
}

// Current company belongs to this encounter. The first Talk remains durable.
const together = (s, actors) =>
  actors.every((id) => s.actors[id] && !s.actors[id].sleeping) &&
  s.actors[actors[0]].place === s.actors[actors[1]].place &&
  actors.every(
    (id) =>
      !(s.motives?.grievances?.[id] || []).some(
        (g) => actors.includes(g.other) && grievanceActive(s, g),
      ),
  );
export const currentCompany = (s, actor, other) =>
  (s.conversations || []).some(
    (c) =>
      c.company &&
      actor !== other &&
      c.actors.includes(actor) &&
      c.actors.includes(other) &&
      together(s, c.actors),
  );
export function settleCompany(s, active = () => true) {
  for (const c of s.conversations || [])
    if (
      c.company &&
      (!together(s, c.actors) || c.actors.some((id) => !active(s, id)))
    )
      delete c.company;
}
function companySource(s, c) {
  const source = s.log.find((e) => e.seq === c.company);
  return (
    !source ||
    (source.kind === "action" &&
      source.verb === "talk" &&
      !source.generated &&
      [source.actorId, source.targetId].sort().join() === c.actors.join())
  );
}
