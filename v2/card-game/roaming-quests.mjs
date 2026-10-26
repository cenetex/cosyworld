import {
  latestQuestCompletion,
  recordQuestCompletion,
} from "./quest-completions.mjs";
import {
  addQuestRecord,
  questRecord,
  questRecords,
  focusQuest,
  retireQuest,
  clearQuestFocus,
} from "./shared-quests.mjs";

export const JOURNEY_HISTORY_LIMIT = 32;
const familyKinds = ["journey", "help"];
const unfinished = (q) => q && q.completedTurn === null && !q.retired;
const edgeKey = ([from, to]) => `${from}>${to}`;
const clone = (value) => structuredClone(value);

// Each actor learns routes from its home region, its own travel, and shared
// directions. A saved edge is knowledge; the live exit guard decides access.
export function rememberRoutes(world, actor, edges) {
  const knowledge = (world.routeKnowledge ??= {});
  const known = new Map(
    (knowledge[actor] || []).map((edge) => [edgeKey(edge), edge]),
  );
  for (const edge of edges) known.set(edgeKey(edge), [...edge]);
  knowledge[actor] = [...known.values()].sort((a, b) =>
    edgeKey(a).localeCompare(edgeKey(b)),
  );
}
export function knownRoute(world, actor, from, to, allowed = () => true) {
  const queue = [[from]],
    seen = new Set([from]);
  const edges = world.routeKnowledge?.[actor] || [];
  while (queue.length) {
    const path = queue.shift(),
      here = path.at(-1);
    if (here === to) return path;
    for (const [start, end] of edges) {
      if (start !== here || seen.has(end) || !allowed(start, end, path.at(-2)))
        continue;
      seen.add(end);
      queue.push([...path, end]);
    }
  }
  return null;
}
export function installRoamingQuests(world, actors, api) {
  world.roamingQuests ??= {};
  world.routeKnowledge ??= {};
  for (const actor of actors) {
    if (!world.roamingQuests[actor]) {
      world.roamingQuests[actor] = {
        afterSeq: 0,
        target: null,
        questKey: null,
        blocked: null,
        lastActedTurn: -1,
        history: [],
      };
      rememberRoutes(world, actor, api.initialEdges(actor));
    }
    rememberRoutes(world, actor, api.visibleEdges(world.actors[actor].place));
  }
}
function archiveFamily(world, actor, state) {
  const rootId = state.target?.id;
  if (!rootId) return;
  for (const q of questRecords(world).filter(
    (q) =>
      familyKinds.includes(q.cause?.kind) &&
      q.cause.rootId === rootId &&
      (q.subjectActor === actor ||
        q.program.steps.some((h) => h.passage?.actor === actor)),
  )) {
    if (unfinished(q)) retireQuest(world, q.key);
    state.history.push({
      key: q.key,
      name: q.program.name,
      cause: clone(q.cause),
      createdTurn: q.createdTurn,
      completedTurn: q.completedTurn,
      retiredTurn: q.retired?.turn ?? null,
    });
    clearQuestFocus(world, q.key);
    delete world.quests.records[q.key];
  }
  state.history = state.history.slice(-JOURNEY_HISTORY_LIMIT);
}
export function refreshRoamingQuest(world, actor, api) {
  const state = world.roamingQuests[actor];
  const latest = latestQuestCompletion(world, { afterSeq: state.afterSeq });
  if (!latest) return state;
  archiveFamily(world, actor, state);
  state.afterSeq = latest.seq;
  state.target = clone(latest);
  state.blocked = null;
  const quest = addQuestRecord(world, {
    holder: { kind: "avatar", id: actor },
    subjectActor: actor,
    cause: { kind: "journey", rootId: latest.id },
    program: {
      id: `journey:${actor}:${latest.seq}`,
      name: `Visit ${api.nameOf(latest.locationId)}`,
      purpose: `Reach the place where ${api.nameOf(latest.actorId)} completed a quest.`,
      steps: [{ items: [], avatars: [], location: latest.locationId }],
    },
  });
  state.questKey = quest?.key ?? null;
  if (quest) focusQuest(world, actor, quest.key);
  return state;
}
function finish(world, quest, actor) {
  if (!unfinished(quest)) return;
  quest.step = quest.program.steps.length;
  quest.completedTurn = world.turn;
  quest.lastProgressTurn = world.turn;
  clearQuestFocus(world, quest.key);
  recordQuestCompletion(world, quest, {
    actorId: actor,
    locationId: world.actors[actor].place,
    participants: quest.participants,
    cause: quest.cause,
  });
}
export function roamingHelpMet(world, hand, api) {
  const help = hand.passage;
  if (!help) return true;
  if (help.kind === "directions")
    return !!knownRoute(world, help.actor, help.from, help.to);
  return api.exits(help.from, help.actor).includes(help.to);
}
function requestHelp(world, actor, state, from, to, kind, api) {
  const cause = { kind: "help", rootId: state.target.id };
  const key = `${kind}:${from}>${to}`;
  const old = questRecords(world).find(
    (q) =>
      unfinished(q) &&
      q.cause?.kind === "help" &&
      q.cause.rootId === cause.rootId &&
      q.program.steps[0]?.passage?.actor === actor &&
      q.program.steps[0].passage.from === from &&
      q.program.steps[0].passage.to === to &&
      q.program.steps[0].passage.kind === kind,
  );
  const record =
    old ||
    addQuestRecord(world, {
      holder: { kind: "place", id: from },
      cause,
      program: {
        id: `help:${actor}:${state.target.seq}:${key}`,
        name:
          kind === "directions"
            ? `Show the way to ${api.nameOf(to)}`
            : `Open the way to ${api.nameOf(to)}`,
        purpose: `${api.nameOf(actor)} needs ${kind === "directions" ? "directions" : "passage"} from ${api.nameOf(from)}.`,
        steps: [
          {
            items: [],
            avatars: [],
            location: from,
            passage: { actor, from, to, kind },
          },
        ],
      },
    });
  state.blocked = { kind, from, to, questKey: record?.key ?? null };
  return record;
}
export function shareRoamingDirections(world, actor, api) {
  const state = world.roamingQuests[actor];
  for (const q of questRecords(world).filter(
    (q) =>
      unfinished(q) &&
      q.cause?.kind === "help" &&
      q.cause.rootId === state.target?.id,
  )) {
    const hand = q.program.steps[0];
    if (hand.passage?.actor !== actor) continue;
    for (const helper of q.participants) {
      if (
        helper === actor ||
        world.actors[helper]?.place !== world.actors[actor].place ||
        !api.present(helper)
      )
        continue;
      rememberRoutes(world, helper, api.initialEdges(helper));
      rememberRoutes(world, helper, api.witnessedEdges(helper));
      rememberRoutes(world, actor, world.routeKnowledge[helper] || []);
      if (roamingHelpMet(world, hand, api)) finish(world, q, helper);
    }
  }
}

