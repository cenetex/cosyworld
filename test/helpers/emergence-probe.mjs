import { legalActions, play } from "../../v2/card-game/world.mjs";
import { HEARD_FROM } from "../../v2/card-game/world/rumours.mjs";

const PLAYER = "vale";
const plain = (a) => !a.sleep && !a.guards;

export const waitOnly = (s) =>
  legalActions(s, PLAYER).find((a) => a.kind === "wait" && plain(a)) ?? null;

export function walker(every = 3) {
  return (s) => {
    const acts = legalActions(s, PLAYER);
    const move = acts.filter((a) => a.kind === "move" && !a.item && plain(a));
    if (s.turn % every === 0 && move.length)
      return move[Math.floor(s.turn / every) % move.length];
    return acts.find((a) => a.kind === "take" && plain(a)) ?? waitOnly(s);
  };
}

const json = (v) => JSON.stringify(v ?? null);
const wantKey = (a) => (a.want ? `${a.want.kind}:${a.want.target}` : "");

export function snapshot(s) {
  const actors = {};
  for (const [id, a] of Object.entries(s.actors))
    actors[id] = {
      place: a.place,
      want: wantKey(a),
      heard: a.want?.from === HEARD_FROM,
      trust: json(a.trust),
      trustMap: { ...(a.trust || {}) },
      rumours: (a.rumours || []).map((r) => `${r.kind}:${r.subject}:${r.hops}`),
    };
  return {
    actors,
    items: Object.fromEntries(Object.entries(s.items).map(([id, i]) => [id, i.holder])),
    grievances: json(s.motives?.grievances),
    flags: json(Object.fromEntries(Object.entries(s.packs || {}).map(([id, p]) => [id, p.flags]))),
  };
}

export const emptyCounts = () => ({
  actedActors: 0,
  moves: 0,
  wantsMet: 0,
  itemTransfers: 0,
  trustChanges: 0,
  grievanceChanges: 0,
  rumoursHeld: 0,
  retoldRumours: 0,
  heardWants: 0,
  flagChanges: 0,
});

export function runOne(makeWorld, seed, turns, script = waitOnly, include = () => true) {
  let s = makeWorld(seed);
  const counts = emptyCounts();
  const moved = new Set();
  const seenRetold = new Set();
  let before = snapshot(s);
  for (let i = 0; i < turns; i++) {
    const action = script(s);
    if (!action) break;
    const done = play(s, action, s.revision, PLAYER);
    if (!done.ok) break;
    s = done.state;
    const now = snapshot(s);
    for (const [id, a] of Object.entries(now.actors)) {
      const was = before.actors[id];
      if (!was || id === PLAYER || !include(id)) continue;
      if (a.place !== was.place) {
        counts.moves++;
        moved.add(id);
      }
      if (a.want !== was.want && a.heard) counts.heardWants++;
      if (a.trust !== was.trust)
        for (const o of Object.keys(a.trustMap))
          if (o !== PLAYER && include(o) && a.trustMap[o] !== (was.trustMap[o] || 0)) counts.trustChanges++;
      for (const r of a.rumours) {
        const [, , hops] = r.split(":");
        if (Number(hops) > 0 && !seenRetold.has(`${id}|${r}`)) {
          seenRetold.add(`${id}|${r}`);
          counts.retoldRumours++;
        }
      }
    }
    for (const [id, holder] of Object.entries(now.items))
      if (holder !== before.items[id] && now.actors[holder] && holder !== PLAYER && include(holder)) counts.itemTransfers++;
    if (now.grievances !== before.grievances) counts.grievanceChanges++;
    if (now.flags !== before.flags) counts.flagChanges++;
    before = now;
  }
  counts.actedActors = moved.size;
  counts.wantsMet = s.log.filter((e) => e.verb === "want_met" && e.actorId !== PLAYER && include(e.actorId)).length;
  counts.rumoursHeld = Object.entries(before.actors)
    .filter(([id]) => include(id))
    .reduce((n, [, a]) => n + a.rumours.length, 0);
  return { counts, end: before };
}

export function divergence(ends, include = () => true) {
  const out = { want: 0, place: 0, trust: 0, any: 0 };
  const [first, ...rest] = ends;
  for (const other of rest)
    for (const [id, a] of Object.entries(first.actors)) {
      if (!include(id)) continue;
      const b = other.actors[id];
      if (!b) continue;
      const d = { want: a.want !== b.want, place: a.place !== b.place, trust: a.trust !== b.trust };
      for (const k of Object.keys(d)) if (d[k]) out[k]++;
      if (Object.values(d).some(Boolean)) out.any++;
    }
  return out;
}

export function probe({ makeWorld, seeds, turns, script = waitOnly, include = () => true }) {
  const runs = seeds.map((seed) => runOne(makeWorld, seed, turns, script, include));
  const total = emptyCounts();
  for (const { counts } of runs) for (const k of Object.keys(total)) total[k] += counts[k];
  return {
    seeds,
    turns,
    total,
    perSeed: runs.map((r) => r.counts),
    divergence: divergence(runs.map((r) => r.end), include),
  };
}

export function table(result) {
  const rows = Object.entries(result.total).map(([k, v]) => `${k.padEnd(18)}${v}`);
  const d = Object.entries(result.divergence).map(([k, v]) => `${k} ${v}`);
  return [
    `seeds ${result.seeds.join(",")}  turns ${result.turns}`,
    ...rows,
    `divergence        ${d.join("  ")}`,
  ].join("\n");
}
