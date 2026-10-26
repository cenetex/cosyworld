import {
  humanQuestPrograms,
  humanAvatar,
  humanAvatarIds,
  controlledByHuman,
  sharedEnabled,
} from "./human-cast.mjs";
import forest from "./forest.json" with { type: "json" };
import { hasQuestPrograms, interest } from "./motives.mjs";
import { questActive, lifeOf, personalQuestRank, hopeOf } from "./life.mjs";
import {
  packPeople,
  packOf,
  packThings,
  packPlaces,
  isPackActor,
  entityActive,
  packExits,
  actorCanVisit,
} from "./pack-registry.mjs";
import {
  condition,
  conditionMet,
  questItemAvailable,
  requiredItems,
  situationPrograms,
} from "./situations.mjs";
import { packDiscovered } from "./pack-rules.mjs";
export { condition } from "./situations.mjs";

// Hand parts combine at one moment. Sequences join reusable steps;
// either offers several hands that can complete the same step.
export const hold = (...items) => ({ items });
export const at = (location) => ({ location });
export const withAvatars = (...avatars) => ({ avatars });
export function hand(...parts) {
  const locations = [
    ...new Set(parts.flatMap((p) => (p.location ? [p.location] : []))),
  ];
  if (locations.length > 1) throw new Error("A hand needs one location.");
  return {
    items: [...new Set(parts.flatMap((p) => p.items || []))],
    location: locations[0] || null,
    avatars: [...new Set(parts.flatMap((p) => p.avatars || []))],
    ...(parts.some((p) => p.conditions?.length)
      ? {
          conditions: parts.flatMap((p) => p.conditions || []),
        }
      : {}),
  };
}
export const sequence = (...parts) =>
  structuredClone(
    parts.flatMap((p) =>
      Array.isArray(p) ? sequence(...p) : p.steps ? sequence(...p.steps) : [p],
    ),
  );
export const alternatives = (step) => step?.any || (step ? [step] : []);
export function either(...hands) {
  const any = hands.flatMap(alternatives);
  if (!any.length) throw new Error("Choose at least one target hand.");
  return { any: structuredClone(any) };
}
export const meet = (items, avatar, locations) =>
  either(
    ...locations.map((location) =>
      hand(hold(...items), at(location), withAvatars(avatar)),
    ),
  );
export const carryTo = (items, location) => hand(hold(...items), at(location));

export const questPrograms = { ...forest.questPrograms, ...humanQuestPrograms };
export const openingPrograms = {
  ...forest.openingPrograms,
  ...humanQuestPrograms,
};
// A pack's residents become known once the player has found a way in.
export const knownActors = (s) =>
  [
    ...new Set([
      ...Object.keys(sharedEnabled(s) ? s.actors : s.opening?.met || s.actors),
      ...(s.controlledActors || []),
    ]),
  ].filter(
    (id) =>
      entityActive(s, id) &&
      (!isPackActor(id) || packDiscovered(s, packOf(id).id)),
  );
export const programsFor = (s, actor) =>
  (s.opening ? openingPrograms : questPrograms)[actor] || [];
export const restingHands = {
  ...forest.restingHands,
  ...Object.fromEntries(
    Object.entries(packPeople).map(([id, a]) => [
      id,
      { items: [], location: a.place, avatars: [] },
    ]),
  ),
};
export const newProgress = () => ({ program: 0, step: 0, marks: [] });
export const savedProgramFor = (s, actor) =>
  collectionOf(s, actor)
    ? currentProgram(s, actor, activeRecord(s, actor))
    : rawProgram(s, actor);
export const programFor = (s, actor) =>
  questActive(s, actor) ? savedProgramFor(s, actor) : null;
export const targetsFor = (s, actor) =>
  hasQuestPrograms(s) && !isPackActor(actor)
    ? alternatives(programFor(s, actor)?.steps[s.actors[actor].progress.step])
    : [interest(s, actor)];
