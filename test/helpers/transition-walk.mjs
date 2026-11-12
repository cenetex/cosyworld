import { expect } from "vitest";
import {
  carried,
  decodeSave,
  encodeSave,
  holdChoice,
  legalActions,
  play,
} from "../../v2/card-game/world.mjs";
import { GROUPS } from "../../v2/card-game/pack-registry.mjs";
import { groupOn, packToggleBlock } from "../../v2/card-game/pack-toggle.mjs";
import { dispatchShared } from "../../v2/card-game/shared-world.mjs";
import { currentSharedEngine } from "../fixtures/shared-engine.mjs";

const breathe = () => new Promise((resume) => setImmediate(resume));
const step = (n) => (Math.imul(n, 1664525) + 1013904223) >>> 0;
export const nameOf = (c) => c.key ?? c.action ?? JSON.stringify(c);
const kindOf = (c) => c.kind ?? c.op ?? "hold";
const names = (list) => list.map(nameOf);
const firstMet = (s) =>
  Object.entries({ opening: s.opening, ...s.packs }).flatMap(([owner, state]) =>
    Object.entries(state?.met || {}).map(([id, turn]) => [`${owner}:${id}`, turn]),
  );

export async function walk(driver, start, { seed, steps, only = () => true }) {
  let state = start,
    rng = seed >>> 0;
  const trace = [],
    reached = {},
    met = Object.fromEntries(firstMet(start));
  const count = (key) => (reached[key] = (reached[key] || 0) + 1);
  let ahead = null;
  for (let i = 0; i < steps; i++) {
    await breathe();
    rng = step(rng);
    const options = (ahead ?? driver.commands(state, i)).filter(only);
    ahead = null;
    if (!options.length) continue;
    const command = options[rng % options.length],
      at = `seed ${seed} step ${i} ${nameOf(command)}`,
      before = JSON.stringify(state);
    if (i % 5 === 0) {
      const stale = driver.apply(state, command, state.revision - 1);
      expect(stale.ok, `${at} stale`).toBe(false);
      expect(stale.state, `${at} stale`).toEqual(state);
      count("stale");
    }
    const done = driver.apply(state, command);
    expect(JSON.stringify(state), `${at} changed its input`).toBe(before);
    if (!done.ok) {
      expect(done.state, `${at} rejected`).toEqual(state);
      count("rejected");
      continue;
    }
    const text = driver.save(done.state),
      back = driver.load(JSON.stringify(structuredClone(done.state)));
    expect(driver.save(back), `${at} reads back`).toBe(text);
    ahead = driver.commands(done.state, i + 1);
    expect(names(driver.commands(back, i + 1)), `${at} plays after reload`).toEqual(
      names(ahead),
    );
    for (const [key, turn] of firstMet(done.state))
      expect((met[key] ??= turn), `${at} first met ${key}`).toBe(turn);
    count(kindOf(command));
    if (command.actor) count(`by:${command.actor}`);
    trace.push(command);
    state = i % 7 ? done.state : back;
  }
  return { state, trace, reached };
}

export async function replay(driver, start, trace) {
  let state = start;
  for (const command of trace) {
    await breathe();
    const done = driver.apply(state, command);
    expect(done.ok, `replay ${nameOf(command)} ${done.error}`).toBe(true);
    state = done.state;
  }
  return state;
}

export function wayTo(driver, state, goal, depth) {
  if (goal(state)) return [];
  if (!depth) return null;
  for (const command of driver.commands(state)) {
    if (["pack", "wait"].includes(command.kind)) continue;
    const done = driver.apply(state, command),
      rest = done.ok && wayTo(driver, done.state, goal, depth - 1);
    if (rest) return [command, ...rest];
  }
  return null;
}

export const local =(actor = "vale") => ({
  commands: (s) => [
    ...legalActions(s, actor),
    ...[null, ...carried(s, actor)].map((hold) => ({ hold })),
    ...Object.keys(GROUPS)
      .filter((pack) => !packToggleBlock(s, pack, actor))
      .map((pack) => ({ kind: "pack", pack, enable: !groupOn(s, pack) })),
  ],
  apply(s, command, revision = s.revision) {
    if (!("hold" in command)) return play(s, command, revision, actor);
    const next = structuredClone(s);
    try {
      holdChoice(next, actor, { item: command.hold, revision });
    } catch (error) {
      return { ok: false, state: s, error: error.message };
    }
    return { ok: true, state: next };
  },
  save: encodeSave,
  load: decodeSave,
});

export function sharedBoundary() {
  const engine = currentSharedEngine();
  return (request) => {
    const served = JSON.parse(engine.cardShared(JSON.stringify(request)));
    let authored;
    try {
      authored = dispatchShared(structuredClone(request));
    } catch (error) {
      authored = { ok: false, error: error.message };
    }
    expect(served, `${request.op} at the bundled rules`).toEqual(authored);
    return served;
  };
}

export const shared = (dispatch, seats) => ({
  commands(world, i) {
    const actor = seats.present[i % seats.present.length],
      view = dispatch({ op: "view", world, actor, ...seats });
    return [
      ...view.actions.map((a) => ({ op: "play", actor, action: a.key, kind: a.kind, ...seats })),
      ...[null, ...carried(world, actor)].map((hold) => ({ op: "hold", actor, hold, ...seats })),
    ];
  },
  apply(world, { kind, hold, ...command }, revision = world.revision) {
    const out = dispatch({
      ...command,
      world,
      ...(command.op === "hold" ? { choice: { item: hold, revision } } : {}),
      ...(command.op === "play" ? { revision } : {}),
    });
    return { ok: out.ok === true, state: out.world ?? world, error: out.error };
  },
  save: (world) => JSON.stringify(world),
  load: (text) => dispatch({ op: "validate", world: JSON.parse(text), ...seats }).world,
});
