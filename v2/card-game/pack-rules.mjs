import {
  currentActor,
  controlledByHuman,
  humanPresent,
  humanAvatarIds,
  sharedEnabled,
} from "./human-cast.mjs";
import { knowsFact } from "./knowledge.mjs";
import { locationWeather } from "./weather.mjs";
// General rules over world-pack data: crossings and their signals, fixtures
// that sound, and residents with a temperament. No rule here names a pack,
// place, resident or hub object; the compiled packs supply every name.
//
// The engine passes `senses`, its view of the hub:
//   senses.player            the player's actor id
//   senses.baseSoundAt(s, p) whether a hub object is sounding at place p
//   senses.nameOf(id)        a display name
import {
  packDefinitions,
  packPeople,
  packPlaces,
  packFixtures,
  packThings,
  crossings,
  transports,
  fixturesAt,
  isPackPlace,
  validatePackStates,
  entityActive,
  roamingQuestActor,
} from "./pack-registry.mjs";

import {
  summonTransport,
  transportUnlocked,
  validTransports,
  transportCrossing,
  shipDock,
  shipAtSea,
} from "./pack-transport.mjs";

// Day and night each last this many turns on the saved world clock.
export const DAYLIGHT_TURNS = 24;

const fill = (template, values) =>
  template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
const crossingState = (s, id) => s.crossings?.[id];

// --- State -------------------------------------------------------------

export const newCrossingState = (c) =>
  c.signal ? { discovered: false, phase: 0, until: 0 } : { discovered: false };
export const newPackRecord = (pack) => ({
  revision: pack.revision,
  ...(pack.recital ? { recitals: {} } : {}),
  ...(pack.choices
    ? {
        choices: {},
        flags: {},
        receipts: {},
        met: {},
        scope: pack.release ? "opening" : "full",
      }
    : {}),
  sounds: Object.fromEntries(
    Object.keys(pack.fixtures || {}).map((id) => [id, 0]),
  ),
});
export function newTemperament(id) {
  const t = packPeople[id]?.temperament;
  return t ? { awake: !t.asleep, irritation: 0, wakeCause: null } : {};
}

// --- Sound and crossings -----------------------------------------------

export const fixtureSounding = (s, id) =>
  s.turn < (s.packs?.[packFixtures[id]?.packId]?.sounds?.[id] ?? 0);
export const soundAt = (s, place, senses) =>
  senses.baseSoundAt(s, place) ||
  fixturesAt(place).some((f) => fixtureSounding(s, f.id));

