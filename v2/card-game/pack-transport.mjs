import { transports, crossings } from "./pack-registry.mjs";

export const passengers = (s, id) =>
  Object.values(s.actors).filter((a) => a.place === transports[id].place);

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

export function summonTransport(s, id, dock) {
  const state = s.transports[id];
  if (passengers(s, id).length) state.recall = dock;
  else Object.assign(state, { dock, destination: null, recall: null });
}

// Boarding starts a leg while the ship stays at its departure dock. The first
// passenger ashore moves the dock; later boarders can start the return leg with
// riders still aboard. A recall waits until the vessel is empty.
export function moveTransport(s, from, to) {
  for (const [id, t] of Object.entries(transports)) {
    const state = s.transports[id];
    if (to === t.place && state.dock === from) {
      state.destination = t.docks.find((dock) => dock !== from);
    } else if (from === t.place && t.docks.includes(to)) {
      state.dock = to;
      if (!passengers(s, id).length) {
        Object.assign(state, {
          dock: state.recall || to,
          destination: null,
          recall: null,
        });
      }
    }
  }
}

// A planner can look through a boarding edge to the shore beyond it. Actual
// cards use the saved destination of the current trip.
export function transportExits(s, place, previous = null) {
  const found = Object.entries(transports).find(([, t]) => t.place === place);
  if (!found) return [];
  const [id, t] = found,
    state = s.transports[id];
  const destination =
    previous === state.dock
      ? t.docks.find((dock) => dock !== previous)
      : state.destination;
  return destination ? [destination] : [];
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
      s.transports[id].destination === to
    ) {
      const c = crossings.find((c) => c.transport === id && c.to === to);
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
