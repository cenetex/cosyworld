import { learningFacts } from "./learning.mjs";
import { knowledgeDisclosures, knowledgeFacts } from "./knowledge.mjs";
import { expressionKind, validExpression } from "./expression.mjs";
import { wantFact, wantHeard } from "./want-talk.mjs";
import { BOARDY, boardyFacts } from "./boardyai.mjs";
import { recitalContext, recitalFacts } from "./pack-recital.mjs";
import { hasMotives, motiveFacts, tastes } from "./motives.mjs";
import { sceneChanges } from "./scene.mjs";
import { locationWeather } from "./weather.mjs";
import { locationDaylight } from "./daylight.mjs";
import { profiles, validInnerLife } from "./memory.mjs";
import { ruleDream } from "./dreams.mjs";
import {
  entityActive,
  packEntity,
  packDefinitions,
  packFacts,
  packNarration,
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
  things,
  publishKnowledgeSpeech,
  laneTalkFacts,
  REFUSED_VERBS,
} from "./world.mjs";
import { knownActors, wantOf } from "./want.mjs";
import { hasTemperament, variantOf, signalEcho } from "./pack-rules.mjs";

// A refusal reaches the brief as its committed code; the refuser's line
// says why in its own words.
function refusalFact(played) {
  const asked =
    played.verb === "ask"
      ? `request for ${nameOf(played.itemId)}`
      : played.verb === "accompany"
        ? `invitation to ${nameOf(played.destinationId)}`
        : `offer of ${nameOf(played.itemId)}`;
  return `${nameOf(played.targetId)} refused ${nameOf(played.actorId)}'s ${asked} (refusal: ${played.reason || "wants-something-else"}). Nothing changed. Say why in your own words.`;
}

// A player driven off in a standoff this turn came to here. One short line
// keeps tiny models on the committed result.
function defeatArrival(world, location) {
  const actor = currentActor(world);
  const moved = world.log.findLast(
    (e) =>
      e.turn === world.turn &&
      !e.generated &&
      e.actorId === actor &&
      e.locationId === location &&
      e.fromLocationId &&
      e.fromLocationId !== location &&
      (["retreat", "sent-home"].includes(e.verb) ||
        (!e.verb && /after yielding to/u.test(e.text || ""))),
  );
  const blow =
    moved &&
    world.log.findLast(
      (e) =>
        e.turn === world.turn &&
        e.verb === "attack" &&
        e.targetId === actor &&
        e.seq < moved.seq,
    );
  return blow
    ? `${nameOf(actor)} was beaten by ${nameOf(blow.actorId)} and came to at ${nameOf(location)}. Say one line.`
    : null;
}

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
  // A want met by this play reaches the scene as an outcome of the card.
  const wantMet =
    played &&
    events.find(
      (entry) => entry.verb === "want_met" && entry.actorId === played.actorId,
    )?.wantMet;
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
      ...(wantMet ? { wantMet: structuredClone(wantMet) } : {}),
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

// The log is long; a Wait is recorded among this turn's newest entries.
function waitedThisTurn(world) {
  const actor = currentActor(world);
  for (let i = world.log.length - 1; i >= 0; i--) {
    const entry = world.log[i];
    if (entry.turn !== world.turn) return false;
    if (entry.verb === "wait" && entry.actorId === actor) return true;
  }
  return false;
}

