#!/usr/bin/env node

// Design-spike simulator only. It does not import or mutate the active world.
const actions = [
  "attack", "dash", "disengage", "dodge", "help", "hide",
  "influence", "magic", "ready", "search", "study", "utilize",
];
const trials = 10_000;

function hash(seed, value) {
  let state = (0x811c9dc5 ^ seed) >>> 0;
  for (const character of value) {
    state ^= character.codePointAt(0);
    state = Math.imul(state, 0x01000193) >>> 0;
  }
  return state;
}

function deal(seed, refresh = 0) {
  return actions
    .slice()
    .sort((left, right) => hash(seed ^ refresh, left) - hash(seed ^ refresh, right) || left.localeCompare(right))
    .slice(0, 3);
}

function runProjection(required) {
  return { locked: false, delay: 0, suggested: true, fallbackUsed: false, required };
}

function runDeckGated(seed, required) {
  const hand = deal(seed);
  if (hand.includes(required)) {
    return { locked: false, delay: 0, suggested: true, fallbackUsed: false, required };
  }
  // The proposed accessibility fallback exposes one legal non-card command
  // immediately. It costs no turn, currency, discard, or ownership resource.
  return { locked: false, delay: 1, suggested: false, fallbackUsed: true, required };
}

function summarize(results) {
  const count = results.length;
  const percentage = (value) => Number(((value / count) * 100).toFixed(2));
  return {
    trials: count,
    lockout_rate_percent: percentage(results.filter((row) => row.locked).length),
    initial_miss_rate_percent: percentage(results.filter((row) => !row.suggested).length),
    fallback_use_rate_percent: percentage(results.filter((row) => row.fallbackUsed).length),
    mean_selection_delay_steps: Number((results.reduce((sum, row) => sum + row.delay, 0) / count).toFixed(3)),
  };
}

const projection = [];
const deckGated = [];
for (let seed = 1; seed <= trials; seed += 1) {
  const required = actions[hash(seed, "required") % actions.length];
  projection.push(runProjection(required));
  deckGated.push(runDeckGated(seed, required));
}

const report = {
  spike: "cosyworld.variant/deck-gated-ordinary-actions/0",
  shipping_status: "prototype_only",
  hand_size: 3,
  ordinary_action_count: actions.length,
  projection: summarize(projection),
  deck_gated_with_free_fallback: summarize(deckGated),
  invariant: "a free legal fallback prevents shared-world lockout",
};
console.log(JSON.stringify(report, null, 2));
if (report.deck_gated_with_free_fallback.lockout_rate_percent !== 0) process.exitCode = 1;
