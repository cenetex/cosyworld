// v100 SPEED PROBE ONLY. Not a release, not game design: a rough home/range
// walk and the dawn/dusk off-stage step, so the shared engine's cost can be
// measured. The harness picks the variant with globalThis.probe* flags.
import forest from "./forest.json" with { type: "json" };
import { packPeople } from "./pack-registry.mjs";
import { humanAvatar, humanAvatarIds, humanPresent } from "./human-cast.mjs";
import { roamingActors, authoredRouteEdges } from "./roaming-routes.mjs";

const flag = (name, fallback) =>
  globalThis[name] === undefined ? fallback : globalThis[name];

// Static place graph and hop counts: built once per interpreter (each shared
// request gets a fresh interpreter, so "once" means once per request).
let adjacency = null;
const distances = new Map();
function graph() {
  if (adjacency) return adjacency;
  adjacency = new Map();
  for (const [from, to] of authoredRouteEdges()) {
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    adjacency.get(from).add(to);
  }
  return adjacency;
}
function distancesFrom(from) {
  let found = distances.get(from);
  if (found) return found;
  found = new Map([[from, 0]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++)
    for (const next of graph().get(queue[i]) || [])
      if (!found.has(next)) {
        found.set(next, found.get(queue[i]) + 1);
        queue.push(next);
      }
  distances.set(from, found);
  return found;
}
export const hops = (from, to) => distancesFrom(from).get(to) ?? Infinity;

export const probeHome = (id) =>
  packPeople[id]?.place ??
  humanAvatar(id)?.home?.id ??
  forest.initialState.actors[id]?.place ??
  null;
const rangeOf = (s, id, api) =>
  api.staysPut(id, s) ? 0 : (packPeople[id]?.range ?? 2);

function wantPlace(s, id, api) {
  const want = api.wantOf(s, id);
  if (!want) return null;
  if (want.kind === "place") return want.target;
  if (want.kind === "person") return s.actors[want.target]?.place ?? null;
  if (want.kind === "item" && s.items[want.target])
    return api.itemPlace(s, want.target);
  return null;
}

// One step toward `target`. "full" uses the rules' own stepToward (dynamic
// BFS over open exits plus legalActions) and performs the move; "cheap" uses
// the static hop table and checks only that the exit is open.
function step(s, id, target, round, api) {
  const here = s.actors[id].place;
  // Stress: aim at the farthest place this resident can reach right now, so
  // every off-stage resident pays for a BFS, a plan step and a move.
  if (flag("probeTarget", "") === "far") {
    const seen = new Set([here]),
      queue = [here];
    for (let i = 0; i < queue.length; i++)
      for (const next of api.exits(s, queue[i], id))
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
    if (queue.length > 1) target = queue.at(-1);
  }
  if (!target || target === here) return false;
  if (flag("probeMode", "full") === "cheap") {
    const left = hops(here, target);
    if (left === Infinity) return false;
    const open = api.exits(s, here, id);
    const next = open
      .filter((p) => hops(p, target) === left - 1)
      .sort()[0];
    if (!next) return false;
    s.actors[id].place = next;
    return true;
  }
  const chosen = api.stepToward(s, id, target);
  if (globalThis.probeDebug)
    globalThis.probeDebug.push([id, here, target, chosen.action?.kind, chosen.action?.target, api.exits(s, here, id).join("|")]);
  if (chosen.action?.kind !== "move") return false;
  api.perform(s, chosen.action, round, [id]);
  return s.actors[id].place !== here;
}

// After the round: displaced residents walk home every turn; at dawn and
// dusk every off-stage resident takes one step (home at dusk/bedtime or when
// idle, toward its want within range at dawn).
export function offstageTick(s, round, acted, api) {
  const mode = flag("probeMode", "full");
  if (mode === "off") return { ticked: 0, moved: 0 };
  const clock = s.turn % 48;
  const tick = flag("probeForceTick", false) || clock === 0 || clock === 24;
  const dusk = flag("probeForceTick", false) ? flag("probeDusk", false) : clock === 24;
  const occupied = new Set(
    humanAvatarIds
      .filter((id) => humanPresent(s, id))
      .map((id) => s.actors[id]?.place),
  );
  const nearHops = flag("probeNearHops", Infinity);
  const near = (place) =>
    nearHops === Infinity ||
    [...occupied].some((p) => hops(p, place) <= nearHops);
  const budget = flag("probeMaxSteps", Infinity);
  let ticked = 0,
    moved = 0;
  const ids = Object.keys(s.actors)
    .filter(
      (id) =>
        !acted.includes(id) &&
        !roamingActors.includes(id) &&
        !api.controlledByHuman(s, id) &&
        api.entityActive(s, id) &&
        !s.actors[id].sleeping &&
        !occupied.has(s.actors[id].place),
    )
    .sort();
  for (const id of ids) {
    if (ticked >= budget) break;
    const here = s.actors[id].place;
    const home = probeHome(id);
    if (!home) continue;
    const range = rangeOf(s, id, api);
    const displaced = here !== home && hops(home, here) > range;
    if (!tick && !(displaced || (range === 0 && here !== home))) continue;
    if (!near(here)) continue;
    ticked++;
    let target = here !== home && (displaced || dusk || range === 0) ? home : null;
    if (!target && !dusk && range > 0) {
      const want = wantPlace(s, id, api);
      if (want && want !== here && hops(home, want) <= range) target = want;
      else if (want && want !== here) {
        // Out of range: step only while the next place stays within range.
        const left = hops(here, want);
        const next = (graph().get(here) || new Set());
        for (const p of [...next].sort())
          if (hops(p, want) === left - 1 && hops(home, p) <= range) {
            target = p;
            break;
          }
      }
      if (!target && here !== home) target = home;
    }
    if ((target || flag("probeTarget", "") === "far") && step(s, id, target, round, api)) moved++;
  }
  return { ticked, moved };
}