// Returns one ordinary legal action. The caller commits it through perform.
export function roamingPlan(world, actor, api) {
  const state = refreshRoamingQuest(world, actor, api);
  if (!state.target || state.lastActedTurn === world.turn) return null;
  state.lastActedTurn = world.turn;
  const here = world.actors[actor].place,
    target = state.target.locationId;
  rememberRoutes(world, actor, api.visibleEdges(here));
  shareRoamingDirections(world, actor, api);
  if (here === target) {
    finish(world, questRecord(world, state.questKey), actor);
    state.blocked = null;
    api.arrive(actor);
    return null;
  }
  const openPath = knownRoute(
    world,
    actor,
    here,
    target,
    (from, to, previous) => api.exits(from, actor, previous).includes(to),
  );
  const path = openPath || knownRoute(world, actor, here, target);
  if (!path) {
    requestHelp(world, actor, state, here, target, "directions", api);
    return null;
  }
  const action = api
    .actions(actor)
    .find((a) => a.kind === "move" && a.target === path[1]);
  if (!action) {
    requestHelp(world, actor, state, here, path[1], "passage", api);
    return null;
  }
  state.blocked = null;
  return action;
}
export function settleRoamingArrival(world, actor, api) {
  const state = world.roamingQuests?.[actor];
  if (state?.target?.locationId === world.actors[actor].place) {
    finish(world, questRecord(world, state.questKey), actor);
    state.blocked = null;
    api.arrive(actor);
  }
}

export function validRoamingQuests(world, actors, places, edges) {
  if (!world.roamingQuests || !world.routeKnowledge) return false;
  const allowed = new Set(edges.map(edgeKey));
  const whole = (n, max) => Number.isSafeInteger(n) && n >= 0 && n <= max;
  if (
    Object.entries(world.routeKnowledge).some(
      ([actor, known]) =>
        !world.actors[actor] ||
        !Array.isArray(known) ||
        known.length > allowed.size ||
        new Set(known.map(edgeKey)).size !== known.length ||
        known.some(
          (edge) =>
            !Array.isArray(edge) ||
            edge.length !== 2 ||
            !allowed.has(edgeKey(edge)),
        ),
    )
  )
    return false;
  if (
    Object.keys(world.roamingQuests).sort().join() !== [...actors].sort().join()
  )
    return false;
  return actors.every((actor) => {
    const s = world.roamingQuests[actor];
    return (
      s &&
      whole(s.afterSeq, (world.questCompletions?.next || 1) - 1) &&
      Number.isSafeInteger(s.lastActedTurn) &&
      s.lastActedTurn >= -1 &&
      s.lastActedTurn <= world.turn &&
      Array.isArray(s.history) &&
      s.history.length <= JOURNEY_HISTORY_LIMIT &&
      s.history.every(
        (h) =>
          typeof h.key === "string" &&
          typeof h.name === "string" &&
          familyKinds.includes(h.cause?.kind) &&
          whole(h.createdTurn, world.turn) &&
          (h.completedTurn === null || whole(h.completedTurn, world.turn)) &&
          (h.retiredTurn === null || whole(h.retiredTurn, world.turn)),
      ) &&
      (s.target === null
        ? s.questKey === null && s.afterSeq === 0
        : s.target.seq === s.afterSeq &&
          places.includes(s.target.locationId) &&
          (s.questKey === null ||
            questRecord(world, s.questKey)?.cause?.rootId === s.target.id)) &&
      (s.blocked === null ||
        (["directions", "passage"].includes(s.blocked.kind) &&
          places.includes(s.blocked.from) &&
          places.includes(s.blocked.to) &&
          (s.blocked.questKey === null ||
            questRecord(world, s.blocked.questKey)?.cause?.kind === "help")))
    );
  });
}