const ownerOf = (s, item) => {
  let owner = s.items[item].holder;
  const seen = new Set([item]);
  while (s.items[owner]) {
    if (seen.has(owner)) throw new Error("An item holds itself.");
    seen.add(owner);
    owner = s.items[owner].holder;
  }
  return owner;
};
// Choices use current custody and meetings. Reading a card keeps the save unchanged.
export const desireFor = (s, actor) => {
  const here = s.actors[actor].place;
  const score = (h) =>
    requiredItems(s, actor, h).filter((id) =>
      h.items.includes(id)
        ? !questItemAvailable(s, actor, id)
        : ownerOf(s, id) !== actor,
    ).length *
      20 +
    (h.conditions || []).filter((c) => !conditionMet(s, c)).length * 2 +
    (h.conditions || []).filter(
      (c) =>
        c.kind === "heldBy" &&
        ownerOf(s, c.item) !== c.avatar &&
        Object.keys(s.items).filter((id) => ownerOf(s, id) === c.avatar)
          .length >= 3,
    ).length *
      30 +
    (h.location && h.location !== here ? 3 : 0) +
    h.avatars.filter((id) => s.actors[id].place !== (h.location || here))
      .length *
      5;
  return (
    (!questActive(s, actor) ? [interest(s, actor)] : targetsFor(s, actor))
      .slice()
      .sort((a, b) => score(a) - score(b))[0] || restingHands[actor]
  );
};
export const levelOf = (s, actor) => 1 + s.actors[actor].progress.program;