export function narrativeContext(world, action = null) {
  const location = world.actors[currentActor(world)].place;
  // Earlier opening text could include the authored solution. Keep those lines
  // in the save while grounding this unrevealed scene in observations.
  const beforeFirstLight = Boolean(
    world.opening?.version === 1 && !world.locations.attic.anchored,
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
  // After a defeat only one voice speaks: a resident here, or else the avatar.
  const defeated = defeatArrival(world, location);
  const host =
    defeated &&
    present.find((id) => id !== currentActor(world) && awake(id));
  // Vale responds to every play. Other travellers keep their movement order.
  const speakers = defeated
    ? [host || currentActor(world)]
    : [
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
  const disclosures = knowledgeDisclosures(
    world,
    speakers,
    ids,
    location,
    played?.seq,
  );
  const events = world.log
    .filter(
      (entry) =>
        entry.turn === world.turn &&
        !entry.generated &&
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
    // Only the avatar who chose to wait turns inward this turn.
    resting:
      speakers[0] === currentActor(world) &&
      (played ? played.verb === "wait" : waitedThisTurn(world))
        ? currentActor(world)
        : null,
    ...(disclosures.length ? { disclosures } : {}),
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
      // A want reaches the player through Talk: one first-person line for
      // the player and for whoever is in this Talk. Narration only.
      const want =
        kind === "avatar" && wantHeard(world, played, id, currentActor(world))
          ? wantFact(world, id, nameOf)
          : null;
      const facts = [
        ...(want ? [want] : []),
        ...knowledgeFacts(
          world,
          id,
          nameOf,
          disclosures.filter((d) => d.speaker === id).map((d) => d.factId),
        ),
        ...(id === BOARDY ? boardyFacts(world, nameOf) : []),
        ...recitalFacts(world, packDefinitions, id),
        ...(kind === "avatar" ? laneTalkFacts(world, id) : []),
        ...learningFacts(world, id, nameOf),
        ...[...packFacts(world, id), ...continuity]
          .filter((fact, index, all) => all.indexOf(fact) === index)
          .slice(-4),
        ...(kind === "location" ? packNarration(world, id) : []),
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
          REFUSED_VERBS.includes(played?.verb) &&
          played.accepted === false &&
          [played.actorId, played.targetId].includes(id)
        )
          facts.unshift(refusalFact(played));
        else if (
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
        if (defeated && id === speakers[0]) facts.unshift(defeated);
        else if (movement)
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
        const want = wantHeard(world, played, id, currentActor(world))
          ? wantOf(world, id)
          : null;
        desire = {
          items: want?.kind === "item" ? [want.target] : [],
          location: want?.kind === "place" ? want.target : null,
          avatars:
            want?.kind === "person" && known.includes(want.target)
              ? [want.target]
              : [],
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
        if (things[id]?.refuels)
          facts.push(
            `Full. Held with an empty ${nameOf(things[id].refuels)}, it fills it and returns to ${nameOf(things[id].returnsTo)}.`,
          );
        if (id === "bell")
          facts.push(
            `${item.ringing ? "Ringing" : "Silent"}; ${covered(world, id) ? "covered" : "uncovered"}.`,
          );
        if (id === "cloth") facts.push(`Touches: ${nameOf(item.holder)}.`);
      } else {
        if (places[id]) facts.push(placeText(world, id));
        const weather = locationWeather(world, id);
        if (weather) facts.push(`Weather: ${weather.condition}.`);
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
          ? {
              inner_life: world.memories[id].innerLife || null,
              hope: null,
            }
          : {}),
      };
    }),
  };
}

// Thoughts come only to the avatar who waited, after something new happened
// to them. Dreams are rarer: two thoughts must settle since the last one.
// The server's reflection_due applies the thought gate. The rules make the
// dream itself (dreams.mjs), so a model never writes one.
export const THOUGHT_GAP = 6;
export const DREAM_GAP = 24;
export const THOUGHTS_PER_DREAM = 2;
export function reflectionDue(context, id, life) {
  const thoughts = life?.thoughts || [];
  const dreams = life?.dreams || [];
  const last = thoughts.at(-1)?.turn;
  const changed = context.entities
    .find((e) => e.id === id)
    ?.memories.some(
      (m) => m.kind === "event" && (last === undefined || m.turn > last),
    );
  const thought = Boolean(
    context.resting === id &&
      context.turn > 0 &&
      changed &&
      (last === undefined || context.turn >= last + THOUGHT_GAP),
  );
  const dreamt = dreams.at(-1)?.turn;
  const settled = thoughts.filter(
    (m) => dreamt === undefined || m.turn > dreamt,
  ).length;
  return {
    thought,
    dream:
      thought &&
      settled >= THOUGHTS_PER_DREAM &&
      (dreamt === undefined || context.turn >= dreamt + DREAM_GAP),
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
  const due = reflectionDue(context, entry.id, previous);
  if (!due.thought) return false;
  const r = entry.reflection;
  if (
    !r ||
    Object.keys(r).some(
      (key) =>
        !["thought", "persona", "models", "evidence"].includes(key),
    )
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
          !["thought", "persona"].includes(k) ||
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
      dreams: [],
    },
    world.turn,
  );
}