function objectPlace(s, item) {
  let holder = s.items[item]?.holder;
  const seen = new Set([item]);
  while (s.items[holder]) {
    if (seen.has(holder)) return null;
    seen.add(holder);
    holder = s.items[holder].holder;
  }
  return s.actors[holder]?.place || holder;
}
export function conditionMet(s, c, senses, packId = null, actor = null) {
  const state = s.packs?.[packId];
  switch (c.kind) {
    case "sound":
      return !!senses && c.at.some((place) => soundAt(s, place, senses));
    case "light":
      return Boolean(
        entityActive(s, c.item) &&
          s.items[c.item]?.lit &&
          s.items[c.item]?.fuel > 0 &&
          c.at.includes(objectPlace(s, c.item)) &&
          (!c.uncovered ||
            !Object.values(s.items).some((i) => i.holder === c.item)),
      );
    case "not":
      return !conditionMet(s, c.condition, senses, packId, actor);
    case "any":
      return c.conditions.some((r) =>
        conditionMet(s, r, senses, packId, actor),
      );
    case "choice":
      return state?.choices?.[c.key] === c.value;
    case "choice_unset":
      return !!state && !Object.hasOwn(state.choices || {}, c.key);
    case "flag":
      return (state?.flags?.[c.key] ?? false) === c.value;
    case "knows": {
      const who = actor || senses?.player || currentActor(s);
      return (c.topics || [c.topic]).some((topic) => knowsFact(s, who, topic));
    }
    case "holding":
      return s.items[c.item]?.holder === (c.role === "actor" ? actor : c.actor);
    // A one-way cosmetic upgrade the traveler carries between worlds (#1873).
    case "upgraded":
      return Boolean(s.actors[actor]?.upgrades?.includes(c.upgrade));
    case "shared_world":
      return sharedEnabled(s);
    case "connected_humans":
      return (
        sharedEnabled(s) &&
        humanAvatarIds.filter((id) => humanPresent(s, id)).length >= c.minimum
      );
    case "item_near": {
      let holder = s.items[c.item]?.holder;
      const seen = new Set([c.item]);
      while (s.items[holder] && !seen.has(holder)) {
        seen.add(holder);
        holder = s.items[holder].holder;
      }
      return (
        (!controlledByHuman(s, holder) || humanPresent(s, holder)) &&
        objectPlace(s, c.item) === c.place
      );
    }
    case "item_present":
      return Boolean(s.items[c.item] && objectPlace(s, c.item) === c.place);
    // Any thing tagged c.tag, carried by someone present at c.place.
    case "tag_held":
      // A worn upgrade of that name counts as carrying the tag (#1873).
      return (
        Object.keys(s.actors).some(
          (id) =>
            s.actors[id].upgrades?.includes(c.tag) &&
            s.actors[id].place === c.place &&
            (!controlledByHuman(s, id) || humanPresent(s, id)),
        ) ||
        Object.keys(s.items).some((id) => {
          const holder = s.items[id].holder;
          return (
            Boolean(packThings[id]?.tags?.includes(c.tag)) &&
            entityActive(s, id) &&
            s.actors[holder]?.place === c.place &&
            (!controlledByHuman(s, holder) || humanPresent(s, holder))
          );
        })
      );
    case "item_at":
      return s.items[c.item]?.holder === c.place;
    // Any thing from that world in the place: carried there or resting there.
    case "pack_item_present":
      return Object.keys(s.items).some(
        (id) =>
          packThings[id]?.packId === c.pack &&
          entityActive(s, id) &&
          objectPlace(s, id) === c.place,
      );
    case "drawn":
      return !!state?.specials?.includes(c.id);
    case "met":
      return !!state?.met && Object.hasOwn(state.met, c.actor);
    // The saved world clock: every DAYLIGHT_TURNS turns, day and night swap.
    case "daylight":
      return (
        (Math.floor((s.turn || 0) / DAYLIGHT_TURNS) % 2 ? "night" : "day") ===
        c.phase
      );
    // The saved regional weather where c.place is.
    case "weather":
      return locationWeather(s, c.place)?.condition === c.condition;
    // A seeded chance: true for `lasts` turns at a time, one window in
    // `odds`, hashed from the run seed so every table agrees.
    case "chance":
      return (
        runHash(s, `${c.key}:${Math.floor((s.turn || 0) / c.lasts)}`) %
          c.odds ===
        0
      );
    // A transport docked (or just arrived) at a port, or "@sea" between ports.
    case "ship_at":
      return c.dock === "@sea"
        ? shipAtSea(s, c.transport)
        : shipDock(s, c.transport) === c.dock;
    default:
      return false;
  }
}
// A seeded number from the run seed and a key (FNV-1a), never Math.random,
// so the browser and the shared server roll alike and journals replay.
export function runHash(s, key) {
  let h = 2166136261;
  for (const ch of `${s.run?.seed ?? 0}:${key}`)
    h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}
const signalReady = (s, c, senses) =>
  (c.signal?.while || []).every((r) => conditionMet(s, r, senses, c.packId));
const windowOpen = (s, c) =>
  !c.signal ||
  (c.signal.opens === null
    ? crossingState(s, c.id)?.phase === c.signal.steps.length
    : s.turn < (crossingState(s, c.id)?.until ?? 0));
