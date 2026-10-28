import { learningFacts } from "./learning.mjs";
import { questCarried } from "./quest-hands.mjs";
import { BOARDY, boardyFacts } from "./boardyai.mjs";
import { questRecord } from "./shared-quests.mjs";
import { recitalContext, recitalFacts } from "./pack-recital.mjs";
import { hasMotives, motiveFacts, tastes } from "./motives.mjs";
import { sceneChanges } from "./scene.mjs";
import { locationWeather } from "./weather.mjs";
import { locationDaylight } from "./daylight.mjs";
import { profiles, validInnerLife } from "./memory.mjs";
import {
  entityActive,
  packEntity,
  packDefinitions,
  packFacts,
  packReadings,
  packSceneFacts,
  observableStates,
} from "./pack-registry.mjs";
import {
  currentActor,
  addLog,
  carried,
  itemPlace,
  rootHolder,
  covered,
  exits,
  nameOf,
  validateWorld,
  standoffFor,
  opponentOf,
  placeText,
  places,
} from "./world.mjs";
import { actorQuests, desireFor, knownActors } from "./quests.mjs";
import { hasTemperament, variantOf, signalEcho } from "./pack-rules.mjs";
import {
  conditionMet,
  conditionText,
  questItemAvailable,
} from "./situations.mjs";

// Keep a few lasting encounters beside fresh facts. Speech stays secondary to
// witnessed events. Hidden puzzle bookkeeping is not dialogue material.
export function speechMemories(memory, { expressions = true } = {}) {
  const concrete = (e) =>
    e.kind === "event" &&
    !/completes hand|finds a new purpose:| Level \d/u.test(e.text);
  const recent = memory.events.filter(concrete).slice(-4);
  const lasting = (memory.landmarks || [])
    .filter(concrete)
    .filter((e) => !recent.some((r) => r.seq === e.seq))
    .slice(-2);
  const said = expressions
    ? memory.events.filter((e) => e.kind === "expression").slice(-2)
    : [];
  return [...lasting, ...recent, ...said]
    .sort((a, b) => a.seq - b.seq)
    .map(({ seq, turn, kind, text }) => ({ seq, turn, kind, text }));
}

// Capture the resolved turn separately from wishes and remembered speech.
export function turnOutcome(world) {
  const events = world.log.filter(
    (entry) => entry.turn === world.turn && !entry.generated,
  );
  const played = events.findLast(
    (entry) => entry.kind === "action" && entry.actorId === currentActor(world),
  );
  const quest = played?.questKey && questRecord(world, played.questKey);
  const here = world.actors[currentActor(world)].place;
  const known = knownActors(world);
  // The original table has a small, fixed cast. Packs can contain a whole
  // repertoire: send only local witnesses, the chosen partner and travellers.
  const actorIds = [
    ...new Set([
      currentActor(world),
      played?.targetId,
      ...known.filter((id) => world.actors[id].place === here),
      ...sceneChanges(world).map((change) => change.actorId),
      ...(!packEntity(here) ? known.filter((id) => !packEntity(id)) : []),
    ]),
  ]
    .filter(
      (id) =>
        known.includes(id) &&
        entityActive(world, id) &&
        (id === currentActor(world) ||
          !world.controlledActors?.includes(id) ||
          world.presentActors?.includes(id)),
    )
    .slice(0, 8);
  const relevantItems = [
    ...new Set([
      played?.itemId,
      played?.receiveId,
      ...Object.keys(world.items).filter((id) =>
        actorIds.includes(rootHolder(world, id)),
      ),
      ...Object.keys(world.items).filter((id) => itemPlace(world, id) === here),
      ...(!world.opening && !packEntity(here)
        ? Object.keys(world.items).filter((id) => !packEntity(id))
        : []),
    ]),
  ]
    .filter((id) => world.items[id] && entityActive(world, id))
    .slice(0, 24);
  return {
    card: {
      kind: played?.verb || (world.turn ? "wait" : "arrive"),
      target: played?.targetId || null,
      item: played?.itemId || null,
      receive: played?.receiveId || null,
      destination: played?.destinationId || null,
      accepted: played?.accepted ?? null,
      ...(quest
        ? {
            quest: {
              key: quest.key,
              title: quest.program.name,
              holder: {
                kind: world.actors[played.targetId]
                  ? "avatar"
                  : world.items[played.targetId]
                    ? "item"
                    : "place",
                id: played.targetId,
              },
            },
          }
        : {}),
    },
    avatars: actorIds.map((id) => {
      const actor = world.actors[id];
      const movement = events.findLast(
        (entry) =>
          entry.fromLocationId &&
          entry.fromLocationId !== entry.locationId &&
          entry.locationId === actor.place &&
          (entry.actorId === id ||
            (entry.verb === "accompany" &&
              entry.accepted &&
              entry.targetId === id)),
      );
      const shared = movement?.verb === "accompany" && movement.accepted;
      return {
        id,
        location: actor.place,
        holding: carried(world, id),
        travel: movement
          ? {
              from: movement.fromLocationId,
              to: movement.locationId,
              companions: shared
                ? [movement.actorId, movement.targetId].filter(
                    (other) => other !== id,
                  )
                : [],
            }
          : null,
      };
    }),
    items: relevantItems.map((id) => ({
      id,
      holder: world.items[id].holder,
      location: itemPlace(world, id),
    })),
    observations: observableStates(world, [...actorIds, ...relevantItems]),
  };
}

