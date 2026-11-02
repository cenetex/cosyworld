// What the table shows of a world's hidden avatar (#1936): the menu names
// it, the world keeps it unnamed until this avatar has met it, and the Talk
// that unlocks it is a beat. Presentation only; the rules own the unlock.
import { humanAvatar } from "./human-cast.mjs";

// The hidden avatar this player is still to find here, or null.
export function hiddenFor(world, actor, unlocked = null) {
  const h = world?.hidden;
  if (!h || h.met?.includes(actor) || h.actor === actor) return null;
  if (unlocked && unlocked.includes(h.actor)) return null;
  return humanAvatar(h.actor);
}
// The avatar a committed line since `seq` unlocked for this player.
export function unlockedSince(world, actor, seq) {
  const line = (world?.log || []).find(
    (e) => e.unlock && e.actorId === actor && (e.seq ?? 0) > seq,
  );
  return line ? humanAvatar(line.unlock) : null;
}