// A retired crossing stays open only in saves that had already found it.
export const crossingOpen = (s, c, senses) =>
  (!c.retired || Boolean(crossingState(s, c.id)?.discovered)) &&
  entityActive(s, c.from) &&
  entityActive(s, c.to) &&
  (c.transport
    ? transportUnlocked(s, c.transport) && shipDock(s, c.transport) === c.from
    : windowOpen(s, c) && signalReady(s, c, senses)) &&
  c.requires.every((r) => conditionMet(s, r, senses, c.packId));
export const crossingBetween = (from, to, s = null) =>
  (s && transportCrossing(s, from, to)) ||
  crossings.find((c) => !c.transport && c.from === from && c.to === to) ||
  null;
export const mayCross = (c, actor, senses) =>
  c.travelers === "any" ||
  actor === senses.player ||
  roamingQuestActor(actor) ||
  packPeople[actor]?.personalQuests ||
  senses.humanActors?.includes(actor);

/** Places reachable by crossing from `place` now, including an invited return home. */
export const crossingExits = (s, place, actor, senses) =>
  crossings
    .filter(
      (c) =>
        c.from === place &&
        (mayCross(c, actor, senses) ||
          (s.invitedPlaces?.[actor]?.includes(c.from) &&
            (packPeople[actor]?.packId ?? null) ===
              (packPlaces[c.to]?.packId ?? null))) &&
        crossingOpen(s, c, senses),
    )
    .map((c) => (c.transport ? transports[c.transport].place : c.to));

/** A pack is known once the player has found a way into it. */
export const packDiscovered = (s, packId) =>
  crossings.some(
    (c) =>
      c.packId === packId &&
      isPackPlace(c.to) &&
      crossingState(s, c.id)?.discovered,
  );
export function markCrossed(s, from, to) {
  const c = crossingBetween(from, to, s);
  if (c && !(c.transport && c.signal) && crossingState(s, c.id))
    s.crossings[c.id].discovered = true;
}
/** Extra place text from crossings that start here (open or closed). */
export const crossingScenery = (s, place, senses) =>
  crossings
    .filter((c) => c.from === place && c.scenery)
    .map((c) =>
      crossingOpen(s, c, senses) ? c.scenery.open : c.scenery.closed,
    )
    .filter(Boolean);

// --- Signals -----------------------------------------------------------
// A signal is an ordered list of resolved plays made at a crossing's start.
// Only plays that resolve count, so inspection, reloads, rejected offers and
// generated speech never advance it. Completing it opens the crossing for a
// window of turns; while open, a matching refresh play extends the window.

const matches = (p, a, holder) =>
  Boolean(p) &&
  p.verb === a.kind &&
  (p.item === undefined || p.item === a.item) &&
  (p.target === undefined || p.target === a.target) &&
  (p.from === undefined || p.from === holder);

/** Snapshot taken before a round: which crossings were open. */
export const beginRound = (s, senses) => ({
  open: Object.fromEntries(
    crossings.map((c) => [c.id, crossingOpen(s, c, senses)]),
  ),
  ready: Object.fromEntries(
    crossings.map((c) => [c.id, signalReady(s, c, senses)]),
  ),
  advanced: new Set(),
});
export const holderBefore = (s, a) =>
  a.item ? (s.items[a.item]?.holder ?? null) : null;

/**
 * Record one resolved play. `log(text, place)` writes a world line.
 * Returns nothing; signal progress lives in s.crossings.
 */