// Resolve new programs once, at a level boundary, from real custody and paths.
// The resulting hands are plain saved data, so reloads keep the same bargain.
export function generateProgram(
  s,
  actor,
  places,
  things,
  { independent = false, solo = false } = {},
) {
  const progress = s.actors[actor].progress;
  const actors = knownActors(s).filter((id) => !isPackActor(id)),
    ids = Object.keys(s.items).filter((id) => entityActive(s, id));
  const here = s.actors[actor].place;
  const traversed = [here];
  for (let i = 0; i < traversed.length; i++)
    for (const next of [
      ...places[traversed[i]].exits,
      ...packExits(s, traversed[i], actor),
    ])
      if (
        entityActive(s, next) &&
        actorCanVisit(actor, next) &&
        !traversed.includes(next)
      )
        traversed.push(next);
  // Travel through added regions can lead home, but shore programs must not
  // ask a resident to attend a meeting outside that resident's domain.
  const reachable = traversed
    .filter((id) => (sharedEnabled(s) && humanAvatar(actor)) || !packPlaces[id])
    .slice(0, 6);
  const placeOf = (item) =>
    s.actors[ownerOf(s, item)]?.place || ownerOf(s, item);
  const bundle = (item) =>
    ids.filter((id) => id === item || s.items[id].holder === item);
  const needed = (owner, item) =>
    bundle(item).some((id) =>
      requiredItems(s, owner, desireFor(s, owner)).includes(id),
    );
  // A cast member does not build a new goal around keeping something another
  // avatar wants now. It can then trade or give that item, so wants cannot
  // lock each other out. Vale keeps carried items.
  const wantedElsewhere = (item) =>
    !controlledByHuman(s, actor) &&
    actors.some((other) => other !== actor && needed(other, item));
  const held = ids.filter(
    (id) => ownerOf(s, id) === actor && !wantedElsewhere(id),
  );
  const available = (item) => {
    const owner = ownerOf(s, item);
    return (
      (!s.actors[owner] || actors.includes(owner)) &&
      (!independent || !controlledByHuman(s, owner)) &&
      reachable.includes(placeOf(item)) &&
      (!s.actors[owner] || owner === actor || !needed(owner, item))
    );
  };
  // A long stall ends with an errand the actor can finish alone. It keeps only
  // items no one else wants, so its spares become free to give.
  if (solo) {
    const away = reachable.filter((id) => id !== here);
    const destination =
      away[(progress.program + actors.indexOf(actor)) % away.length] || here;
    return {
      id: `generated-${actor}-${progress.program + 1}`,
      name: "An errand alone",
      steps: [carryTo(held.slice(0, 2), destination)],
      generated: {
        turn: s.turn,
        level: levelOf(s, actor),
        item: held[0] ?? null,
        owner: actor,
        partner: null,
        solo: true,
      },
    };
  }
  const rotation = (progress.program + actors.indexOf(actor)) % ids.length;
  const rotated = [...ids.slice(rotation), ...ids.slice(0, rotation)];
  const candidates = rotated.filter((id) => {
    const owner = ownerOf(s, id);
    if (s.items[s.items[id].holder] || !available(id)) return false;
    if (owner === actor && wantedElsewhere(id)) return false;
    if (!independent || !s.actors[owner] || owner === actor) return true;
    const payment = requiredItems(s, owner, desireFor(s, owner)).filter(
      (item) => ownerOf(s, item) !== owner,
    );
    return !payment.length || payment.some(available);
  });
  if (!candidates.length)
    candidates.push(
      ...rotated.filter(
        (id) =>
          (!s.actors[ownerOf(s, id)] || actors.includes(ownerOf(s, id))) &&
          !s.items[s.items[id].holder] &&
          (!independent || !controlledByHuman(s, ownerOf(s, id))) &&
          reachable.includes(placeOf(id)),
      ),
    );
  const recent = progress.recent || [];
  const active = actors
    .filter((id) => id !== actor)
    .map((id) => programFor(s, id))
    .filter(Boolean);
  const score = (item) => {
    const owner = ownerOf(s, item);
    let value = owner === actor ? 0 : s.actors[owner] ? 6 : 4;
    // Bring Vale into new bargains regularly. A stalled cast goal can then
    // choose items held by the cast, leaving the player's response voluntary.
    if (!controlledByHuman(s, actor) && controlledByHuman(s, owner))
      value = progress.program % 3 === 0 ? 10 : -2;
    return (
      value -
      (recent.includes(item) ? 3 : 0) -
      active.filter((p) => p.generated?.item === item).length * 4
    );
  };
  const item = candidates.sort((a, b) => score(b) - score(a))[0];
  if (!item)
    throw new Error("The world needs an available item for a new quest.");
  const owner = ownerOf(s, item);
  const others = actors.filter((id) => id !== actor);
  const partner =
    s.actors[owner] && owner !== actor
      ? owner
      : others[(progress.program + actors.indexOf(actor)) % others.length];
  const payment =
    owner !== actor && s.actors[owner]
      ? requiredItems(s, owner, desireFor(s, owner)).find(
          (id) => ownerOf(s, id) !== owner && id !== item && available(id),
        )
      : null;
  const destinations = reachable.filter((id) => id !== placeOf(item));
  const destination =
    destinations[
      (progress.program + actors.indexOf(actor)) % destinations.length
    ] || here;
  const extra =
    levelOf(s, actor) >= 5
      ? held.find(
          (id) => id !== item && id !== payment && !bundle(item).includes(id),
        )
      : null;
  const finalItems = [
    item,
    ...(extra && new Set([...bundle(item), extra]).size <= 3 ? [extra] : []),
  ];
  const gathering = hand(hold(payment || item));
  const meeting = meet([item], partner, reachable);
  const journey = carryTo(finalItems, destination);
  const base = {
    id: `generated-${actor}-${progress.program + 1}`,
    name: payment
      ? `A trade with ${humanAvatar(partner)?.name || (partner === "moth" ? "Pip" : "the keeper")}`
      : `${things[item].name} journey`,
    steps: sequence(
      gathering,
      ...(progress.program % 2 ? [journey, meeting] : [meeting, journey]),
    ),
    generated: { turn: s.turn, level: levelOf(s, actor), item, owner, partner },
  };
  if (independent || !s.locations) return base;
  const catalog = situationPrograms(s, actor, base, {
    hand,
    hold,
    at,
    withAvatars,
    either,
    reachable,
    available: (id) =>
      (s.life && questItemAvailable(s, actor, id)) ||
      (available(id) && !(ownerOf(s, id) === actor && wantedElsewhere(id))),
    mayGive: (id) => !lifeOf(s, actor)?.attachments[id],
    needed: (id) => requiredItems(s, id, desireFor(s, id)),
    name: (id) =>
      things[id]?.name ||
      places[id]?.name ||
      { vale: "Vale", moth: "Pip", keeper: "the keeper" }[id] ||
      humanAvatar(id)?.name,
  });
  const preferences = {
    vale: ["crossing", "answer", "delivery", "gathering", "bargain"],
    moth: ["delivery", "gathering", "crossing", "answer", "bargain"],
    keeper: ["answer", "delivery", "crossing", "gathering", "bargain"],
  }[actor] || ["delivery", "gathering", "crossing", "answer", "bargain"];
  catalog.push({
    ...base,
    purpose: `Make a bargain for the ${things[item].name}, then choose where to carry it and whom to meet.`,
    generated: { ...base.generated, situation: "bargain" },
  });
  const recentKinds = progress.recentKinds || [];
  const kindOf = (p) => p.generated?.situation || "bargain";
  // Prefer a different purpose from the cast's active programs. Shared items
  // can still connect a delivery, a crossing and a bargain into one story.
  const unseen = catalog.filter((p) => !recentKinds.includes(kindOf(p)));
  const fresh = unseen.length ? unseen : catalog;
  const distinct = fresh.filter(
    (p) => !active.some((other) => kindOf(other) === kindOf(p)),
  );
  const choices = lifeOf(s, actor)
    ? catalog
    : distinct.length
      ? distinct
      : fresh;
  const rank = (p) =>
    personalQuestRank(s, actor, p) +
    preferences.indexOf(kindOf(p)) +
    recentKinds.reduce(
      (n, kind, i) => n + (kind === kindOf(p) ? 5 + i * 2 : 0),
      0,
    ) +
    (recent.includes(p.generated.item) ? 2 : 0);
  const chosen = choices.sort((a, b) => rank(a) - rank(b))[0] || base;
  if (lifeOf(s, actor)) {
    chosen.purpose =
      `${hopeOf(s, actor).title}. ${chosen.purpose || "Take a step toward this hope."}`.slice(
        0,
        240,
      );
  }
  return chosen;
}

