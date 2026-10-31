import { controlledByHuman } from "./human-cast.mjs";
import {
  transports,
  crossings,
  entityActive,
  packPlaces,
  packPeople,
  conditionsMet,
} from "./pack-registry.mjs";

// A ship is docked, has a course set, is at sea, or has arrived. It sails
// authored lanes between its docks. A voyage takes one world round.
export const TRANSPORT_VERSION = 3;
export const IDLE_ROUNDS = 3;
// Route search from aboard a ship plans the whole voyage, not only the
// course cards in the current hand.
export const VOYAGE = "@voyage";
const PHASES = ["docked", "course", "sea", "arrived"];

const shipAt = (place) =>
  Object.entries(transports).find(([, t]) => t.place === place) || null;
export const transportPlace = (place) => Boolean(shipAt(place));

// Every rider shares the ship’s voyage.
export const passengers = (s, id) =>
  Object.entries(s.actors)
    .filter(([, a]) => a.place === transports[id].place)
    .map(([, a]) => a);
const passengerIds = (s, id) =>
  Object.entries(s.actors)
    .filter(([, a]) => a.place === transports[id].place)
    .map(([actor]) => actor)
    .sort();

// Two-way lanes unless an authored lane is one-way. Order follows the pack.
export function lanesFrom(t, dock) {
  const out = [];
  for (const lane of t.lanes || []) {
    if (lane.from === dock) out.push(lane.to);
    else if (lane.to === dock && !lane.oneWay) out.push(lane.from);
  }
  return [...new Set(out)];
}
// Knowing a lane is personal. Lanes are saved in route knowledge as sea
// edges, which no walking route can follow.

export const seaEdge = (from, to) => [`sea:${from}`, `sea:${to}`];
export const laneOfEdge = ([from, to]) =>
  from?.startsWith("sea:") && to?.startsWith("sea:")
    ? [from.slice(4), to.slice(4)]
    : null;
// Built on first use: the pack registry finishes loading after this module.
let tables = null;
function laneTables() {
  if (tables) return tables;
  const all = Object.values(transports);
  tables = {
    edges: all.flatMap((t) =>
      t.docks.flatMap((dock) =>
        lanesFrom(t, dock).map((to) => seaEdge(dock, to)),
      ),
    ),
    ports: new Set(all.flatMap((t) => t.docks.map(regionOf))),
    shipmasters: new Set(all.map((t) => t.shipmaster).filter(Boolean)),
  };
  return tables;
}
export const laneEdges = () => laneTables().edges;
const regionOf = (dock) => packPlaces[dock]?.packId ?? null;
// A world without a port of its own lives on the hub's shore.
const homeOf = (actor) => {
  const pack = packPeople[actor]?.packId ?? null;
  return laneTables().ports.has(pack) ? pack : null;
};
// A dock opened by a story (Myrto's invitation) teaches its lanes to all.
const storyDock = (s, dock) =>
  Boolean(packPlaces[dock]?.requires?.length) && entityActive(s, dock);
export function knowsLane(s, actor, from, to) {
  // No one in particular, or a shipmaster, knows every lane of the ship.
  if (!actor || laneTables().shipmasters.has(actor)) return true;
  const home = homeOf(actor);
  if (regionOf(from) === home || regionOf(to) === home) return true;
  const a = `sea:${from}`,
    b = `sea:${to}`;
  if ((s.routeKnowledge?.[actor] || []).some(([x, y]) => x === a && y === b))
    return true;
  return storyDock(s, from) || storyDock(s, to);
}
// Sailing a lane, or hearing it, saves it both ways when it is two-way.
export function learnLane(s, actor, from, to) {
  const t = Object.values(transports).find((t) =>
    lanesFrom(t, from).includes(to),
  );
  if (!t || !s.actors[actor]) return false;
  const edges = [seaEdge(from, to)];
  if (lanesFrom(t, to).includes(from)) edges.push(seaEdge(to, from));
  const key = ([x, y]) => `${x}>${y}`;
  const known = new Map(
    (s.routeKnowledge?.[actor] || []).map((edge) => [key(edge), edge]),
  );
  const before = known.size;
  for (const edge of edges) known.set(key(edge), edge);
  if (known.size === before) return false;
  s.routeKnowledge ??= {};
  s.routeKnowledge[actor] = [...known.values()].sort((x, y) =>
    key(x).localeCompare(key(y)),
  );
  return true;
}
// A gated lane is open only while its authored conditions hold (a thing from
// that world aboard), whoever knows it. Knowing it is information only.
const laneGate = (t, from, to) =>
  (t.lanes || []).find(
    (lane) =>
      lane.opensWith &&
      ((lane.from === from && lane.to === to) ||
        (!lane.oneWay && lane.from === to && lane.to === from)),
  )?.opensWith ?? null;
