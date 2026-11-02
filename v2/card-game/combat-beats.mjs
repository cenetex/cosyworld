// Combat presentation: read one play's committed standoff events as beats.
//
// The rules own every outcome. This module only reads the log the rules
// wrote. Structured fields (damage, resolveBefore/After, outcome, lossCount,
// and a "retreat" or "sent-home" move) are used when present; otherwise the
// standoff state before the play and the rules' own English lines fill in.
import { nameOf } from "./world.mjs";

export const COMBAT_VERBS = ["threaten", "guard", "intercept", "attack"];
export const DEFEAT_MOVES = ["retreat", "sent-home"];
export const MAX_RESOLVE = 4;
const YIELDED = /after yielding to/u;
// A name inside a sentence: "strikes the keeper", not "strikes The keeper".
const ARTICLE = /^(?:The|A|An) /u;
export const inSentence = (id) =>
  nameOf(id).replace(ARTICLE, (article) => article.toLowerCase());
// A thing named with "the" once: "the lamp", "the Burial Decree", never
// "the the Burial Decree".
export const theName = (id) =>
  ARTICLE.test(nameOf(id)) ? inSentence(id) : `the ${nameOf(id)}`;

const holderRoot = (world, id) => {
  let holder = world.items?.[id]?.holder;
  const seen = new Set();
  while (world.items?.[holder] && !seen.has(holder)) {
    seen.add(holder);
    holder = world.items[holder].holder;
  }
  return holder ?? null;
};

function defeatMove(entry) {
  return (
    !entry.generated &&
    (DEFEAT_MOVES.includes(entry.verb) ||
      (!entry.verb &&
        entry.fromLocationId &&
        entry.fromLocationId !== entry.locationId &&
        YIELDED.test(entry.text || "")))
  );
}

// A standoff line the viewer took part in or saw.
export function isCombatLine(entry, viewer) {
  if (!entry || entry.generated) return false;
  const combat = COMBAT_VERBS.includes(entry.verb) || defeatMove(entry);
  if (!combat) return false;
  return (
    entry.actorId === viewer ||
    entry.targetId === viewer ||
    Boolean(entry.witnesses?.includes(viewer))
  );
}

export const lastSeq = (world) => world?.log?.at(-1)?.seq ?? 0;

function outcomeOf(entry, after) {
  if (["hit", "guarded", "yield", "sent-home"].includes(entry.outcome))
    return entry.outcome;
  if (after === 0) return "yield";
  return /guard softens/u.test(entry.text || "") ? "guarded" : "hit";
}

export function outcomeWord(beat) {
  if (beat.kind === "threaten") return "Standoff";
  if (beat.kind === "guard") return "Bracing";
  if (beat.kind === "intercept") return "Guarding";
  if (beat.outcome === "sent-home") return "Sent home";
  if (beat.outcome === "yield") return "Yields";
  if (beat.outcome === "guarded") return `Braced −${beat.damage}`;
  return `−${beat.damage} resolve`;
}

export function telegraphText(beat) {
  const who = nameOf(beat.actorId),
    other = inSentence(beat.targetId);
  if (beat.kind === "threaten")
    return beat.itemId
      ? `${who} eyes ${theName(beat.itemId)}`
      : `${who} squares up to ${other}`;
  if (beat.kind === "guard") return `${who} braces`;
  // Alignment is read from the latest plays only; the rules keep no sides.
  if (beat.kind === "intercept") return `${who} sides with ${other}`;
  const aimed = inSentence(beat.coveredId || beat.targetId);
  return `${who} ${beat.turnsOn ? "turns on" : "strikes"} ${aimed}`;
}

