import { createWorld, legalActions, play, seedRun } from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";
import { humanAvatarIds } from "../card-game/human-cast.mjs";
import { levelOf } from "../card-game/want.mjs";
import { rootHolder } from "../card-game/world/items.mjs";
import { boxDefs, boxOpen } from "../card-game/world/boxes.mjs";
import { DAY_TURNS } from "../card-game/resident-home.mjs";
import { beginHistory } from "../card-game/world/history.mjs";
import { packDefinition } from "../card-game/pack-registry.mjs";
import forest from "../card-game/forest.json" with { type: "json" };

export const HISTORY_TURNS = 10 * DAY_TURNS;
export const HISTORY_SEEDS = [11, 23, 37, 41, 59, 73];
const humans = new Set(humanAvatarIds);
const openingCast = new Set([...humans, ...Object.keys(forest.initialState.actors)]);
const openingItems = new Set([...Object.keys(forest.initialState.items), ...Object.keys(forest.opening.items)]);
const thebes = packDefinition("greek-drama");
const protectedIds = new Set([...openingCast, ...openingItems,
  ...[thebes.avatars, thebes.items || {}, thebes.places].flatMap(Object.keys)]);
const KEPT = new Set(["actors", "items", "memories", "conversations", "knowledge", "turn", "revision", "eventSeq", "log"]);
const RESTING = new Set(["sanctuary", "waitSpeech", "slept", "sleeping"]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const playerOf = (s) => s.playerActorId || "vale";

export function startWorld(seed) {
  return seedRun(enableMotives(createWorld({ opening: true })), seed);
}

const plainWait = (s) =>
  legalActions(s).find((a) => a.kind === "wait" && !a.sleep && !a.guards);

export function runHistory(start, turns = HISTORY_TURNS) {
  const player = playerOf(start);
  const scene = new Set();
  let s = start, seen = s.eventSeq;
  while (s.turn < turns) {
    const done = play(s, plainWait(s), s.revision);
    if (!done.ok) throw new Error(done.error);
    s = done.state;
    const here = s.actors[player].place;
    for (const e of s.log)
      if (e.seq >= seen && (humans.has(e.actorId) || e.locationId === here || (e.witnesses || []).some((id) => humans.has(id))))
        scene.add(e.seq);
    seen = s.eventSeq;
  }
  return { end: s, scene };
}

const residentsOf = (s) => Object.keys(s.actors).filter((id) => !protectedIds.has(id)).sort();
const protectedRoot = (s, id) => protectedIds.has(id) || protectedIds.has(rootHolder(s, id));
const keptKnowledge = (start, end) => {
  const known = { ...(start.knowledge?.known || {}) };
  for (const [id, facts] of Object.entries(end.knowledge?.known || {}))
    if (!protectedIds.has(id)) known[id] = facts;
  const used = new Set(Object.values(known).flatMap((facts) => Object.keys(facts)));
  const facts = Object.fromEntries(Object.entries(end.knowledge?.facts || {}).filter(([id]) => used.has(id)));
  return { ...end.knowledge, known, facts, pending: start.knowledge?.pending };
};
const keptTalks = (end) =>
  (end.conversations || []).filter((row) => !row.actors.some((id) => protectedIds.has(id)));
const openBoxes = (s, actor) =>
  boxDefs().filter((def) => boxOpen(s, def, actor)).map((def) => `${def.kind}:${def.at}:${def.id}`).sort();
const without = (actor, keys) =>
  Object.fromEntries(Object.entries(actor || {}).filter(([k]) => !keys.has(k)));

export function score(start, end) {
  const n = { xp: 0, levels: 0, wants: 0, trust: 0, moved: 0 };
  const changed = new Set();
  for (const id of residentsOf(end).filter((id) => start.actors[id])) {
    const a = end.actors[id], b = start.actors[id];
    const gain = Math.max(0, (a.xp || 0) - (b.xp || 0));
    const up = Math.max(0, (levelOf(end, id) || 0) - (levelOf(start, id) || 0));
    const want = same(a.want?.target, b.want?.target) ? 0 : 1;
    const moves = residentsOf(end).reduce((t, o) => t + Math.abs((a.trust?.[o] || 0) - (b.trust?.[o] || 0)), 0);
    n.xp += gain, n.levels += up, n.wants += want, n.trust += moves;
    if (gain || up || want || moves) changed.add(id);
  }
  for (const id of Object.keys(end.items))
    if (start.items[id] && !protectedRoot(start, id) && !protectedRoot(end, id) && rootHolder(start, id) !== rootHolder(end, id))
      n.moved++, changed.add(rootHolder(end, id));
  const total = n.xp + 5 * n.levels + n.wants + 2 * n.trust + 3 * n.moved + 2 * changed.size;
  return { ...n, residents: changed.size, total };
}

const diff = (a, b, path, out) => {
  if (same(a, b)) return out;
  if (
    a && b && typeof a === "object" && typeof b === "object" &&
    !Array.isArray(a) && !Array.isArray(b)
  ) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
      diff(a[key], b[key], [...path, key], out);
    return out;
  }
  out.push(b === undefined ? [path] : [path, b]);
  return out;
};