export const laneGated = (from, to) =>
  Object.values(transports).some((t) => laneGate(t, from, to));
// The authored conditions that open a gated lane, or null.
export const laneConditions = (from, to) =>
  Object.values(transports)
    .map((t) => laneGate(t, from, to))
    .find(Boolean) ?? null;
const openLanes = (s, t, dock, actor = null) =>
  lanesFrom(t, dock).filter((to) => {
    if (!entityActive(s, to)) return false;
    const gate = laneGate(t, dock, to);
    return gate
      ? conditionsMet(s, t.packId, gate)
      : knowsLane(s, actor, dock, to);
  });
// A ship's berth is reachable while some active port shares an open lane
// with it. Any place that is not a berth answers true.
export function berthOpen(s, place) {
  const ships = Object.values(transports).filter((t) =>
    t.docks.includes(place),
  );
  return (
    !ships.length ||
    ships.some((t) =>
      lanesFrom(t, place).some((to) => {
        const gate = laneGate(t, to, place);
        return (
          entityActive(s, to) && (!gate || conditionsMet(s, t.packId, gate))
        );
      }),
    )
  );
}

// Shortest open lane path between two docks, or null.
export function lanePath(s, id, from, to, actor = null) {
  const t = transports[id];
  const queue = [[from]],
    seen = new Set([from]);
  for (let i = 0; i < queue.length; i++) {
    const path = queue[i];
    if (path.at(-1) === to) return path;
    for (const next of openLanes(s, t, path.at(-1), actor)) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push([...path, next]);
    }
  }
  return null;
}
function laneReach(s, id, from, actor = null) {
  const t = transports[id];
  const seen = new Set([from]),
    queue = [from];
  for (let i = 0; i < queue.length; i++)
    for (const next of openLanes(s, t, queue[i], actor))
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
  return queue.slice(1);
}

// Released rule bundles wrote version 2 ships. Reads see them as version 3;
// a change to the ship writes the version 3 record first.
const read = (s, id) => {
  const state = s.transports?.[id];
  return state?.version === 2 ? upgradeTransportState(s, id, state) : state;
};
const own = (s, id) => (s.transports[id] = read(s, id));

const freshState = (dock, turn = 0) => ({
  version: TRANSPORT_VERSION,
  phase: "docked",
  dock,
  destination: null,
  riders: [],
  since: turn,
  recall: null,
});

export function installTransports(s) {
  s.transports ??= {};
  for (const [id, t] of Object.entries(transports))
    s.transports[id] ??= freshState(t.at, s.turn || 0);
}

// A completed signal unlocks the whole vessel, including its return shore.
export function transportUnlocked(s, id) {
  const signals = crossings.filter((c) => c.transport === id && c.signal);
  return !signals.length || signals.some((c) => s.crossings[c.id].discovered);
}

// The dock where the ship lies now. A ship at sea has none.
export const shipDock = (s, id) =>
  read(s, id)?.phase === "sea" ? null : (read(s, id)?.dock ?? null);

// Called after save validation: a human already aboard keeps their voyage.
export function preserveTransportAccess(s) {
  for (const id of Object.keys(transports)) {
    if (transportUnlocked(s, id)) continue;
    if (
      Object.entries(s.actors).some(
        ([actor, state]) =>
          state.place === transports[id].place && controlledByHuman(s, actor),
      )
    ) {
      const signal = crossings.find((c) => c.transport === id && c.signal);
      if (signal) s.crossings[signal.id].discovered = true;
    }
  }
  return s;
}

function settleEmpty(state, turn) {
  Object.assign(state, {
    phase: "docked",
    dock: state.recall || state.dock,
    destination: null,
    riders: [],
    since: turn,
    recall: null,
  });
}

// The lamp signal calls an empty ship at once. A ship with people aboard
// keeps its voyage and answers the call when it is empty.
export function summonTransport(s, id, dock) {
  const state = own(s, id);
  if (passengers(s, id).length) state.recall = dock;
  else {
    state.recall = dock;
    settleEmpty(state, s.turn || 0);
  }
}

const humanAboard = (s, t) =>
  Object.entries(s.actors).some(
    ([who, a]) => a.place === t.place && controlledByHuman(s, who),
  );

// Riders sailed in on the last voyage. Only they can step ashore, and only
// at the arrival port. A person who boarded here cannot step straight back.
export function canDisembark(s, id, actor) {
  const state = read(s, id);
  return Boolean(
    actor &&
      state.phase === "arrived" &&
      s.actors[actor]?.place === transports[id].place &&
      state.riders.includes(actor),
  );
}