// The beats of every standoff line after `sinceSeq` that the viewer saw from
// `place` (the viewer's place before the play).
export function combatBeats(before, after, { viewer, place, sinceSeq } = {}) {
  const since = sinceSeq ?? lastSeq(before);
  const here = place ?? before?.actors?.[viewer]?.place;
  const fresh = (after?.log || []).filter(
    (entry) => entry.seq > since && !entry.generated,
  );
  // Each combatant is in one battle, so one map holds every resolve, and
  // `sides` holds who guards whom after the latest plays.
  const pool = {},
    sides = new Map();
  for (const c of before?.standoffs || []) {
    Object.assign(pool, c.resolve);
    for (const [guard, ward] of Object.entries(c.covering || {}))
      sides.set(guard, ward);
  }
  const beats = [];
  for (const entry of fresh) {
    if (!COMBAT_VERBS.includes(entry.verb)) continue;
    const at = entry.locationId || entry.fromLocationId;
    if (at !== here && entry.fromLocationId !== here) continue;
    const actorId = entry.actorId,
      targetId = entry.targetId,
      coveredId = entry.coveredId || null;
    // A Brace names no target.
    if (!actorId || (!targetId && entry.verb !== "guard")) continue;
    const base = {
      seq: entry.seq,
      kind: entry.verb,
      actorId,
      targetId,
      coveredId,
      // Who steps forward for this exchange: the actor, a guard taking the
      // hit, and the one aimed at.
      front: [actorId, targetId, coveredId].filter(Boolean),
      itemId: entry.itemId || null,
      locationId: here,
      text: entry.text,
      viewerInvolved: [actorId, targetId, coveredId].includes(viewer),
    };
    if (entry.verb === "threaten") {
      pool[actorId] = entry.resolveBefore ?? MAX_RESOLVE;
      pool[targetId] = MAX_RESOLVE;
    }
    if (entry.verb === "intercept") sides.set(actorId, targetId);
    if (entry.verb !== "attack") {
      beats.push({ ...base, resolve: { ...pool } });
      continue;
    }
    const aimed = coveredId || targetId;
    const turnsOn =
      sides.get(actorId) === aimed || sides.get(aimed) === actorId;
    sides.delete(actorId);
    const damage = Number.isFinite(entry.damage)
      ? entry.damage
      : Number(/loses (\d+) resolve/u.exec(entry.text || "")?.[1] || 0);
    const resolveBefore = Number.isFinite(entry.resolveBefore)
      ? entry.resolveBefore
      : (pool[targetId] ?? MAX_RESOLVE);
    const resolveAfter = Number.isFinite(entry.resolveAfter)
      ? entry.resolveAfter
      : Math.max(0, resolveBefore - damage);
    pool[targetId] = resolveAfter;
    const outcome = outcomeOf(entry, resolveAfter);
    const beat = {
      ...base,
      turnsOn,
      damage,
      resolveBefore,
      resolveAfter,
      outcome,
      lossCount: Number.isFinite(entry.lossCount) ? entry.lossCount : null,
      resolve: { ...pool },
      structured: Number.isFinite(entry.resolveAfter),
    };
    beats.push(beat);
    if (outcome === "yield" || outcome === "sent-home")
      beats.push(defeatBeat(before, after, beat, fresh, { viewer, here }));
  }
  return beats;
}

function defeatBeat(before, after, attack, fresh, { viewer, here }) {
  const loserId = attack.targetId;
  const move = fresh.find(
    (entry) =>
      entry.seq > attack.seq && entry.actorId === loserId && defeatMove(entry),
  );
  const sentHome = attack.outcome === "sent-home" || move?.verb === "sent-home";
  const locationId =
    move?.locationId || after?.actors?.[loserId]?.place || here;
  const droppedItemIds = Array.isArray(move?.droppedItemIds)
    ? move.droppedItemIds
    : Array.isArray(attack.droppedItemIds)
      ? attack.droppedItemIds
      : Object.keys(before?.items || {}).filter(
          (id) =>
            holderRoot(before, id) === loserId &&
            after?.items?.[id]?.holder === here,
        );
  return {
    seq: move?.seq ?? attack.seq,
    kind: "defeat",
    actorId: attack.actorId,
    targetId: loserId,
    winnerId: attack.actorId,
    loserId,
    fromLocationId: here,
    locationId,
    moved: locationId !== here,
    droppedItemIds,
    sentHome,
    lossCount: attack.lossCount,
    viewerLost: loserId === viewer,
    viewerInvolved: [attack.actorId, loserId].includes(viewer),
    text: move?.text || null,
  };
}