// One varied turn in each four-turn block, at least three turns apart.
// The turn is the seed: retries, reloads and shared clients keep the same choice.
export function sceneryDue(turn) {
  if (turn === 0) return true;
  if (turn < 4) return false;
  const block = Math.floor(turn / 4);
  let seed = Math.imul(block, 0x45d9f3b);
  seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b);
  const offset = (seed ^ (seed >>> 16)) & 1;
  return turn % 4 === offset;
}

export function narrativeContext(world, action = null) {
  const location = world.actors[currentActor(world)].place;
  // Earlier opening text could include the authored solution. Keep those lines
  // in the save while grounding this unrevealed scene in observations.
  const beforeFirstLight = Boolean(
    world.opening && !world.locations.attic.anchored,
  );
  const known = knownActors(world);
  const present = Object.keys(world.actors).filter(
    (id) =>
      known.includes(id) &&
      entityActive(world, id) &&
      world.actors[id].place === location &&
      (!world.controlledActors?.includes(id) ||
        world.presentActors?.includes(id)),
  );
  const localItems = Object.keys(world.items).filter(
    (id) => entityActive(world, id) && itemPlace(world, id) === location,
  );
  const changes = sceneChanges(world);
  const departing = changes
    .filter((change) => change.leaving)
    .map((change) => change.actorId);
  const awake = (id) => !hasTemperament(id) || world.actors[id].awake;
  const introductions = present.filter(
    (id) =>
      id !== currentActor(world) &&
      awake(id) &&
      world.opening?.met[id] === world.turn,
  );
  const audience = [...new Set([...present, ...departing])];
  const focus = localItems.includes(action?.item) ? action.item : null;
  const played = world.log.findLast(
    (entry) =>
      entry.turn === world.turn &&
      entry.kind === "action" &&
      entry.actorId === currentActor(world),
  );
  const target = action?.target || played?.targetId;
  const directPartner =
    audience.includes(target) &&
    target !== currentActor(world) &&
    awake(target);
  const partner = directPartner
    ? target
    : introductions[0] ||
      departing[0] ||
      present.find((id) => id !== currentActor(world) && awake(id));
  const movers = changes.map((change) => change.actorId);
  const chosen = new Set(
    [currentActor(world), partner, ...introductions, ...movers].filter(
      (id) => id && awake(id),
    ),
  );
  // Vale responds to every play. Other travellers keep their movement order.
  const speakers = [
    currentActor(world),
    ...[...chosen].filter(
      (id) => id !== currentActor(world) && !movers.includes(id),
    ),
    ...movers.filter((id) => id !== currentActor(world) && chosen.has(id)),
  ].slice(0, 3);
  // Model requests stay bounded as the pack catalog grows. The actual chosen
  // card and every speaker take priority over incidental objects in a room.
  const ids = [
    ...new Set([
      location,
      ...speakers,
      focus,
      target,
      ...audience,
      ...localItems,
    ]),
  ]
    .filter(
      (id) =>
        id &&
        (id === location || audience.includes(id) || localItems.includes(id)),
    )
    .slice(0, 8);
  const events = world.log
    .filter(
      (entry) =>
        entry.turn === world.turn &&
        !entry.generated &&
        entry.kind !== "quest" &&
        !entry.questPlan &&
        (entry.locationId === location ||
          entry.fromLocationId === location ||
          entry.witnesses?.includes(currentActor(world))),
    )
    .slice(-8)
    .map((entry) => entry.text);
  // A persona that minds noise reads a handled bell as a ring unless told
  // otherwise. Name the silence for those speakers when nothing rang.
  const bellHandled =
    localItems.includes("bell") ||
    [played?.itemId, played?.receiveId].includes("bell");
  const bellRang = world.log.some(
    (entry) =>
      entry.turn === world.turn &&
      !entry.generated &&
      entry.verb === "ring" &&
      entry.itemId === "bell",
  );
  const quietFact =
    bellHandled && !bellRang && !world.items.bell.ringing
      ? `The Bell made no sound this turn: it is ${covered(world, "bell") ? "wrapped in the Black cloth and " : ""}silent. Nobody rang it.`
      : null;
  const mindsNoise = (id) => /noise|ringing/i.test(tastes[id]?.sore || "");
  // Authored sounds such as the clock's echo stay in the scene/history, but
  // the speech API's conversation contains only registered avatar voices.
  const conversation = beforeFirstLight
    ? []
    : world.log
        .filter(
          (entry) =>
            entry.generated &&
            entry.kind === "dialogue" &&
            profiles[entry.actorId]?.kind === "avatar" &&
            entry.locationId === location &&
            entry.turn < world.turn,
        )
        .slice(-4)
        .map(({ actorId, text, cast, witnesses }) => ({
          actorId,
          text,
          witnesses: [
            ...new Set([actorId, ...(witnesses || []), ...(cast || [])]),
          ],
        }));
  return {
    revision: world.revision,
    turn: world.turn,
    outcome: turnOutcome(world),
    location,
    scenery: sceneryDue(world.turn),
    focus,
    speakers,
    action:
      played?.text ||
      (world.turn
        ? `${nameOf(currentActor(world))} waits and watches the cast.`
        : null),
    events,
    conversation,
    entities: ids.map((id) => {
      const kind = profiles[id].kind;
      // The place and player retain the route's established history. Another
      // resident knows only their own recorded interactions and memories.
      const continuity =
        kind === "location" || id === currentActor(world)
          ? packSceneFacts(world, location)
          : [];
      const quests = kind === "avatar" ? actorQuests(world, id) : [];
      const activeQuest = quests.find((quest) => quest.status === "active");
      const pendingQuests = quests.filter(
        (quest) =>
          quest.status === "pending" && questCarried(world, id, quest.key),
      );
      const questFacts = [
        ...(activeQuest
          ? [`My active purpose is ${activeQuest.program.name}.`]
          : []),
        ...(pendingQuests.length
          ? [
              `I also want to pursue ${pendingQuests.map((quest) => quest.program.name).join("; ")}.`,
            ]
          : []),
      ];
      const facts = [
        ...(id === BOARDY ? boardyFacts(world, nameOf) : []),
        ...recitalFacts(world, packDefinitions, id),
        ...questFacts,
        ...learningFacts(world, id, nameOf),
        ...[...packFacts(world, id), ...continuity]
          .filter((fact, index, all) => all.indexOf(fact) === index)
          .slice(-4),
      ];
      let desire = null;
      if (kind === "avatar") {
        // A resident's mood is a world fact; its pack words how to play it.
        if (hasTemperament(id)) {
          const state = world.actors[id],
            mood = variantOf(world, id);
          facts.push(
            state.awake
              ? `Awake.${state.wakeCause ? ` First woken by ${state.wakeCause}.` : ""} ${mood.note}`
              : mood.note,
          );
        }
        if (
          played?.verb === "trade" &&
          [played.actorId, played.targetId].includes(id)
        ) {
          const giving =
            id === played.actorId ? played.itemId : played.receiveId;
          const receiving =
            id === played.actorId ? played.receiveId : played.itemId;
          const other =
            id === played.actorId ? played.targetId : played.actorId;
          facts.unshift(
            `Your completed exchange: you gave ${nameOf(giving)} to ${nameOf(other)} and received ${nameOf(receiving)} from them. The item you gained was ${nameOf(receiving)}.`,
          );
        }
        facts.push(
          `Holding: ${carried(world, id).map(nameOf).join(", ") || "empty hands"}.`,
        );
        if (quietFact && mindsNoise(id)) facts.push(quietFact);
        if (
          played?.verb === "accompany" &&
          [played.actorId, played.targetId].includes(id)
        )
          facts.unshift(
            `${nameOf(played.targetId)} ${played.accepted ? "agreed to" : "declined"} ${nameOf(played.actorId)}'s invitation to ${nameOf(played.destinationId)}. This is the recorded answer for this play.`,
          );
        const company = Object.keys(world.actors).filter(
          (other) =>
            other !== id &&
            known.includes(other) &&
            entityActive(world, other) &&
            world.actors[other].place === world.actors[id].place &&
            (!world.controlledActors?.includes(other) ||
              world.presentActors?.includes(other)),
        );
        facts.push(
          `Location now: ${nameOf(world.actors[id].place)}. Company now: ${company.map(nameOf).join(", ") || "alone"}.`,
        );
        const movement = changes.find((change) => change.actorId === id);
        if (movement)
          facts.push(
            movement.leaving
              ? `Leaving ${nameOf(movement.from)} for ${nameOf(movement.to)} now. Say goodbye to ${nameOf(currentActor(world))} and name your destination and reason as you leave.`
              : `Just arrived from ${nameOf(movement.from)}. Greet the people here and explain what brought you.`,
          );
        const conflict = standoffFor(world, id);
        if (conflict)
          facts.push(
            `Standoff with ${nameOf(opponentOf(conflict, id))}${conflict.item ? ` over ${nameOf(conflict.item)}` : ""}: ${conflict.guarding[id] ? "guarding" : "open stance"}. Talk, trade, guard, attack or leave are available.`,
          );
        const target = desireFor(world, id);
        desire = {
          items: target.items,
          location: target.location,
          avatars: target.avatars.filter((other) => known.includes(other)),
        };
        if (hasMotives(world)) {
          const personal = motiveFacts(world, id, 2);
          facts.push(
            ...(world.opening && !world.opening.crossed
              ? personal.slice(0, 1)
              : personal),
          );
        }
        if (world.opening?.met[id] === world.turn && id !== currentActor(world))
          facts.push(
            `This is your first meeting with ${nameOf(currentActor(world))}. You were already here when ${nameOf(currentActor(world))} arrived. Greet this newcomer in your own voice.`,
          );
        for (const c of target.conditions || [])
          facts.push(
            `${conditionMet(world, c) ? "Already true" : "Still hoped for"}: ${conditionText(c, nameOf)}.`,
          );
        const helpers = Object.entries(world.actors[id].trust)
          .filter(([, n]) => n > 0)
          .map(([other]) => nameOf(other));
        if (helpers.length)
          facts.push(
            `Owes a favour to ${helpers.join(" and ")}; willing to share a spare or take a detour with them.`,
          );
        for (const item of desire.items)
          facts.push(
            carried(world, id).includes(item)
              ? `Already holds the wanted ${nameOf(item)}.`
              : questItemAvailable(world, id, item)
                ? `Shared use of ${nameOf(item)} with ${nameOf(rootHolder(world, item))} here satisfies this quest item. Its owner keeps it.`
                : itemPlace(world, item) === world.actors[id].place
                  ? `Wants ${nameOf(item)}, currently with ${nameOf(rootHolder(world, item))}.`
                  : `Wants ${nameOf(item)}.`,
          );
        if (desire.location)
          facts.push(
            `Wants to be at ${nameOf(desire.location)}; currently at ${nameOf(world.actors[id].place)}.`,
          );
        if (desire.avatars.length)
          facts.push(
            `Wants the company of ${desire.avatars.map(nameOf).join(", ")}.`,
          );
      } else if (kind === "item") {
        const item = world.items[id];
        facts.push(`Held by or resting at: ${nameOf(rootHolder(world, id))}.`);
        if (id === "lamp")
          facts.push(
            `${item.fuel === 0 ? "Empty" : item.fuel <= 3 ? "Running low on oil" : "Has oil"}; ${item.lit ? "lit" : "unlit"}; ${covered(world, id) ? "covered" : "uncovered"}.`,
          );
        if (id === "oil")
          facts.push(
            item.doses === 0
              ? "The flask is empty."
              : item.doses === 1
                ? "A little oil remains."
                : "The flask holds oil.",
          );
        if (id === "bell")
          facts.push(
            `${item.ringing ? "Ringing" : "Silent"}; ${covered(world, id) ? "covered" : "uncovered"}.`,
          );
        if (id === "cloth") facts.push(`Touches: ${nameOf(item.holder)}.`);
      } else {
        if (places[id]) facts.push(placeText(world, id));
        const weather = locationWeather(world, id);
        if (weather) facts.push(weather.description);
        const daylight = locationDaylight(world, id);
        if (daylight) facts.push(daylight.description);

        facts.push(
          `Paths visible now: ${exits(world, id, currentActor(world)).map(nameOf).join(", ") || "none"}.`,
        );
        if (
          (id === "attic" || id === "pond") &&
          exits(world, id).includes(id === "attic" ? "pond" : "attic")
        )
          facts.push("An open passage is visible in the reflection.");
        if (id === "pond" && world.locations.pond.answer === "hush")
          facts.push("The wrapped bell rests beside the quiet water.");
        if (id === "pond" && world.locations.pond.answer === "call")
          facts.push(
            "The pond answered the bell with oil. Its shore carries every sound again.",
          );
      }
      facts.push(
        `At the dialogue scene: ${present.map(nameOf).join(", ")}. Items here: ${localItems.map(nameOf).join(", ") || "none"}.`,
      );
      return {
        id,
        ...(packReadings(world, id).length
          ? { readings: packReadings(world, id) }
          : {}),
        poem: recitalContext(world, packDefinitions, id),
        facts: facts.slice(0, 16).map((text) => text.slice(0, 240)),
        desire,
        memories: speechMemories(world.memories[id], {
          expressions: !beforeFirstLight,
        }),
        previous: beforeFirstLight ? null : world.memories[id].text,
        ...(kind === "avatar"
          ? { inner_life: world.memories[id].innerLife || null }
          : {}),
      };
    }),
  };
}

