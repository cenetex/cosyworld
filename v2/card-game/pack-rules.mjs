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
  packFixtures,
  crossings,
  fixturesAt,
  isPackPlace,
} from "./pack-registry.mjs";

const fill = (template, values) =>
  template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
const crossingState = (s, id) => s.crossings?.[id];

// --- State -------------------------------------------------------------

export const newCrossingState = (c) =>
  c.signal ? { discovered: false, phase: 0, until: 0 } : { discovered: false };
export const newPackRecord = (pack) => ({
  revision: pack.revision,
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

function conditionMet(s, c, senses) {
  switch (c.kind) {
    case "sound":
      return c.at.some((place) => soundAt(s, place, senses));
    default:
      return false;
  }
}
const windowOpen = (s, c) =>
  !c.signal || s.turn < (crossingState(s, c.id)?.until ?? 0);
export const crossingOpen = (s, c, senses) =>
  windowOpen(s, c) && c.requires.every((r) => conditionMet(s, r, senses));
export const crossingBetween = (from, to) =>
  crossings.find((c) => c.from === from && c.to === to) || null;
export const mayCross = (c, actor, senses) =>
  c.travelers === "any" || actor === senses.player;

/** Places reachable by crossing from `place` now, for this actor. */
export const crossingExits = (s, place, actor, senses) =>
  crossings
    .filter(
      (c) =>
        c.from === place &&
        mayCross(c, actor, senses) &&
        crossingOpen(s, c, senses),
    )
    .map((c) => c.to);

/** A pack is known once the player has found a way into it. */
export const packDiscovered = (s, packId) =>
  crossings.some(
    (c) =>
      c.packId === packId &&
      isPackPlace(c.to) &&
      crossingState(s, c.id)?.discovered,
  );
export function markCrossed(s, from, to) {
  const c = crossingBetween(from, to);
  if (c && crossingState(s, c.id)) s.crossings[c.id].discovered = true;
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
    const signal = c.signal;
    if (!signal || place !== c.from) continue;
    const state = s.crossings[c.id];
    if (round.open[c.id]) {
      if (matches(signal.refresh, a, holder))
        state.until = s.turn + signal.opens;
      continue;
    }
    if (a.actor !== senses.player) continue;
    if (!matches(signal.steps[state.phase], a, holder)) continue;
    state.phase += 1;
    round.advanced.add(c.id);
    if (state.phase === signal.steps.length) {
      state.phase = 0;
      state.discovered = true;
      state.until = s.turn + signal.opens;
      log(signal.complete, c.from);
    } else if (signal.progress?.[state.phase - 1]) {
      log(signal.progress[state.phase - 1], c.from);
    }
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
      (here !== c.from || (c.signal.consecutive && !round.advanced.has(c.id)))
    )
      state.phase = 0;
    const open = crossingOpen(s, c, senses);
    if (open !== round.open[c.id] && here === c.from) {
      const text = open ? c.opened : c.closed;
      if (text) log(text, c.from);
    }
  }
}

/** Wording for an offer that would continue a signal or refresh its window. */
export function signalOffer(s, a, senses) {
  if (a.actor !== senses.player) return null;
  const here = s.actors[a.actor].place,
    holder = holderBefore(s, a);
  for (const c of crossings) {
    if (!c.signal?.offer || c.from !== here) continue;
    const next = crossingOpen(s, c, senses)
      ? c.signal.refresh
      : s.crossings[c.id].phase > 0
        ? c.signal.steps[s.crossings[c.id].phase]
        : null;
    if (matches(next, a, holder))
      return fill(c.signal.offer, { actor: senses.nameOf(a.actor) });
  }
  return null;
}
/** Status line for a hub object the next signal step asks for. */
export function signalHint(s, item, senses) {
  const here = s.actors[senses.player].place;
  const c = crossings.find(
    (c) =>
      c.signal?.hint &&
      c.from === here &&
      s.crossings[c.id].phase > 0 &&
      c.signal.steps[s.crossings[c.id].phase].item === item,
  );
  return c?.signal.hint || null;
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
export const noiseGrievance = (id) => packPeople[id]?.tastes.noise || null;
export const noiseText = (id, actor, senses) =>
  fill(packPeople[id].tastes.noise, { actor: senses.nameOf(actor) });

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
      !whole(state.phase, c.signal.steps.length - 1) ||
      !whole(state.until, s.turn + c.signal.opens) ||
      (state.until > 0 && !state.discovered) ||
      (state.phase > 0 && s.actors[senses.player]?.place !== c.from)
    )
      return false;
  }
  for (const pack of packDefinitions) {
    const record = s.packs[pack.id];
    const fixtures = Object.entries(pack.fixtures || {});
    if (
      !exactKeys(record, ["revision", "sounds"]) ||
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
  return true;
}