export function noteAct(s, a, place, holder, round, senses, log) {
  for (const c of crossings) {
    const signal = c.signal,
      state = s.crossings[c.id];
    if (!signal) continue;
    if (
      !round.ready[c.id] ||
      !signalReady(s, c, senses) ||
      s.actors[senses.player].place !== c.from
    ) {
      state.phase = 0;
      if (signal.opens === null) state.until = 0;
      continue;
    }
    if (place !== c.from) continue;
    if (a.actor !== senses.player) {
      if (signal.steps.some((p) => matches(p, a, holder))) state.phase = 0;
      continue;
    }
    if (signal.opens !== null && round.open[c.id]) {
      if (matches(signal.refresh, a, holder))
        state.until = s.turn + signal.opens;
      continue;
    }
    if (state.phase === signal.steps.length) {
      if (matches(signal.steps[0], a, holder)) state.phase = 0;
      else continue;
    }
    if (!matches(signal.steps[state.phase], a, holder)) {
      if (signal.steps.some((p) => matches(p, a, holder))) state.phase = 0;
      if (!matches(signal.steps[0], a, holder)) continue;
    }
    state.phase += 1;
    round.advanced.add(c.id);
    if (state.phase === signal.steps.length) {
      state.discovered = true;
      if (c.transport) summonTransport(s, c.transport, c.from);
      if (signal.opens !== null) {
        state.phase = 0;
        state.until = s.turn + signal.opens;
      }
      if (signal.complete) log(signal.complete, c.from);
    }
    // No progress lines: a physical manipulation confirms only that manipulation.
  }
}
/** Close the round: break signals and narrate crossings that changed. */
export function endRound(s, round, senses, log) {
  const here = s.actors[senses.player].place;
  for (const c of crossings) {
    const state = s.crossings[c.id];
    if (
      c.signal &&
      state.phase > 0 &&
      (here !== c.from ||
        !signalReady(s, c, senses) ||
        (c.signal.consecutive && !round.advanced.has(c.id)))
    )
      state.phase = 0;
    const open = crossingOpen(s, c, senses);
    if (open !== round.open[c.id] && here === c.from) {
      const text = open ? c.opened : c.closed;
      if (text) log(text, c.from);
    }
  }
}

/** A one-line answer after a step that did not yet complete the signal. */
export function signalEcho(s, location, card) {
  const c = crossings.find(
    (c) =>
      c.signal?.echo &&
      c.from === location &&
      s.crossings[c.id].phase > 0 &&
      matches(c.signal.steps[s.crossings[c.id].phase - 1], card),
  );
  return c?.signal.echo || null;
}

// --- Fixtures ----------------------------------------------------------

export const fixtureOffers = (s, actor, senses) =>
  actor !== senses.player
    ? []
    : fixturesAt(s.actors[actor].place).map((f) => ({
        kind: "ring",
        actor,
        item: null,
        target: f.at,
        fixture: f.id,
        label: f.sound.label,
        text: fill(f.sound.text, { actor: senses.nameOf(actor) }),
        cards: [f.at],
        key: `ring:${actor}::${f.at}:${f.id}`,
      }));
export function soundFixture(s, id) {
  const f = packFixtures[id];
  s.packs[f.packId].sounds[id] = s.turn + f.sound.turns;
}

// --- Temperament -------------------------------------------------------
// A resident with a temperament can sleep, wake, and grow irritated. Talking
// wakes it; a sound made where it rests wakes and irritates it; the player
// waiting quietly beside it calms it down.

export const hasTemperament = (id) => Boolean(packPeople[id]?.temperament);
export const residentsAt = (s, place) =>
  Object.keys(packPeople).filter(
    (id) => hasTemperament(id) && s.actors[id]?.place === place,
  );
export function variantOf(s, id) {
  const a = packPeople[id];
  if (!a?.temperament) return null;
  const state = s.actors[id];
  const name = !state.awake
    ? "asleep"
    : a.variants.irritated && state.irritation >= a.temperament.irritated
      ? "irritated"
      : "awake";
  return {
    name,
    ...(name === "irritated" ? a.variants.awake : {}),
    ...a.variants[name],
  };
}
export const greeting = (s, id, actor, senses) => {
  const v = variantOf(s, id);
  return {
    text: fill(v.greet, {
      actor: senses.nameOf(actor),
      name: senses.nameOf(id),
    }),
    ...(v.label ? { label: v.label } : {}),
  };
};
/** Talking to a sleeping resident wakes it. Returns narration or null. */
export function wakeByVoice(s, id) {
  const t = packPeople[id]?.temperament,
    a = s.actors[id];
  if (!t || a.awake) return null;
  a.awake = true;
  a.wakeCause = "voice";
  a.irritation = t.voice;
  return t.woken;
}
/** A sound made at `place` disturbs every resident there. */
export function disturb(s, place) {
  return residentsAt(s, place).map((id) => {
    const t = packPeople[id].temperament,
      a = s.actors[id];
    a.awake = true;
    a.wakeCause ??= "sound";
    a.irritation = Math.min(t.irritation, a.irritation + t.sound);
    return t.disturbed;
  });
}
/** The player waiting quietly calms residents here and eases grievances. */
export function calm(s, place, player) {
  for (const id of residentsAt(s, place)) {
    const t = packPeople[id].temperament,
      a = s.actors[id];
    a.irritation = Math.max(0, a.irritation - t.calm);
    if (s.motives?.grievances?.[id])
      s.motives.grievances[id] = s.motives.grievances[id]
        .map((g) => (g.other === player ? { ...g, weight: g.weight - 1 } : g))
        .filter((g) => g.weight > 0);
  }
}