// Course cards are the docked port's open lanes. A resident leaves the choice
// to a human aboard; the idle rule still sails the ship.
export function courseOptions(s, id, actor = null) {
  const t = transports[id],
    state = read(s, id);
  if (!["docked", "arrived"].includes(state.phase)) return [];
  if (actor && s.actors[actor]?.place !== t.place) return [];
  if (actor && !controlledByHuman(s, actor) && humanAboard(s, t)) return [];
  return openLanes(s, t, state.dock, actor);
}

export function isCourse(s, from, to) {
  const found = shipAt(from);
  if (!found) return false;
  const [id] = found;
  return (
    to !== read(s, id).dock &&
    openLanes(s, found[1], read(s, id).dock).includes(to)
  );
}

export function setCourse(s, from, to) {
  const found = shipAt(from);
  if (!found) return null;
  const state = own(s, found[0]);
  Object.assign(state, {
    phase: "course",
    destination: to,
    riders: [],
    since: s.turn,
  });
  return found[0];
}

// The first lane step toward a dock the planner wants to reach by sea.
export function courseToward(s, place, target, actor = null) {
  const found = shipAt(place);
  if (!found) return null;
  const dock = read(s, found[0]).dock;
  // Back to the port it left: sail out on the first lane and return.
  if (dock === target) return openLanes(s, found[1], dock, actor)[0] ?? null;
  return lanePath(s, found[0], dock, target, actor)?.[1] ?? null;
}

// An empty docked ship comes one lane closer to a human waiting at a port.
export function waitForTransport(s, place, actor) {
  if (controlledByHuman(s, actor)) callTransport(s, place);
}

// A traveller waiting to board brings the empty ship one lane closer. The
// ship moves at most one lane in a world round, however many people wait.
// A resident's call never takes the ship away from a human at its dock.
export function callTransport(s, place, resident = false) {
  for (const [id, t] of Object.entries(transports)) {
    if (!t.docks.includes(place)) continue;
    const state = own(s, id);
    if (
      (resident &&
        Object.entries(s.actors).some(
          ([who, a]) => a.place === state.dock && controlledByHuman(s, who),
        )) ||
      !transportUnlocked(s, id) ||
      state.phase !== "docked" ||
      state.dock === place ||
      (state.since === s.turn && s.turn > 0) ||
      passengers(s, id).length
    )
      continue;
    const path = lanePath(s, id, state.dock, place);
    if (path) Object.assign(state, { dock: path[1], since: s.turn });
  }
}

export function transportArrival(s, actor) {
  if (controlledByHuman(s, actor)) return null;
  const found = Object.entries(transports).find(
    ([, t]) => t.place === s.actors[actor]?.place,
  );
  if (!found) return null;
  return canDisembark(s, found[0], actor) ? read(s, found[0]).dock : null;
}

const pruneRiders = (s, id) => {
  const aboard = new Set(passengerIds(s, id));
  const state = own(s, id);
  state.riders = state.riders.filter((a) => aboard.has(a));
};

// Boarding keeps the ship at its harbour. A disembark at the arrival port
// leaves the ship there for everyone still aboard.
export function moveTransport(s, from, to) {
  for (const [id, t] of Object.entries(transports)) {
    const state = own(s, id);
    if (to === t.place) {
      if (state.phase === "docked" || state.phase === "arrived")
        state.since = s.turn;
    } else if (from === t.place) {
      pruneRiders(s, id);
      if (!passengers(s, id).length) {
        if (state.phase !== "sea") settleEmpty(state, s.turn);
      } else if (state.phase === "arrived" && !state.riders.length)
        state.phase = "docked";
    }
  }
}

// End of a world round: a set course casts off, a ship at sea arrives, and a
// ship left idle with passengers sails its first lane.
export function sailTransports(s) {
  const events = [];
  for (const [id, t] of Object.entries(transports)) {
    const state = own(s, id);
    pruneRiders(s, id);
    const aboard = passengerIds(s, id);
    if (state.phase === "sea") {
      // Everyone who sailed the lane now knows it.
      for (const actor of aboard)
        learnLane(s, actor, state.dock, state.destination);
      Object.assign(state, {
        dock: state.destination,
        destination: null,
        riders: aboard,
        phase: aboard.length ? "arrived" : "docked",
        since: s.turn,
      });
      if (!aboard.length && state.recall) settleEmpty(state, s.turn);
      events.push({ id, kind: "arrive", dock: state.dock, riders: aboard });
    } else if (state.phase === "course") {
      if (!aboard.length) settleEmpty(state, s.turn);
      else {
        Object.assign(state, { phase: "sea", since: s.turn });
        events.push({
          id,
          kind: "sail",
          from: state.dock,
          to: state.destination,
        });
      }
    } else if (aboard.length && s.turn - state.since >= IDLE_ROUNDS) {
      const lane = openLanes(s, t, state.dock)[0];
      if (!lane) continue;
      Object.assign(state, {
        phase: "sea",
        destination: lane,
        riders: [],
        since: s.turn,
      });
      events.push({ id, kind: "sail", from: state.dock, to: lane, idle: true });
    } else if (state.phase === "arrived" && !state.riders.length)
      state.phase = "docked";
  }
  return events;
}

