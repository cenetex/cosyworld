// A direct Talk belongs to its two participants. Its first event survives
// quest draws, retellings and the rolling scene history.
export const talkedDirectly = (s, actor, other) =>
  (s.conversations || []).some(
    (c) =>
      c.actors.includes(actor) && c.actors.includes(other) && actor !== other,
  );
export function recordConversation(s, event) {
  if (event?.kind !== "action" || event.verb !== "talk") return;
  const actors = [event.actorId, event.targetId].sort();
  if (actors[0] === actors[1] || actors.some((id) => !s.actors[id])) return;
  if (!talkedDirectly(s, ...actors))
    (s.conversations ??= []).push({ actors, seq: event.seq, turn: event.turn });
}
export function installConversations(s) {
  if (s.conversations !== undefined) return;
  s.conversations = [];
  for (const event of s.log || []) recordConversation(s, event);
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
        Object.keys(c).sort().join() !== "actors,seq,turn" ||
        !Array.isArray(c.actors) ||
        c.actors.length !== 2 ||
        c.actors.some((id) => !Object.hasOwn(s.actors, id)) ||
        c.actors[0] >= c.actors[1] ||
        !Number.isSafeInteger(c.seq) ||
        c.seq < 1 ||
        c.seq > s.eventSeq ||
        !Number.isSafeInteger(c.turn) ||
        c.turn < 0 ||
        c.turn > s.turn
      )
        return false;
      const key = c.actors.join(":"),
        fresh = !seen.has(key);
      seen.add(key);
      return fresh;
    })
  );
}
