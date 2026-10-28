import { controlledByHuman } from "./human-cast.mjs";
import {
  transports,
  crossings,
  entityActive,
  packJourneyReservations,
} from "./pack-registry.mjs";

// Every rider shares the ship’s voyage.
export const passengers = (s, id) =>
  Object.entries(s.actors)
    .filter(([, a]) => a.place === transports[id].place)
    .map(([, a]) => a);

export function transportDepartureDock(s, place) {
  const id = Object.keys(transports).find(
    (key) => transports[key].place === place,
  );
  return id ? s.transports[id].dock : null;
}

export function transportBoardingAllowed(s, actor, place) {
  if (!actor) return true;
  const found = Object.entries(transports).find(([, t]) => t.place === place);
  if (!found) return true;
  const [id] = found;
  const reservations = packJourneyReservations(s).filter(
    (r) => r.place === place,
  );
  const reserved =
    reservations.find((r) => r.aboard) ||
    reservations.find((r) => r.from === s.transports[id].dock);
  return (
    !reserved || (reserved.actor === actor && passengers(s, id).length === 0)
  );
}

export function installTransports(s) {
  s.transports ??= {};
  for (const [id, t] of Object.entries(transports))
    s.transports[id] ??= {
      version: 2,
      dock: t.at,
      destination: null,
      recall: null,
    };
}

// A completed signal unlocks the whole vessel, including its return shore.
export function transportUnlocked(s, id) {
  const signals = crossings.filter((c) => c.transport === id && c.signal);
  return !signals.length || signals.some((c) => s.crossings[c.id].discovered);
}

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

export function summonTransport(s, id, dock) {
  const state = s.transports[id];
  if (passengers(s, id).length) state.recall = dock;
  else Object.assign(state, { dock, destination: null, recall: null });
}

// An empty vessel makes a circuit while a human waits at a port. Resident
// voyages share the same ship, dock and arrivals.
export function waitForTransport(s, place, actor) {
  if (!controlledByHuman(s, actor)) return;
  for (const [id, t] of Object.entries(transports)) {
    const state = s.transports[id];
    if (
      !t.docks.includes(place) ||
      !transportUnlocked(s, id) ||
      state.dock === place ||
      passengers(s, id).length
    )
      continue;
    const open = t.docks.filter((dock) => entityActive(s, dock));
    state.dock = open[(open.indexOf(state.dock) + 1) % open.length];
  }
}

export function transportArrival(s, actor) {
  if (controlledByHuman(s, actor)) return null;
  const found = Object.entries(transports).find(
    ([, t]) => t.place === s.actors[actor]?.place,
  );
  if (!found) return null;
  const state = s.transports[found[0]];
  return state.dock === state.destination ? state.dock : null;
}

// Boarding starts a leg while the ship stays at its departure dock. The first
// passenger ashore moves the dock; later boarders can start the return leg with
// riders still aboard. A recall waits until the vessel is empty.
export function moveTransport(s, from, to) {
  for (const [id, t] of Object.entries(transports)) {
    const state = s.transports[id];
    if (to === t.place) {
      if (state.dock === from || state.destination === null)
        state.destination = t.docks.find((dock) => dock !== state.dock);
    } else if (from === t.place) {
      if (t.docks.includes(to)) {
        state.destination = to;
        state.dock = to;
      }
      // A side crossing leaves the vessel at its saved dock. The last rider
      // settles a pending recall, just as on a normal disembarkation.
      if (!passengers(s, id).length) {
        Object.assign(state, {
          dock: state.recall || state.dock,
          destination: null,
          recall: null,
        });
      }
    }
  }
}

// A planner can look through a boarding edge to the shore beyond it. Actual
// cards use the saved destination of the current trip.
export function transportExits(s, place, previous = null, actor = null) {
  const found = Object.entries(transports).find(([, t]) => t.place === place);
  if (!found) return [];
  const [id, t] = found,
    state = s.transports[id];
  // A human aboard chooses the port before resident companions step ashore.
  if (
    previous === null &&
    actor &&
    !controlledByHuman(s, actor) &&
    state.dock !== state.destination &&
    Object.entries(s.actors).some(
      ([who, a]) => a.place === t.place && controlledByHuman(s, who),
    )
  )
    return [];
  // Before arrival, every open port is a choice. The first passenger ashore
  // fixes the shared destination until another boarding starts the next leg.
  if (previous === state.dock || state.dock !== state.destination)
    return t.docks.filter(
      (dock) => dock !== state.dock && entityActive(s, dock),
    );
  return state.destination ? [state.destination] : [];
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
      transportExits(s, from).includes(to)
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
      Object.keys(state).sort().join() !== "destination,dock,recall,version" ||
      state.version !== 2 ||
      !t.docks.includes(state.dock)
    )
      return false;
    return passengers(s, id).length
      ? t.docks.includes(state.destination) &&
          (state.recall === null || t.docks.includes(state.recall))
      : t.docks.includes(state.dock) &&
          state.destination === null &&
          state.recall === null;
  });
}