// Card exits aboard are the Disembark port for riders plus the course cards.
// A planner (previous set) looks through the ship to every dock it can reach.
export function transportExits(s, place, previous = null, actor = null) {
  const found = shipAt(place);
  if (!found) return [];
  const [id, t] = found,
    state = read(s, id);
  // Someone ashore, or no one in particular, sees where the ship can reach.
  const aboard = actor && s.actors[actor]?.place === t.place;
  if ((previous !== null && previous !== undefined) || !aboard) {
    if (t.docks.includes(previous)) return laneReach(s, id, previous, actor);
    const from =
      state.phase === "sea" || state.phase === "course"
        ? state.destination
        : state.dock;
    return [
      ...(state.phase === "sea" ||
      state.phase === "course" ||
      canDisembark(s, id, actor)
        ? [from]
        : []),
      ...laneReach(s, id, from, actor),
    ].filter((dock, i, all) => all.indexOf(dock) === i);
  }
  return [
    ...(canDisembark(s, id, actor) ? [state.dock] : []),
    ...courseOptions(s, id, actor),
  ];
}

export function transportCrossing(s, from, to) {
  for (const [id, t] of Object.entries(transports)) {
    if (to === t.place && t.docks.includes(from)) {
      const c = crossings.find((c) => c.transport === id && c.from === from);
      return { ...c, to, travel: "aboard", travelLabel: "Board" };
    }
    if (
      from === t.place &&
      t.docks.includes(to) &&
      read(s, id).phase === "arrived" &&
      read(s, id).dock === to
    ) {
      const c = crossings.find((c) => c.transport === id && c.from === to);
      return {
        ...c,
        from,
        to,
        travel: "from the ship",
        travelLabel: "Disembark",
      };
    }
  }
  return null;
}

// Talk and the place card describe where the ship is.
export function transportScenery(s, place, nameOf) {
  const found = shipAt(place);
  if (!found) return [];
  const state = read(s, found[0]);
  if (state.phase === "sea")
    return [`The ship is at sea, bound for ${nameOf(state.destination)}.`];
  if (state.phase === "course")
    return [`The ship has set its course for ${nameOf(state.destination)}.`];
  if (state.phase === "arrived")
    return [`The ship has arrived at ${nameOf(state.dock)}.`];
  return [`The ship is docked at ${nameOf(state.dock)}.`];
}

const whole = (n) => Number.isSafeInteger(n) && n >= 0;

export function validTransports(s) {
  const saved = s.transports;
  if (
    !saved ||
    Array.isArray(saved) ||
    Object.keys(saved).sort().join() !== Object.keys(transports).sort().join()
  )
    return false;
  return Object.entries(transports).every(([id, t]) => {
    const state = saved[id];
    if (
      !state ||
      Object.keys(state).sort().join() !==
        "destination,dock,phase,recall,riders,since,version" ||
      state.version !== TRANSPORT_VERSION ||
      !PHASES.includes(state.phase) ||
      !t.docks.includes(state.dock) ||
      !whole(state.since) ||
      state.since > (s.turn ?? 0) ||
      !Array.isArray(state.riders) ||
      new Set(state.riders).size !== state.riders.length ||
      state.riders.some((a) => !s.actors[a]) ||
      (state.recall !== null && !t.docks.includes(state.recall))
    )
      return false;
    const aboard = passengers(s, id).length;
    if (!aboard && state.recall !== null && state.phase !== "sea") return false;
    if (state.phase === "docked")
      return state.destination === null && !state.riders.length;
    if (state.phase === "arrived")
      return state.destination === null && aboard > 0;
    return (
      !state.riders.length &&
      lanesFrom(t, state.dock).includes(state.destination) &&
      (state.phase === "sea" || aboard > 0)
    );
  });
}

// Version 2 ships sailed any dock in one play. An occupied ship that had not
// landed waits docked for a course; one that had landed has arrived.
export function upgradeTransportState(s, id, state) {
  const aboard = passengerIds(s, id);
  const arrived = aboard.length > 0 && state.dock === state.destination;
  return {
    version: TRANSPORT_VERSION,
    phase: arrived ? "arrived" : "docked",
    dock: state.dock,
    destination: null,
    riders: arrived ? aboard : [],
    since: s.turn || 0,
    recall: aboard.length ? state.recall : null,
  };
}