function validReflection(entry, world, context) {
  if (entry.reflection === undefined || entry.reflection === null) return true;
  if (profiles[entry.id]?.kind !== "avatar") return false;
  const previous = world.memories[entry.id].innerLife || {
    persona: null,
    thoughts: [],
    dreams: [],
  };
  const last = previous.thoughts.at(-1)?.turn;
  const changed = context.entities
    .find((e) => e.id === entry.id)
    ?.memories.some(
      (m) => m.kind === "event" && (last === undefined || m.turn > last),
    );
  if (
    !changed ||
    world.turn === 0 ||
    (last !== undefined && world.turn < last + 6)
  )
    return false;
  const r = entry.reflection;
  if (
    !r ||
    Object.keys(r).some(
      (key) =>
        !["thought", "persona", "dream", "models", "evidence"].includes(key),
    )
  )
    return false;
  if (
    r.dream !== undefined &&
    previous.dreams.length &&
    world.turn < previous.dreams.at(-1).turn + 12
  )
    return false;
  const sources = reflectionSources(world, context, entry.id);
  if (
    r.evidence !== undefined &&
    (!Array.isArray(r.evidence) ||
      r.evidence.join() !== sources.map((e) => e.seq).join())
  )
    return false;
  if (
    r.models !== undefined &&
    (!r.models ||
      typeof r.models !== "object" ||
      Array.isArray(r.models) ||
      !["thought", "persona"].every(
        (k) =>
          typeof r.models[k] === "string" &&
          r.models[k].trim() &&
          r.models[k].length <= 160,
      ) ||
      Object.entries(r.models).some(
        ([k, v]) =>
          !["thought", "persona", "dream"].includes(k) ||
          typeof v !== "string" ||
          !v.trim() ||
          v.length > 160,
      ))
  )
    return false;
  return validInnerLife(
    {
      persona: r.persona,
      thoughts: [{ turn: world.turn, text: r.thought }],
      dreams:
        r.dream === undefined ? [] : [{ turn: world.turn, text: r.dream }],
    },
    world.turn,
  );
}

