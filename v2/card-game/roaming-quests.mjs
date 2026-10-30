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
  pruneTransientQuestHistory,
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
      rememberRoutes(world, actor, api.visibleEdges(world.actors[actor].place));
    }
  }
}
function archiveFamily(world, actor, state) {
  const rootId = state.target?.id;
  if (!rootId) return;
  for (const q of questRecords(world).filter(
    (q) =>
      familyKinds.includes(q.cause?.kind) &&
      q.cause.rootId === rootId &&
      q.familyActor === actor,
  )) {
    if (unfinished(q)) retireQuest(world, q.key);
    state.history.push({
      key: q.key,
      name: q.program?.name || "A past journey",
      cause: clone(q.cause),
      createdTurn: q.createdTurn,
      completedTurn: q.completedTurn,
      retiredTurn: q.retired?.turn ?? null,
    });
    clearQuestFocus(world, q.key);
  }
  state.history = state.history.slice(-JOURNEY_HISTORY_LIMIT);
  pruneTransientQuestHistory(world, actor);
}
export function refreshRoamingQuest(world, actor, api) {
  const state = world.roamingQuests[actor];
  const latest = latestQuestCompletion(world, { afterSeq: state.afterSeq });
  if (!latest) return state;
  archiveFamily(world, actor, state);
  state.afterSeq = latest.seq;
  state.target = clone(latest);
  state.target.locationId =
    api.canonicalPlace?.(latest.locationId) || latest.locationId;
  state.blocked = null;
  const quest = addQuestRecord(world, {
    holder: { kind: "avatar", id: actor },
    transientActor: actor,
    subjectActor: actor,
    cause: { kind: "journey", rootId: latest.id },
    program: {
      id: `journey:${actor}:${latest.seq}`,
      name: `Visit ${api.nameOf(state.target.locationId)}`,
      purpose: latest.actorId
        ? `Reach the place where ${api.nameOf(latest.actorId)} completed a quest.`
        : "Reach the recorded site of an earlier completed quest.",
      steps: [{ items: [], avatars: [], location: state.target.locationId }],
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
  if (quest.familyActor)
    pruneTransientQuestHistory(world, quest.familyActor, quest.key);
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
      (kind === "directions" || q.program.steps[0].passage.from === from) &&
      q.program.steps[0].passage.to === to &&
      q.program.steps[0].passage.kind === kind,
  );
  const record =
    old ||
    addQuestRecord(world, {
      holder:
        kind === "directions"
          ? { kind: "avatar", id: actor }
          : { kind: "place", id: from },
      cause,
      transientActor: actor,
      program: {
        id: `help:${actor}:${world.quests.next}`,
        name:
          kind === "directions"
            ? `Show the way to ${api.nameOf(to)}`
            : `Open the way to ${api.nameOf(to)}`,
        purpose: `${api.nameOf(actor)} needs ${kind === "directions" ? "directions" : "passage"} from ${api.nameOf(from)}.`,
        steps: [
          {
            items: [],
            avatars: [],
            location: kind === "directions" ? null : from,
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
  let path = openPath || knownRoute(world, actor, here, target);
  if (!path) {
    requestHelp(world, actor, state, here, target, "directions", api);
    const edges = world.routeKnowledge[actor] || [];
    const frontiers = [...new Set(edges.map(([, to]) => to))].filter(
      (to) =>
        to !== here &&
        api.active?.(to) &&
        api.berthOpen?.(to) !== false &&
        !edges.some(([from]) => from === to),
    );
    // An older dormant spawn can leave by an authored open exit. Otherwise
    // explore only the boundary of its known map, one legal step at a time.
    if (api.active && !api.active(here))
      frontiers.push(...api.exits(here, actor));
    path = frontiers
      .map((to) => knownRoute(world, actor, here, to))
      .filter(Boolean)
      .sort(
        (a, b) => a.length - b.length || a.at(-1).localeCompare(b.at(-1)),
      )[0];
    if (!path) return null;
  }
  const action =
    api.actions(actor).find((a) => a.kind === "move" && a.target === path[1]) ||
    api.voyage?.(actor, path[1]);
  if (!action) {
    // Waiting at a port for the ship also calls it one lane closer.
    api.callShip?.(actor, path[1]);
    requestHelp(world, actor, state, here, path[1], "passage", api);
    return null;
  }
  state.blocked = null;
  return action;
}
export function settleRoamingArrival(world, actor, api) {
  rememberRoutes(world, actor, api.visibleEdges(world.actors[actor].place));
  const state = world.roamingQuests?.[actor];
  if (state?.target?.locationId === world.actors[actor].place) {
    for (const q of questRecords(world))
      if (
        q.familyActor === actor &&
        q.cause?.kind === "help" &&
        q.cause.rootId === state.target.id &&
        unfinished(q)
      )
        retireQuest(world, q.key);
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

// A nearby volunteer uses the same Help, Take and Move choices as a player.
// Custody and the existing legal action list decide which help is possible.
export function roamingHelpPlan(world, actor, api) {
  const here = world.actors[actor].place;
  const actions = api.actions(actor);
  for (const q of questRecords(world)) {
    const hand = q.program.steps[q.step],
      help = hand?.passage;
    if (
      !unfinished(q) ||
      q.cause?.kind !== "help" ||
      !help ||
      help.actor === actor
    )
      continue;
    const joined = q.participants.includes(actor);
    if (
      !joined &&
      (q.holder.kind === "avatar"
        ? world.actors[q.holder.id]?.place
        : q.holder.id) !== here
    )
      continue;
    let action = null;
    if (help.kind === "directions") {
      const knowledge = {
        routeKnowledge: {
          [actor]: [
            ...(world.routeKnowledge?.[actor] || []),
            ...api.initialEdges(actor),
            ...api.witnessedEdges(actor),
          ],
        },
      };
      if (!knownRoute(knowledge, actor, help.from, help.to)) continue;
      action = actions.find((a) => a.kind === "wait");
    } else {
      const crossing = api.crossing(help.from, help.to);
      const needed = (crossing?.requires || []).filter(
        (c) => c.kind === "item_near" || c.kind === "holding",
      );
      const item = needed.find((c) => api.itemPlace(c.item) === here)?.item;
      if (!item) continue;
      if (world.items[item].holder !== actor)
        action = actions.find((a) => a.kind === "take" && a.item === item);
      else if (here !== help.from) {
        const path = api.route(here, help.from, actor);
        action = actions.find(
          (a) => a.kind === "move" && a.target === path?.[1],
        );
      } else action = actions.find((a) => a.kind === "wait");
    }
    if (!action) continue;
    if (!joined)
      action = actions.find(
        (a) => a.kind === "join-quest" && a.questKey === q.key,
      );
    if (action) return { action, reason: q.program.purpose };
  }
  return null;
}
