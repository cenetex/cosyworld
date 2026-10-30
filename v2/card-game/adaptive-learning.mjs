// Online action values come from completed plays. The game supplies legal
// actions and goals; experience supplies each avatar's estimates and choices.
export const TRIAL_LIMIT = 32;
const horizon = 4;
const discount = 0.7;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const round = (n) => Math.round(n * 1000) / 1000;
const approach = (kind) =>
  ({
    ask: "asking",
    trade: "trading",
    give: "giving",
    talk: "talking",
    wait: "waiting",
    accompany: "inviting",
  })[kind];
const goalKey = (g) => [g.kind, g.target, g.item, g.destination].join(":");
const actionKey = (a) =>
  [a.kind, a.target, a.item, a.receive, a.destination].join(":");
const compactAction = (a) => ({
  kind: a.kind,
  target: a.target || null,
  item: a.item || null,
  receive: a.receive || null,
  destination: a.destination || null,
});
export function learningIntent(world, actor) {
  const want = world.actors[actor]?.want;
  return JSON.stringify([want?.kind ?? null, want?.target ?? null]);
}
function holder(world, item) {
  let id = item;
  const visited = new Set();
  while (world.items[id] && !visited.has(id)) {
    visited.add(id);
    id = world.items[id].holder;
  }
  return id;
}
function observation(world, actor, goal) {
  return {
    met:
      goal.kind === "ask"
        ? holder(world, goal.item) === actor
        : [actor, goal.target].every(
            (id) => world.actors[id]?.place === goal.destination,
          ),
    trust: world.actors[goal.target]?.trust?.[actor] || 0,
    held: Object.values(world.items).filter((item) => item.holder === actor)
      .length,
    strain: Math.min(
      3,
      (world.motives?.grievances[goal.target] || [])
        .filter((g) => g.other === actor)
        .reduce((n, g) => n + g.weight, 0),
    ),
  };
}
// A completed goal is worth twenty points. Trust and eased strain are small
// intermediate gains. A carried item is worth four points. Each play costs
// one point, so idle loops and gifts carry their actual cost.
export function outcomeReward(before, after) {
  return (
    20 * (Number(after.met) - Number(before.met)) +
    2 * (after.trust - before.trust + before.strain - after.strain) -
    4 * (before.held - after.held) -
    1
  );
}
function goalFor(world, actor, action) {
  if (["ask", "accompany", "trade"].includes(action.kind))
    return {
      kind: action.kind === "trade" ? "ask" : action.kind,
      target: action.target,
      item: action.kind === "trade" ? action.receive : action.item || null,
      destination: action.destination || null,
    };
  const last = world.memories[actor]?.learning?.findLast(
    (l) => l.version === 2,
  );
  if (
    last &&
    !last.after.met &&
    last.intent === learningIntent(world, actor) &&
    world.turn - last.turn <= horizon &&
    world.actors[actor].place === world.actors[last.goal.target]?.place &&
    related(action, last.goal)
  )
    return last.goal;
  return null;
}
function related(action, goal) {
  if (action.kind === "wait") return true;
  if (action.target !== goal.target) return false;
  if (["talk", "give"].includes(action.kind)) return true;
  if (goal.kind === "ask")
    return (
      (action.kind === "ask" && action.item === goal.item) ||
      (action.kind === "trade" && action.receive === goal.item)
    );
  return action.kind === "accompany" && action.destination === goal.destination;
}
function trialsFor(world, actor, goal) {
  return (world.memories[actor]?.learning || []).filter(
    (l) => l.version === 2 && goalKey(l.goal) === goalKey(goal),
  );
}
function sequence(trials, index) {
  const chain = [];
  for (let i = index; i < Math.min(trials.length, index + horizon); i++) {
    const trial = trials[i];
    if (
      i > index &&
      (trial.turn - trials[i - 1].turn > horizon ||
        !same(trials[i - 1].after, trial.before) ||
        trials[i - 1].afterConditions !== trial.conditions)
    )
      break;
    chain.push(trial);
    if (trial.after.met) break;
  }
  return chain;
}
function returns(trials, index) {
  return sequence(trials, index).reduce(
    (value, trial, i) => value + discount ** i * trial.reward,
    0,
  );
}
export function actionEstimate(world, actor, goal, conditions, action) {
  const trials = trialsFor(world, actor, goal);
  let sum = 0,
    weight = 0,
    samples = 0,
    local = 0;
  for (const [index, trial] of trials.entries()) {
    if (actionKey(trial.action) !== actionKey(action)) continue;
    const exact = trial.conditions === conditions;
    // Recent evidence matters most. Other conditions give a modest starting
    // estimate while fresh attempts establish a value for this situation.
    const w = (exact ? 1 : 0.25) * 0.9 ** (trials.length - index - 1);
    sum += w * returns(trials, index);
    weight += w;
    samples++;
    if (exact) local++;
  }
  return {
    value: samples ? round(sum / (weight + (local ? 0 : 1))) : null,
    samples,
    local,
  };
}
export function beginLearning(world, action, conditionsFor) {
  const goal = goalFor(world, action.actor, action);
  if (!goal || observation(world, action.actor, goal).met) return null;
  const conditions = conditionsFor(world, { ...goal, actor: action.actor });
  return {
    goal,
    intent: learningIntent(world, action.actor),
    conditions,
    before: observation(world, action.actor, goal),
    expected: actionEstimate(world, action.actor, goal, conditions, action),
  };
}
export function finishLearning(world, action, prepared, event, conditionsFor) {
  if (!prepared) return;
  const after = observation(world, action.actor, prepared.goal);
  const trial = {
    version: 2,
    seq: event.seq,
    turn: event.turn,
    ...prepared,
    action: compactAction(action),
    after,
    afterConditions: conditionsFor(world, {
      ...prepared.goal,
      actor: action.actor,
    }),
    reward: outcomeReward(prepared.before, after),
    evidence: event.text.slice(0, 650),
  };
  const memory = world.memories[action.actor];
  memory.learning = [...(memory.learning || []), trial].slice(-TRIAL_LIMIT);
}
function tieBreak(text) {
  let hash = 2166136261;
  for (const c of text) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return hash >>> 0;
}
export function learnedPlan(world, actor, selected, actions, conditionsFor) {
  const goal = goalFor(world, actor, selected.action);
  if (!goal) return selected;
  const before = observation(world, actor, goal);
  if (before.met) return selected;
  const trials = trialsFor(world, actor, goal);
  if (!trials.length) return selected;
  const conditions = conditionsFor(world, { ...goal, actor });
  const total = trials.filter((l) => l.conditions === conditions).length;
  const choices = actions
    .filter((a) => related(a, goal))
    .map((action) => {
      const estimate = actionEstimate(world, actor, goal, conditions, action);
      return {
        action,
        ...estimate,
        score:
          (estimate.local ? estimate.value : Math.max(0, estimate.value ?? 0)) +
          3 * Math.sqrt(Math.log(total + 2) / (estimate.local + 1)),
        tie:
          action.key === selected.action.key && !estimate.local
            ? -1
            : tieBreak(`${actor}:${goalKey(goal)}:${actionKey(action)}`),
      };
    });
  choices.sort((a, b) => b.score - a.score || a.tie - b.tie);
  const chosen = choices[0];
  if (!chosen) return selected;
  // A legal trade completes this goal in one play with the same item count.
  // Keep that known result unless another approach has earned a higher value.
  if (
    selected.action.kind === "trade" &&
    actions.some((action) => action.key === selected.action.key) &&
    chosen.action.key !== selected.action.key &&
    (chosen.value ?? -Infinity) <=
      outcomeReward(before, { ...before, met: true })
  )
    return selected;
  return {
    action: chosen.action,
    reason: chosen.samples
      ? `Choose ${approach(chosen.action.kind)} from ${chosen.samples} earlier measured ${chosen.samples === 1 ? "attempt" : "attempts"}.`
      : `Try ${approach(chosen.action.kind)} for this goal.`,
    lessonSeq: trials.at(-1).seq,
    learning: {
      goal,
      expected: {
        value: chosen.value,
        samples: chosen.samples,
        local: chosen.local,
      },
      exploring: chosen.local === 0,
      alternatives: choices.map(({ action, value, samples, local }) => ({
        action: compactAction(action),
        value,
        samples,
        local,
      })),
    },
  };
}
export function trialFacts(world, actor, nameOf) {
  const trial = world.memories[actor]?.learning?.at(-1);
  if (trial?.version !== 2) return null;
  const goal = trial.goal;
  const purpose =
    goal.kind === "ask" ? nameOf(goal.item) : nameOf(goal.destination);
  const result = trial.after.met
    ? "That reached my goal."
    : trial.reward > 0
      ? "That improved our relationship."
      : "My goal is still open.";
  const earlier = trial.expected.samples
    ? `I had ${trial.expected.samples} earlier ${trial.expected.samples === 1 ? "attempt" : "attempts"} at ${approach(trial.action.kind)} to compare.`
    : "This was my first measured try at that approach.";
  const trials = trialsFor(world, actor, goal);
  const keys = new Map(trials.map((t) => [actionKey(t.action), t.action]));
  const describe = (a) => {
    if (a.kind === "ask")
      return `asking ${nameOf(a.target)} for ${nameOf(a.item)}`;
    if (a.kind === "trade")
      return `trading ${nameOf(a.item)} for ${nameOf(a.receive)}`;
    if (a.kind === "give")
      return `giving ${nameOf(a.item)} to ${nameOf(a.target)}`;
    if (a.kind === "talk") return `talking with ${nameOf(a.target)}`;
    if (a.kind === "accompany")
      return `inviting ${nameOf(a.target)} to ${nameOf(a.destination)}`;
    return "waiting";
  };
  return [
    `I tried ${describe(trial.action)} while seeking ${purpose}. ${result} ${earlier}`,
    ...[...keys.values()].slice(-4).map((a) => {
      const estimate = actionEstimate(world, actor, goal, trial.conditions, a);
      const reached = trials.filter(
        (t, i) =>
          actionKey(t.action) === actionKey(a) &&
          sequence(trials, i).some((t) => t.after.met),
      ).length;
      const label = describe(a);
      return `${label[0].toUpperCase()}${label.slice(1)}: ${estimate.samples} measured ${estimate.samples === 1 ? "attempt" : "attempts"}. This approach helped reach my goal ${reached} ${reached === 1 ? "time" : "times"}.`;
    }),
  ];
}
const fields = (o, names) =>
  o &&
  typeof o === "object" &&
  Object.keys(o).sort().join() === names.split(" ").sort().join();