function reflectionSources(world, context, id) {
  const selected = context.entities.find((e) => e.id === id)?.memories || [];
  return selected
    .filter((e) => e.kind === "event")
    .map((e) => {
      const saved = [
        ...world.memories[id].events,
        ...(world.memories[id].landmarks || []),
      ].find((m) =>
        e.seq ? m.seq === e.seq : m.turn === e.turn && m.text === e.text,
      );
      return saved && { seq: saved.seq, turn: saved.turn, text: saved.text };
    })
    .filter(Boolean)
    .sort((a, b) => a.seq - b.seq);
}

function saveReflection(world, context, entry, fallbackModel) {
  const memory = world.memories[entry.id];
  const previous = memory.innerLife || {
    persona: null,
    thoughts: [],
    dreams: [],
  };
  const r = entry.reflection;
  memory.reflections = [
    ...(memory.reflections || []),
    {
      turn: world.turn,
      previousPersona: previous.persona,
      persona: r.persona,
      thought: r.thought,
      dream: r.dream || null,
      sources: reflectionSources(world, context, entry.id),
      models: r.models || {
        thought: fallbackModel,
        persona: fallbackModel,
        ...(r.dream ? { dream: fallbackModel } : {}),
      },
    },
  ].slice(-4);
  memory.innerLife = {
    persona: r.persona,
    thoughts: [
      ...previous.thoughts,
      { turn: world.turn, text: r.thought },
    ].slice(-4),
    dreams: r.dream
      ? [...previous.dreams, { turn: world.turn, text: r.dream }].slice(-4)
      : previous.dreams,
  };
}

