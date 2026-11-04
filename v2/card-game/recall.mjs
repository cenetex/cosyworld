// What a speaker remembers of the person it faces (P4): when it last saw
// them, and at most two earlier deeds or talks between the pair, scored in
// integers. Built from the committed log, outside the rules engine. Ids
// only; the server words them. A memory chosen at my previous moment with
// them waits a moment (the cooldown is recomputed, never stored).
import { profiles } from "./memory.mjs";
import { nameOf, rootHolder } from "./world.mjs";

const WEIGHT = { give: 60, threaten: 60, attack: 60, accompany: 60 };
const DEEDS = new Set(["ask", "give", "trade", ...Object.keys(WEIGHT)]);
const both = (e, a, b) =>
  [a, b].every((id) =>
    [...(e.cast || []), ...(e.witnesses || [])].includes(id),
  );

// Entities named in a line, other than the pair, once per log entry.
const topicsOf = new WeakMap();
function topicsIn(e, pair) {
  if (!topicsOf.has(e)) topicsOf.set(e, named(e.text || "", []));
  return topicsOf.get(e).filter((id) => !pair.includes(id));
}
function named(text, pair) {
  const low = text.toLowerCase();
  return Object.keys(profiles).filter((id) => {
    if (
      pair.includes(id) ||
      !["item", "location", "avatar"].includes(profiles[id].kind)
    )
      return false;
    const name = nameOf(id).toLowerCase().replace(/^the /u, "");
    return name.length > 2 && low.includes(name);
  });
}

// The pair's deeds and the topics of their last talk, before `turn`.
// A deed one of my facts already tells, or a keepsake I hold, is not told
// twice.
function told(world, id, e, shown) {
  const said = (e.text || "").split(". ")[0].replace(/\.$/u, "");
  return Boolean(
    (said && shown.some((fact) => fact.includes(said))) ||
      (e.verb === "give" &&
        e.targetId === id &&
        rootHolder(world, e.itemId) === id),
  );
}

function candidates(world, id, other, turn, shown) {
  const log = world.log;
  const deeds = new Map();
  let talk = null;
  for (const e of log) {
    if (e.turn >= turn) break;
    const pair = [e.actorId, e.targetId];
    if (
      !e.generated &&
      DEEDS.has(e.verb) &&
      pair.includes(id) &&
      pair.includes(other)
    ) {
      if (!told(world, id, e, shown))
        deeds.set(`${e.verb}|${e.actorId}|${e.itemId || ""}`, e);
    } else if (
      e.generated &&
      e.kind === "dialogue" &&
      [id, other].includes(e.actorId) &&
      both(e, id, other)
    ) {
      const topics = topicsIn(e, [id, other]);
      if (topics.length)
        talk = {
          verb: "talk",
          seq: e.seq,
          turn: e.turn,
          locationId: e.locationId,
          topics,
        };
    }
  }
  return [...deeds.values(), ...(talk ? [talk] : [])];
}

const keyOf = (c) => `${c.verb}|${c.actorId || ""}|${c.itemId || ""}`;

function score(world, c, id, frame) {
  const open =
    (c.verb === "ask" && c.actorId !== id && c.accepted === false) ||
    ["threaten", "attack"].includes(c.verb) ||
    (c.verb === "give" &&
      c.targetId === id &&
      rootHolder(world, c.itemId) === id);
  const ids = [c.itemId, c.locationId, ...(c.topics || [])].filter(Boolean);
  return (
    (WEIGHT[c.verb] ?? (c.verb === "talk" ? 20 : 40)) +
    (open ? 40 : 0) +
    20 * ids.filter((x) => frame.includes(x)).length +
    (c.locationId === frame[0] ? 10 : 0)
  );
}

// My spoken moments with the other before `turn`, oldest first.
const moments = (log, id, other, turn) => [
  ...new Set(
    log
      .filter(
        (e) =>
          e.generated &&
          e.actorId === id &&
          e.turn < turn &&
          both(e, id, other),
      )
      .map((e) => e.turn),
  ),
];

// The two best memories now. Replaying my earlier moments with the other
// in order, each leaves out what the moment before it chose, so a memory
// never surfaces on two moments in a row.
function choose(world, id, other, frame, shown) {
  let rested = [];
  let picked = [];
  for (const turn of [
    ...moments(world.log, id, other, world.turn),
    world.turn,
  ]) {
    picked = candidates(world, id, other, turn, shown)
      .filter((c) => !rested.includes(keyOf(c)))
      .map((c) => ({ c, s: score(world, c, id, frame) }))
      .sort((a, b) => b.s - a.s || b.c.seq - a.c.seq)
      .slice(0, 2)
      .map(({ c }) => c);
    rested = picked.map(keyOf);
  }
  return picked;
}

// The last time the pair were together before they parted, and how many
// times they have come together; nothing if they never parted, or once I
// have spoken since they met again.
function reunion(world, id, other) {
  const log = world.log;
  // A trip's own entries do not part a pair travelling together.
  const apart = (e) =>
    (e.cast || []).filter((x) => x === id || x === other).length === 1 &&
    !(e.fromLocationId && e.fromLocationId !== e.locationId);
  const parted = log.findLastIndex(apart);
  if (parted < 0) return null;
  if (
    log
      .slice(parted)
      .some((e) => e.generated && e.actorId === id && both(e, id, other))
  )
    return null;
  const last = log.slice(0, parted).findLast((e) => both(e, id, other));
  if (!last) return null;
  // One who watched the other set off saw them where the trip began.
  const left =
    last.fromLocationId &&
    last.fromLocationId !== last.locationId &&
    !(last.cast || []).includes(id === last.actorId ? other : id);
  let visits = 0;
  let together = false;
  for (const e of log) {
    if (apart(e)) together = false;
    else if (!together && both(e, id, other)) {
      together = true;
      visits++;
    }
  }
  return {
    place: left ? last.fromLocationId : last.locationId,
    turn: last.turn,
    visits: Math.min(visits + (together ? 0 : 1), 99),
  };
}

export function recall(world, id, other, frame, shown = []) {
  if (!other || profiles[other]?.kind !== "avatar") return null;
  const met = reunion(world, id, other);
  const chosen = choose(world, id, other, frame, shown);
  // A talk's topic that a chosen deed already names is not said twice.
  const items = chosen.map((c) => c.itemId).filter(Boolean);
  const acts = chosen
    .map((c) =>
      c.topics
        ? { ...c, topics: c.topics.filter((t) => !items.includes(t)) }
        : c,
    )
    .filter((c) => !c.topics || c.topics.length)
    .map((c) => ({
      verb: c.verb,
      by: c.actorId || id,
      ...(c.itemId ? { item: c.itemId } : {}),
      ...(c.accepted === false ? { refused: true } : {}),
      ...(c.topics ? { topics: c.topics.slice(0, 2) } : {}),
      turn: c.turn,
    }));
  return met || acts.length ? { ...(met ? { reunion: met } : {}), acts } : null;
}