export function applyGeneratedReflections(world, context, response) {
  if (
    world.revision !== context.revision ||
    world.turn !== context.turn ||
    response?.revision !== context.revision
  )
    return null;
  const entries = response.reflections;
  if (
    !Array.isArray(entries) ||
    entries.length > context.entities.length ||
    new Set(entries.map((entry) => entry?.id)).size !== entries.length ||
    entries.some(
      (entry) =>
        !context.entities.some((entity) => entity.id === entry?.id) ||
        !entry.reflection ||
        !validReflection(entry, world, context),
    )
  )
    throw new Error("The character update needs another try.");
  const next = structuredClone(world);
  for (const entry of entries)
    saveReflection(next, context, entry, entry.model || "local-reflection");
  return validateWorld(next);
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
  const dream = reflectionDue(context, entry.id, previous).dream
    ? ruleDream(context, entry.id, previous)
    : null;
  memory.reflections = [
    ...(memory.reflections || []),
    {
      turn: world.turn,
      previousPersona: previous.persona,
      persona: r.persona,
      thought: r.thought,
      dream,
      sources: reflectionSources(world, context, entry.id),
      models: {
        ...(r.models || { thought: fallbackModel, persona: fallbackModel }),
        ...(dream ? { dream: "rules" } : {}),
      },
    },
  ].slice(-4);
  memory.innerLife = {
    persona: r.persona,
    thoughts: [
      ...previous.thoughts,
      { turn: world.turn, text: r.thought },
    ].slice(-4),
    dreams: dream
      ? [...previous.dreams, { turn: world.turn, text: dream }].slice(-4)
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

export function applyGeneratedText(
  world,
  context,
  response,
  { incremental = false } = {},
) {
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
        !validExpression(profiles[entry.id], entry.text) ||
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
  // Words are written after the play commits, so a speaker who left this turn
  // already stands at the destination. The line belongs to that scene's cast.
  const castAt = (place) =>
    Object.keys(next.actors).filter(
      (id) => entityActive(next, id) && next.actors[id].place === place,
    );
  const cast = castAt(context.location);
  // Descriptions stay on cards; the current place, played item and speakers also
  // become scene beats, with the same cast and item snapshot as other events.
  for (const id of [
    context.scenery === false ? null : context.location,
    context.focus,
    ...context.speakers,
  ].filter((id) => id && !omitted.includes(id))) {
    const movement = changes.find((change) => change.actorId === id);
    const place = movement ? movement.to : context.location;
    if (
      incremental &&
      next.log.some(
        (entry) =>
          entry.generated &&
          entry.turn === next.turn &&
          entry.entityId === id &&
          entry.locationId === place,
      )
    )
      continue;
    const text = next.memories[id].text;
    const avatar = profiles[id].kind === "avatar";
    addLog(next, profiles[id].name, text, {
      kind: avatar ? expressionKind(profiles[id]) : "narration",
      actorId: avatar ? id : null,
      entityId: id,
      generated: true,
      locationId: place,
      cast: place === context.location ? [...cast] : castAt(place),
      ...(movement ? { arrivalFrom: movement.from } : {}),
    });
    publishKnowledgeSpeech(next, next.log.at(-1), context.disclosures || []);
  }
  return validateWorld(next);
}

// A speaker whose words did not come stays visibly quiet with "…". These
// lines are shown, never voiced or saved. A crossing echo replaces the scene.
export const SILENT_TEXT = "…";
export function silentSpeakers(context, response, world) {
  if (
    context.outcome?.card &&
    signalEcho(world, context.location, context.outcome.card)
  )
    return [];
  const entries = response?.entries ?? [];
  return context.speakers.filter(
    (id) =>
      profiles[id]?.kind === "avatar" &&
      !entries.some((entry) => entry?.id === id),
  );
}
export function silentLines(world, ids) {
  const base = world.eventSeq ?? world.log.length;
  return ids
    .filter((id) => world.actors[id] && entityActive(world, id))
    .map((id, index) => {
      const place = world.actors[id].place;
      return {
        seq: base + (index + 1) / 10,
        turn: world.turn,
        speaker: profiles[id].name,
        text: SILENT_TEXT,
        kind: "dialogue",
        actorId: id,
        entityId: id,
        generated: true,
        silent: true,
        locationId: place,
        cast: Object.keys(world.actors).filter(
          (other) =>
            entityActive(world, other) && world.actors[other].place === place,
        ),
      };
    });
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

export async function requestNarrative(
  context,
  signal,
  progress = () => {},
  path = "/card-game/text",
  validatedOnly = false,
) {
  const response = await fetch(path, {
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
          // The service sends a whole validated line followed by a newline.
          const entries = validatedOnly
            ? text
                .split("\n")
                .slice(0, -1)
                .map((line) => JSON.parse(line))
            : partialEntries(text);
          progress(
            entries.filter((entry) => context.speakers.includes(entry.id)),
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
  early = false,
  reflect = null,
  budget = Number(
    globalThis.document?.querySelector('meta[name="cosy-story-budget-ms"]')
      ?.content,
  ) || 30_000,
}) {
  let ticket = 0,
    pending = null,
    failed = null,
    running = false,
    controller,
    reflectionController;
  async function write(context, version, signal) {
    const deadline = Date.now() + Math.max(30_000, Math.min(budget, 1_900_000));
    const published = new Map();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await boundedRequest(
          request,
          context,
          signal,
          (entries) => {
            if (
              version === ticket &&
              getWorld().revision === context.revision
            ) {
              preview({ context, entries });
              if (early && entries.length) {
                for (const entry of entries)
                  if (!published.has(entry.id)) published.set(entry.id, entry);
                const value = {
                  revision: context.revision,
                  model: "card-voices-v1",
                  entries: [...published.values()],
                  omitted: context.entities
                    .filter(({ id }) => !published.has(id))
                    .map(({ id }) => id),
                };
                const next = applyGeneratedText(getWorld(), context, value, {
                  incremental: true,
                });
                if (next) apply(next, { pending: true });
              }
            }
          },
          // The server can take 25 seconds. Keep its response alive inside the
          // shared 30-second budget; retry only with the time still remaining.
          Math.max(0, deadline - Date.now()),
        );
        if (version !== ticket) return;
        if (early)
          response.entries = response.entries.map((entry) =>
            published.has(entry.id)
              ? { ...entry, text: published.get(entry.id).text }
              : entry,
          );
        const next = applyGeneratedText(getWorld(), context, response, {
          incremental: early,
        });
        if (!next)
          throw new Error("The story response did not match this scene.");
        preview(null);
        apply(next, { silent: silentSpeakers(context, response, next) });
        status("ready");
        if (reflect) {
          reflectionController = new AbortController();
          void boundedRequest(
            reflect,
            context,
            reflectionController.signal,
            () => {},
            60_000,
          )
            .then((value) => {
              if (version !== ticket) return;
              const updated = applyGeneratedReflections(
                getWorld(),
                context,
                value,
              );
              if (updated) apply(updated, { reflection: true });
            })
            .catch(() => {});
        }
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
    reflectionController?.abort();
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
    // A reloaded page restores a failed turn, so Retry can ask again.
    resume(action = null) {
      failed = { action, revision: getWorld().revision };
    },
    invalidate() {
      reflectionController?.abort();
      ticket += 1;
      pending = null;
      failed = null;
      controller?.abort();
      preview(null);
      status("ready");
    },
  };
}