// Shared publication checks against the saved world before committing its text.
export function applySharedReflections(world, entries) {
  const context = narrativeContext(world);
  for (const entry of entries || [])
    if (
      world.actors[entry.id] &&
      !context.entities.some((e) => e.id === entry.id)
    )
      context.entities.push({
        id: entry.id,
        memories: speechMemories(world.memories[entry.id]),
      });
  if (
    !Array.isArray(entries) ||
    entries.length > 2 ||
    new Set(entries.map((e) => e.id)).size !== entries.length
  )
    throw new Error("Use the saved scene's character reflections.");
  for (const entry of entries) {
    if (
      !context.entities.some((e) => e.id === entry.id) ||
      !validReflection(entry, world, context)
    )
      throw new Error("Use a reflection grounded in the saved scene.");
  }
  for (const entry of entries)
    if (entry.reflection)
      saveReflection(world, context, entry, entry.model || "card-voices-v1");
}

export function applyGeneratedText(world, context, response) {
  if (
    world.revision !== context.revision ||
    world.turn !== context.turn ||
    response?.revision !== context.revision
  )
    return null;
  const ids = context.entities.map((entity) => entity.id);
  const entries = response.entries;
  const omitted = response.omitted ?? [];
  const spoke = (id) => entries.some((entry) => entry?.id === id);
  if (
    !Array.isArray(entries) ||
    !Array.isArray(omitted) ||
    entries.length + omitted.length !== ids.length ||
    new Set([...entries.map((entry) => entry?.id), ...omitted]).size !==
      ids.length ||
    omitted.some((id) => !ids.includes(id)) ||
    (context.speakers.length > 0 && !context.speakers.some(spoke)) ||
    entries.some(
      (entry) =>
        !ids.includes(entry?.id) ||
        typeof entry.text !== "string" ||
        !entry.text.trim() ||
        entry.text.length > 400 ||
        /[\u0000-\u001f\u007f]/u.test(entry.text) ||
        (entry.model !== undefined &&
          (typeof entry.model !== "string" ||
            !entry.model.trim() ||
            entry.model.length > 160)) ||
        !validReflection(entry, world, context),
    ) ||
    typeof response.model !== "string" ||
    response.model.length > 160
  )
    throw new Error("The story response was incomplete.");
  const next = structuredClone(world);
  for (const entry of entries) {
    if (entry.id === context.location && context.scenery === false) continue;
    Object.assign(next.memories[entry.id], {
      text: entry.text.trim(),
      turn: next.turn,
      model: entry.model || response.model,
    });
    if (entry.reflection)
      saveReflection(next, context, entry, entry.model || response.model);
  }
  // An unfinished crossing signal can get one small reply where it was made.
  const echo =
    context.outcome?.card &&
    signalEcho(next, context.location, context.outcome.card);
  if (echo) {
    if (
      !next.log.some(
        (entry) =>
          entry.turn === next.turn &&
          entry.generated &&
          entry.speaker === echo.speaker,
      )
    )
      addLog(next, echo.speaker, echo.text, {
        kind: "dialogue",
        entityId: context.location,
        generated: true,
        locationId: context.location,
      });
    return validateWorld(next);
  }
  const changes = sceneChanges(next);
  const cast = [
    ...new Set([
      ...Object.keys(next.actors).filter(
        (id) =>
          entityActive(next, id) && next.actors[id].place === context.location,
      ),
      ...changes
        .filter((change) => change.leaving)
        .map((change) => change.actorId),
    ]),
  ];
  // Descriptions stay on cards; the current place, played item and speakers also
  // become scene beats, with the same cast and item snapshot as other events.
  for (const id of [
    context.scenery === false ? null : context.location,
    context.focus,
    ...context.speakers,
  ].filter((id) => id && !omitted.includes(id))) {
    const text = next.memories[id].text;
    const avatar = profiles[id].kind === "avatar";
    const movement = changes.find((change) => change.actorId === id);
    addLog(next, profiles[id].name, text, {
      kind: avatar ? "dialogue" : "narration",
      actorId: avatar ? id : null,
      entityId: id,
      generated: true,
      locationId: context.location,
      cast: [...cast],
      ...(movement?.leaving ? { departureTo: movement.to } : {}),
      ...(movement && !movement.leaving ? { arrivalFrom: movement.from } : {}),
    });
    if (movement?.leaving) cast.splice(cast.indexOf(id), 1);
  }
  return validateWorld(next);
}