const QUEST_LIMIT = 8;
const HISTORY_LIMIT = 24;
const COLLECTION_LIMIT = 4096;
const questKey = (actor, serial) => `${actor}:quest:${serial}`;
const collectionOf = (s, actor) => lifeOf(s, actor)?.collection;
const activeRecord = (s, actor) => {
  const c = collectionOf(s, actor);
  return c?.cards.find((card) => card.key === c.active) || null;
};
const rawProgram = (s, actor) =>
  programsFor(s, actor)[s.actors[actor].progress.program] ||
  s.actors[actor].progress.current ||
  null;
function currentProgram(s, actor, card) {
  if (!card) return null;
  const p = card.program;
  return p.generated
    ? {
        ...p,
        id: `generated-${actor}-${levelOf(s, actor)}`,
        generated: { ...p.generated, level: levelOf(s, actor) },
      }
    : p;
}
export function actorQuests(s, actor) {
  const c = collectionOf(s, actor);
  if (!c) {
    const program = rawProgram(s, actor);
    return program
      ? [
          {
            key: questKey(actor, 0),
            program,
            step: s.actors[actor].progress.step,
            status: questActive(s, actor) ? "active" : "pending",
            origin: lifeOf(s, actor)?.origin || null,
            createdTurn: program.generated?.turn || 0,
            completedTurn: null,
          },
        ]
      : [];
  }
  return [...c.cards, ...(c.archive || [])]
    .map((card) => ({
      ...card,
      status:
        card.completedTurn !== null
          ? "fulfilled"
          : card.key === c.active
            ? "active"
            : "pending",
    }))
    .sort(
      (a, b) =>
        ({ active: 0, pending: 1, fulfilled: 2 })[a.status] -
        { active: 0, pending: 1, fulfilled: 2 }[b.status],
    );
}
export const activeQuestKey = (s, actor) =>
  actorQuests(s, actor).find((q) => q.status === "active")?.key || null;