// What the defeat card says. Second person for the viewer.
export function defeatSummary(beat) {
  const winner = nameOf(beat.winnerId);
  const you = beat.viewerLost;
  const loser = you ? "You" : nameOf(beat.loserId);
  const changes = beat.droppedItemIds.map(
    (id) => `${loser} dropped ${theName(id)}.`,
  );
  if (beat.lossCount) changes.push(`Standoffs lost: ${beat.lossCount} of 3.`);
  if (beat.sentHome) changes.push("Sent home.");
  else if (beat.moved)
    changes.push(`${loser} fell back from ${inSentence(beat.fromLocationId)}.`);
  return {
    title: you
      ? `${winner} drove you off`
      : `${winner} drove ${inSentence(beat.loserId)} off`,
    changes,
    arrival: `You come to at ${inSentence(beat.locationId)}`,
  };
}

// Timing. Each beat lists its phases in ms from the beat's start at 1×.
export const BEAT_MS = Object.freeze({
  telegraph: 360,
  lunge: 400,
  hold: 100,
  back: 300,
  recoil: 450,
  hitStop: 100,
  drain: 350,
  word: 800,
  beaten: 520,
  budget: 3000,
});

export function beatPlan(beat) {
  const t = BEAT_MS;
  if (beat.kind === "attack") {
    const impact = t.telegraph + t.recoil;
    return {
      steps: [
        { at: 0, phase: "telegraph" },
        { at: t.telegraph, phase: "strike" },
        { at: impact, phase: "impact" },
        { at: impact + t.hitStop, phase: "resolve" },
      ],
      duration: t.telegraph + t.lunge + t.hold + t.back + t.hitStop,
    };
  }
  if (beat.kind === "defeat")
    return {
      steps: [{ at: 0, phase: "beaten" }],
      duration: t.beaten,
    };
  return {
    steps: [
      { at: 0, phase: "telegraph" },
      { at: t.telegraph, phase: "resolve" },
    ],
    duration: t.telegraph + (beat.kind === "threaten" ? 560 : 360),
  };
}

// Plans for a whole play, compressed to stay inside the budget at 1×, then
// divided by the chosen speed.
export function sequencePlan(beats, { speed = 1 } = {}) {
  const plans = beats.map((beat) => ({ beat, ...beatPlan(beat) }));
  const total = plans.reduce((sum, p) => sum + p.duration, 0);
  const scale = (total > BEAT_MS.budget ? BEAT_MS.budget / total : 1) / speed;
  return {
    scale,
    total: total * scale,
    plans: plans.map((p) => ({
      beat: p.beat,
      duration: p.duration * scale,
      steps: p.steps.map((step) => ({ ...step, at: step.at * scale })),
    })),
  };
}

// Run beats through `apply(beat, phase, info)`. finishBeat() lands the
// current beat at once: every remaining phase still applies, so outcome text
// is never skipped. cancel() stops after the current call.
export function createBeatRunner({ apply, delay }) {
  let skip = null,
    skipping = false,
    cancelled = false;
  const wait = (ms) =>
    new Promise((resolve) => {
      if (skipping || cancelled || ms <= 0) return resolve();
      const timer = delay(ms, resolve);
      skip = () => {
        timer?.cancel?.();
        resolve();
      };
    });
  return {
    async run(beats, options = {}) {
      cancelled = false;
      const plan = sequencePlan(beats, options);
      for (const { beat, steps, duration } of plan.plans) {
        if (cancelled) return false;
        skipping = false;
        let at = 0;
        for (const step of steps) {
          await wait(step.at - at);
          if (cancelled) return false;
          at = step.at;
          apply(beat, step.phase, { skipped: skipping, scale: plan.scale });
        }
        await wait(duration - at);
        skip = null;
      }
      return !cancelled;
    },
    finishBeat() {
      skipping = true;
      skip?.();
    },
    cancel() {
      cancelled = true;
      skip?.();
    },
  };
}