const validObservation = (o) =>
  fields(o, "met trust strain held") &&
  typeof o.met === "boolean" &&
  Number.isInteger(o.held) &&
  o.held >= 0 &&
  o.held <= 3 &&
  [o.trust, o.strain].every((n) => Number.isInteger(n) && n >= 0 && n <= 3);
function validAction(action, goal) {
  if (!related(action, goal)) return false;
  const empty = (...names) => names.every((name) => action[name] === null);
  switch (action.kind) {
    case "ask":
      return action.item === goal.item && empty("receive", "destination");
    case "trade":
      return (
        Boolean(action.item) &&
        action.receive === goal.item &&
        action.item !== action.receive &&
        empty("destination")
      );
    case "accompany":
      return (
        action.destination === goal.destination && empty("item", "receive")
      );
    case "give":
      return Boolean(action.item) && empty("receive", "destination");
    case "talk":
      return empty("item", "receive", "destination");
    case "wait":
      return empty("target", "item", "receive", "destination");
    default:
      return false;
  }
}
function matchesObservation(text, observed, actor, goal) {
  try {
    const parts = JSON.parse(text);
    if (
      !Array.isArray(parts) ||
      parts.length !== 8 ||
      parts[1] !== observed.trust ||
      !Array.isArray(parts[2]) ||
      !Array.isArray(parts[5])
    )
      return false;
    const strain = Math.min(
      3,
      parts[2].filter((g) => g[0] === actor).reduce((n, g) => n + g[2], 0),
    );
    if (strain !== observed.strain) return false;
    const items = new Map(parts[5].map(([id, owner]) => [id, owner]));
    if (
      [...items.values()].filter((id) => id === actor).length !== observed.held
    )
      return false;
    let root = goal.item;
    const visited = new Set();
    while (items.has(root) && !visited.has(root)) {
      visited.add(root);
      root = items.get(root);
    }
    const met =
      goal.kind === "ask"
        ? root === actor
        : parts[0] === goal.destination && parts[6] === goal.destination;
    return met === observed.met;
  } catch {
    return false;
  }
}
export function validTrial(world, actor, trial, profiles) {
  if (
    !fields(
      trial,
      "version seq turn goal intent conditions before expected action after afterConditions reward evidence",
    )
  )
    return false;
  if (trial.version !== 2) return false;
  const { goal, action, expected } = trial;
  if (
    !fields(goal, "kind target item destination") ||
    !["ask", "accompany"].includes(goal.kind) ||
    !world.actors[goal.target] ||
    goal.target === actor ||
    (goal.kind === "ask"
      ? !world.items[goal.item] || goal.destination !== null
      : goal.item !== null ||
        profiles[goal.destination]?.kind !== "location") ||
    !fields(action, "kind target item receive destination") ||
    !validAction(action, goal) ||
    (action.kind === "wait" &&
      [action.target, action.item, action.receive, action.destination].some(
        (x) => x !== null,
      )) ||
    [action.item, action.receive].some(
      (id) => id !== null && !world.items[id],
    ) ||
    (action.destination !== null &&
      profiles[action.destination]?.kind !== "location") ||
    !validObservation(trial.before) ||
    !validObservation(trial.after) ||
    trial.before.met ||
    trial.reward !== outcomeReward(trial.before, trial.after) ||
    !fields(expected, "value samples local") ||
    !Number.isInteger(expected.samples) ||
    expected.samples < 0 ||
    expected.samples > TRIAL_LIMIT ||
    !Number.isInteger(expected.local) ||
    expected.local < 0 ||
    expected.local > expected.samples ||
    (expected.samples === 0
      ? expected.value !== null
      : !Number.isFinite(expected.value) || Math.abs(expected.value) > 100) ||
    typeof trial.conditions !== "string" ||
    trial.conditions.length > 16000 ||
    typeof trial.afterConditions !== "string" ||
    trial.afterConditions.length > 16000 ||
    typeof trial.intent !== "string" ||
    trial.intent.length > 2000 ||
    typeof trial.evidence !== "string" ||
    !trial.evidence.length ||
    trial.evidence.length > 650
  )
    return false;
  if (
    !matchesObservation(trial.conditions, trial.before, actor, goal) ||
    !matchesObservation(trial.afterConditions, trial.after, actor, goal)
  )
    return false;
  if (JSON.parse(trial.conditions)[7] !== trial.intent) return false;
  const source = world.log.find((e) => e.seq === trial.seq);
  return (
    !source ||
    (!source.generated &&
      source.kind === "action" &&
      source.actorId === actor &&
      source.turn === trial.turn &&
      source.verb === action.kind &&
      (source.targetId || null) === action.target &&
      (source.itemId || null) === action.item &&
      (source.receiveId || null) === action.receive &&
      (source.destinationId || null) === action.destination &&
      source.text.slice(0, 650) === trial.evidence &&
      (!["ask", "accompany"].includes(action.kind) ||
        source.accepted === trial.after.met))
  );
}