// --- Validation --------------------------------------------------------

const exactKeys = (o, keys) =>
  o &&
  typeof o === "object" &&
  !Array.isArray(o) &&
  Object.keys(o).sort().join() === [...keys].sort().join();
const whole = (n, max) => Number.isSafeInteger(n) && n >= 0 && n <= max;

/** Saved crossing, pack and resident state agree with the mounted packs. */
export function validPackState(s, senses) {
  if (
    !validTransports(s) ||
    !exactKeys(
      s.crossings,
      crossings.map((c) => c.id),
    ) ||
    !exactKeys(
      s.packs,
      packDefinitions.map((p) => p.id),
    )
  )
    return false;
  for (const c of crossings) {
    const state = s.crossings[c.id];
    if (!c.signal) {
      if (!exactKeys(state, ["discovered"])) return false;
      if (typeof state.discovered !== "boolean") return false;
      continue;
    }
    if (
      !exactKeys(state, ["discovered", "phase", "until"]) ||
      typeof state.discovered !== "boolean" ||
      !whole(
        state.phase,
        c.signal.steps.length - (c.signal.opens === null ? 0 : 1),
      ) ||
      !whole(
        state.until,
        c.signal.opens === null ? 0 : s.turn + c.signal.opens,
      ) ||
      ((state.until > 0 ||
        (c.signal.opens === null && state.phase === c.signal.steps.length)) &&
        !state.discovered) ||
      (state.phase > 0 &&
        !(senses.humanActors || [senses.player]).some(
          (id) => s.actors[id]?.place === c.from,
        ))
    )
      return false;
  }
  for (const pack of packDefinitions) {
    const record = s.packs[pack.id];
    const fixtures = Object.entries(pack.fixtures || {});
    if (
      !exactKeys(record, [
        ...(pack.specials && s.run ? ["specials"] : []),
        ...(pack.choices
          ? [
              "revision",
              "sounds",
              "choices",
              "flags",
              "receipts",
              "met",
              "scope",
              ...(pack.recital ? ["recitals"] : []),
            ]
          : ["revision", "sounds"]),
      ]) ||
      record.revision !== pack.revision ||
      !exactKeys(
        record.sounds,
        fixtures.map(([id]) => id),
      ) ||
      fixtures.some(
        ([id, f]) => !whole(record.sounds[id], s.turn + f.sound.turns),
      )
    )
      return false;
  }
  for (const [id, a] of Object.entries(packPeople)) {
    const state = s.actors[id];
    if (!state) return false;
    const t = a.temperament;
    if (!t) {
      if (["awake", "irritation", "wakeCause"].some((k) => k in state))
        return false;
      continue;
    }
    if (
      typeof state.awake !== "boolean" ||
      !whole(state.irritation, t.irritation) ||
      ![null, "voice", "sound"].includes(state.wakeCause) ||
      (!state.awake && (state.wakeCause !== null || !t.asleep)) ||
      (state.awake && state.wakeCause === null && t.asleep)
    )
      return false;
  }
  return validatePackStates(s);
}