// Read complete JSON string units while the model is still writing an entry.
export function partialEntries(source) {
  const entries = [];
  const pattern = /\{\s*"id"\s*:\s*("(?:[^"\\]|\\.)*")\s*,\s*"text"\s*:\s*"/gu;
  for (const match of source.matchAll(pattern)) {
    let raw = "";
    for (let i = match.index + match[0].length; i < source.length; i++) {
      const char = source[i];
      if (char === '"') break;
      if (char === "\\") {
        const length = source[i + 1] === "u" ? 6 : 2;
        if (i + length > source.length) break;
        raw += source.slice(i, i + length);
        i += length - 1;
      } else raw += char;
    }
    try {
      const id = JSON.parse(match[1]);
      const text = JSON.parse('"' + raw + '"').replace(/[\uD800-\uDBFF]$/u, "");
      if (
        profiles[id] &&
        text &&
        text.length <= 400 &&
        !/[\u0000-\u001f\u007f]/u.test(text)
      )
        entries.push({ id, text });
    } catch {
      /* A partial escape will be complete in a later chunk. */
    }
  }
  return entries;
}

export async function requestNarrative(context, signal, progress = () => {}) {
  const response = await fetch("/card-game/text", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(context),
    signal,
  });
  if (!response.ok)
    throw Object.assign(
      new Error(`Story service returned ${response.status}.`),
      {
        retryable: response.status === 429 || response.status >= 500,
      },
    );
  if (!response.headers.get("content-type")?.includes("text/event-stream"))
    return response.json();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    text = "",
    bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error("Story stream ended early.");
      bytes += value.length;
      if (bytes > 256 * 1024)
        throw new Error("Story stream exceeded its limit.");
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(
        /\r\n/g,
        "\n",
      );
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        const event = JSON.parse(data);
        if (event.type === "error")
          throw new Error("Story generation was interrupted.");
        if (event.type === "complete") return event;
        if (event.type === "delta" && typeof event.text === "string") {
          text += event.text;
          if (text.length > 16 * 1024)
            throw new Error("Story text exceeded its limit.");
          progress(
            partialEntries(text).filter((entry) =>
              context.speakers.includes(entry.id),
            ),
          );
        }
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
}