export function installQuestCollection(s, actor) {
  const life = lifeOf(s, actor);
  if (!life || life.collection) return;
  const program = rawProgram(s, actor);
  const progress = s.actors[actor].progress;
  const completed =
    progress.completedHands ??
    programsFor(s, actor)
      .slice(0, progress.program)
      .reduce((n, p) => n + p.steps.length, 0);
  life.collection = {
    next: 0,
    active: null,
    cards: [],
    archive: [],
    earned: completed + progress.step,
    archivedCompleted: progress.program,
    collectedThrough: s.turn,
  };
  if (program) {
    const card = addQuest(s, actor, program, life.origin || null);
    card.step = progress.step;
    if (life.phase === "active") life.collection.active = card.key;
  }
}
function addQuest(s, actor, program, origin = null) {
  const c = collectionOf(s, actor);
  if (c.cards.filter((q) => q.completedTurn === null).length >= QUEST_LIMIT ||
      c.cards.length + c.archive.length >= COLLECTION_LIMIT) return null;
  const card = {
    key: questKey(actor, c.next++),
    program: structuredClone(program),
    step: 0,
    origin: origin ? structuredClone(origin) : null,
    createdTurn: s.turn,
    completedTurn: null,
  };
  c.cards.push(card);
  return card;
}
export function pursueQuest(s, actor, key) {
  const c = collectionOf(s, actor);
  const card = c?.cards.find((q) => q.key === key && q.completedTurn === null);
  if (!card) return false;
  c.active = key;
  const life = lifeOf(s, actor);
  life.phase = "active";
  life.restLeft = 0;
  life.quiet = 0;
  delete life.restAt;
  if (card.origin) life.origin = structuredClone(card.origin);
  else delete life.origin;
  s.actors[actor].progress.step = card.step;
  s.actors[actor].progress.current = currentProgram(s, actor, card);
  return true;
}
export function recordQuestProgress(s, actor, complete) {
  const c = collectionOf(s, actor),
    card = activeRecord(s, actor);
  if (!card) return;
  card.step = s.actors[actor].progress.step;
  c.earned += 1;
  if (complete) {
    card.completedTurn = s.turn;
    c.active = null;
    const completed = c.cards.filter((q) => q.completedTurn !== null);
    for (const old of completed.slice(
      0,
      Math.max(0, completed.length - HISTORY_LIMIT),
    )) {
      c.cards.splice(c.cards.indexOf(old), 1);
      c.archive.push({
        key: old.key,
        program: {id: old.program.id, name: old.program.name,
          purpose: old.program.purpose || "", steps: [],
          ...(old.program.generated ? {generated: {situation: old.program.generated.situation,
            ...(old.program.generated.solo ? {solo: true} : {})}} : {})},
        totalSteps: old.program.steps.length,
        step: old.step,
        origin: old.origin,
        createdTurn: old.createdTurn,
        completedTurn: old.completedTurn,
      });
    }
  }
}
export function ensureCollectedQuest(s, actor, places, things) {
  const life = lifeOf(s, actor),
    c = collectionOf(s, actor);
  if (!c) return false;
  const p = s.actors[actor].progress;
  if (c.active) return true;
  p.step = 0;
  delete p.current;
  let pending = c.cards.filter((q) => q.completedTurn === null);
  const authored = programsFor(s, actor)[p.program];
  if (authored && !c.cards.some((q) => q.program.id === authored.id))
    addQuest(s, actor, authored);
  pending = c.cards.filter((q) => q.completedTurn === null);
  if (!pending.length && life.phase === "active") {
    const program = generateProgram(structuredClone(s), actor, places, things);
    addQuest(s, actor, program, life.origin || null);
    pending = c.cards.filter((q) => q.completedTurn === null);
  }
  if (life.phase === "active" && pending.length) {
    if (controlledByHuman(s, actor)) {
      life.phase = "seeking";
      delete life.origin;
    } else {
      const rank = (q) => {
        const targets = alternatives(q.program.steps[q.step]);
        return (
          Math.min(
            ...targets.map(
              (h) =>
                (h.location && h.location !== s.actors[actor].place ? 3 : 0) +
                h.items.filter((id) => !questItemAvailable(s, actor, id))
                  .length *
                  4 +
                h.avatars.filter(
                  (id) =>
                    s.actors[id].place !==
                    (h.location || s.actors[actor].place),
                ).length *
                  2,
            ),
          ) +
          personalQuestRank(s, actor, q.program) / 100
        );
      };
      pending.sort(
        (a, b) => rank(a) - rank(b) || a.createdTurn - b.createdTurn,
      );
      pursueQuest(s, actor, pending[0].key);
    }
  }
  return true;
}
export function collectExperienceQuests(s, actor, places, things) {
  const life = lifeOf(s, actor),
    c = collectionOf(s, actor);
  if (!c) return;
  const experiences = life.experiences.filter(
    (e) => e.turn > c.collectedThrough,
  );
  c.collectedThrough = s.turn;
  for (const experience of experiences) {
    if (c.cards.filter((q) => q.completedTurn === null).length >= QUEST_LIMIT)
      break;
    const probe = structuredClone(s);
    lifeOf(probe, actor).origin = experience;
    const program = generateProgram(probe, actor, places, things);
    const signature = JSON.stringify(program.steps);
    if (
      c.cards.some(
        (q) =>
          q.completedTurn === null &&
          JSON.stringify(q.program.steps) === signature,
      )
    )
      continue;
    addQuest(s, actor, program, experience);
  }
}