export function changes(start, end, scene) {
  const out = [];
  const guarded = new Set([...protectedIds, start.actors[playerOf(start)].place]);
  for (const id of residentsOf(end))
    diff(without(start.actors[id], RESTING), without(end.actors[id], RESTING), ["actors", id], out);
  for (const [id, actor] of Object.entries(start.actors).sort())
    if (protectedIds.has(id) && Number.isInteger(actor.want?.since))
      out.push([["actors", id, "want", "since"], actor.want.since + end.turn - start.turn]);
  for (const id of Object.keys(end.items).sort())
    if (!guarded.has(id) && !protectedRoot(start, id))
      diff(start.items[id], end.items[id], ["items", id], out);
  for (const id of Object.keys(end.memories).sort()) {
    if (guarded.has(id)) continue;
    const had = new Set((start.memories[id]?.events || []).map((e) => e.seq));
    const events = (end.memories[id].events || []).filter((e) => had.has(e.seq) || !scene.has(e.seq));
    if (events.some((e) => !had.has(e.seq)))
      diff(start.memories[id], { ...end.memories[id], events }, ["memories", id], out);
  }
  diff(start.knowledge, keptKnowledge(start, end), ["knowledge"], out);
  if (!same(start.conversations || [], keptTalks(end))) out.push([["conversations"], keptTalks(end)]);
  out.push([["turn"], end.turn], [["revision"], end.revision], [["eventSeq"], end.eventSeq]);
  return out;
}

export function refusal(start, end, scene) {
  const player = playerOf(start);
  for (const key of new Set([...Object.keys(start), ...Object.keys(end)]))
    if (!KEPT.has(key) && !same(start[key], end[key])) return `history changed ${key}`;
  for (const row of end.conversations || [])
    if (row.actors.some((id) => protectedIds.has(id)) && row.actors.some((id) => !protectedIds.has(id)))
      return `history talked with ${row.actors.find((id) => protectedIds.has(id))}`;
  for (const [id, facts] of Object.entries(end.knowledge?.known || {}))
    if (!protectedIds.has(id))
      for (const fact of Object.values(facts))
        if (protectedIds.has(fact.teller)) return `history told ${id} what ${fact.teller} knew`;
  for (const id of humans)
    if (!same(without(start.actors[id], RESTING), without(end.actors[id], RESTING)))
      return `history changed ${id}`;
  for (const id of residentsOf(end))
    for (const other of protectedIds)
      if ((start.actors[id]?.trust?.[other] || 0) !== (end.actors[id].trust?.[other] || 0))
        return `history changed trust in ${other}`;
  const near = (at) => humans.has(at) || at === start.actors[player].place;
  for (const id of Object.keys(end.items))
    if (!same(start.items[id], end.items[id]) && (openingItems.has(id) || near(rootHolder(start, id)) ||
      near(rootHolder(end, id)) || protectedRoot(start, id) !== protectedRoot(end, id)))
      return `history moved ${id}`;
  const after = beginHistory(structuredClone(start), changes(start, end, scene));
  if (!same(openBoxes(start, player), openBoxes(after, player))) return "history opened or shut a box";
  const keys = (s) => legalActions(s, player).map((a) => a.key).sort();
  if (!same(keys(start), keys(after))) return "history changed the first plays";
  return null;
}

export function makeHistory({ seeds = HISTORY_SEEDS, turns = HISTORY_TURNS, report = () => {} } = {}) {
  let best = null;
  for (const seed of seeds) {
    const start = startWorld(seed);
    const { end, scene } = runHistory(structuredClone(start), turns);
    const refused = refusal(start, end, scene);
    const scored = score(start, end);
    report({ seed, refused, ...scored });
    if (!refused && (!best || scored.total > best.score))
      best = { seed, score: scored.total, changes: changes(start, end, scene) };
  }
  return best ? { turns, ...best } : { turns: 0, changes: [] };
}