// Bound each transport even when an aborted stream takes time to settle.
async function boundedRequest(request, context, signal, progress, timeout) {
  const timeoutError = new Error("Story request timed out.");
  if (timeout <= 0) throw timeoutError;
  const attempt = new AbortController();
  const abort = () => attempt.abort(signal.reason);
  let timer;
  const stopped = new Promise((_, reject) => {
    attempt.signal.addEventListener(
      "abort",
      () =>
        reject(attempt.signal.reason || new Error("Story request stopped.")),
      { once: true },
    );
    timer = setTimeout(() => attempt.abort(timeoutError), timeout);
  });
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  try {
    return await Promise.race([
      stopped,
      request(context, attempt.signal, (entries) => {
        if (!attempt.signal.aborted) progress(entries);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    attempt.abort();
  }
}
const RETRY_DELAY = 750;
function retryPause(signal) {
  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(signal.reason);
      else resolve();
    };
    const abort = () => finish();
    const timer = setTimeout(finish, RETRY_DELAY);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) finish();
  });
}

// Keep one active scene request and coalesce quick plays to the newest world.
export function createNarrator({
  getWorld,
  apply,
  status,
  started = () => {},
  request = requestNarrative,
  preview = () => {},
  budget = Number(
    globalThis.document?.querySelector('meta[name="cosy-story-budget-ms"]')
      ?.content,
  ) || 30_000,
}) {
  let ticket = 0,
    pending = null,
    failed = null,
    running = false,
    controller;
  async function write(context, version, signal) {
    const deadline = Date.now() + Math.max(30_000, Math.min(budget, 1_900_000));
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await boundedRequest(
          request,
          context,
          signal,
          (entries) => {
            if (version === ticket && getWorld().revision === context.revision)
              preview({ context, entries });
          },
          // The server can take 25 seconds. Keep its response alive inside the
          // shared 30-second budget; retry only with the time still remaining.
          Math.max(0, deadline - Date.now()),
        );
        if (version !== ticket) return;
        const next = applyGeneratedText(getWorld(), context, response);
        if (!next)
          throw new Error("The story response did not match this scene.");
        preview(null);
        apply(next);
        status("ready");
        return;
      } catch (error) {
        if (signal.aborted || version !== ticket) return;
        preview(null);
        if (
          attempt === 1 ||
          error?.retryable === false ||
          deadline - Date.now() <= RETRY_DELAY
        )
          throw error;
        await retryPause(signal);
      }
    }
  }
  async function drain() {
    if (running) return;
    running = true;
    try {
      while (pending) {
        const { action, version } = pending;
        pending = null;
        controller = new AbortController();
        status("pending");
        const revision = getWorld().revision;
        try {
          const context = narrativeContext(getWorld(), action);
          started(context);
          await write(context, version, controller.signal);
        } catch (error) {
          if (version === ticket) {
            preview(null);
            if (revision === getWorld().revision) failed = { action, revision };
            status("retry", error);
          }
        }
      }
    } finally {
      running = false;
    }
  }
  function changed(action = null) {
    failed = null;
    pending = { action, version: ++ticket };
    preview(null);
    controller?.abort();
    void drain();
  }
  return {
    changed,
    retry() {
      if (!failed || failed.revision !== getWorld().revision) return false;
      changed(failed.action);
      return true;
    },
    invalidate() {
      ticket += 1;
      pending = null;
      failed = null;
      controller?.abort();
      preview(null);
      status("ready");
    },
  };
}
