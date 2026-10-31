import { recordRecital, recitalVisit, validRecitals } from "./pack-recital.mjs";
import { boardyPack, BOARDY, boardyActive } from "./boardyai.mjs";
import { sectionAllows } from "./pack-sections.mjs";
import { specialsAllow, validSpecials } from "./pack-specials.mjs";
import { journeyNextPlace, validJourneyPlaces } from "./pack-journeys.mjs";
// The compiled world packs mounted on the card table, indexed for the engine.
// Packs supply data only; pack-rules.mjs applies the general rules they name.
import compiled from "./packs.json" with { type: "json" };
import {
  humanHomePack,
  humanAvatar,
  humanAvatarIds,
  controlledByHuman,
  humanPresent,
  sharedEnabled,
} from "./human-cast.mjs";
import {
  packProblems,
  observationProblems,
  packCompositionProblems,
} from "./pack-schema.mjs";
import { conditionMet as evaluateCondition } from "./pack-rules.mjs";
const owns = (o, key) =>
  typeof key === "string" && !!o && Object.hasOwn(o, key);
const record = (v) => v && typeof v === "object" && !Array.isArray(v);
export function validatePackDefinition(pack) {
  const problems = packProblems(
    pack,
    compiled.hub,
    compiled.packs.flatMap((p) => Object.keys(p.places)),
  );
  if (problems.length)
    throw new Error(
      `Invalid card-world pack definition: ${problems.join("; ")}`,
    );
  return pack;
}

const problems =
  compiled?.schemaVersion === 1 && Array.isArray(compiled.packs)
    ? compiled.packs.flatMap((pack) =>
        packProblems(
          pack,
          compiled.hub,
          compiled.packs.flatMap((p) => Object.keys(p.places)),
        ),
      )
    : ["packs.json needs schemaVersion 1 and a pack list"];
if (problems.length)
  throw new Error(`Invalid card world packs: ${problems.join("; ")}`);

const observations = [
  ...(compiled.hub.observations || []),
  ...compiled.packs.flatMap((pack) => pack.observations || []),
];
if (
  observationProblems(compiled.hub.observations, compiled.hub).length ||
  new Set(observations.map((d) => d.id)).size !== observations.length
)
  throw new Error("Invalid card world observations.");

export function observableStates(world, entityIds, definitions = observations) {
  const visible = new Set(entityIds);
  return definitions
    .filter((d) => visible.has(d.entity))
    .flatMap((d) => {
      const source = d.source;
      const entity =
        source.kind === "actor_flag"
          ? world.actors[d.entity]
          : world.items[d.entity];
      if (!entity) return [];
      const raw = Object.hasOwn(entity, source.field)
        ? entity[source.field]
        : undefined;
      const value =
        source.kind === "covered"
          ? Object.values(world.items).some((item) => item.holder === d.entity)
          : source.kind === "item_positive"
            ? typeof raw === "number"
              ? raw > 0
              : null
            : typeof raw === "boolean"
              ? raw
              : null;
      return value === null ? [] : [{ id: d.id, value }];
    })
    .slice(0, 32);
}

export const hub = compiled.hub;
export const packDefinitions = [
  ...compiled.packs,
  validatePackDefinition(humanHomePack),
  validatePackDefinition(boardyPack),
];
const compositionProblems = packCompositionProblems(packDefinitions);
if (compositionProblems.length)
  throw new Error(
    `Invalid card world composition: ${compositionProblems.join("; ")}`,
  );
const packById = new Map();
for (const p of packDefinitions) if (!packById.has(p.id)) packById.set(p.id, p);
export const packDefinition = (id) => packById.get(id) || null;

const merge = (field) =>
  Object.fromEntries(
    packDefinitions.flatMap((pack) =>
      Object.entries(pack[field] || {}).map(([id, entity]) => [
        id,
        { ...entity, packId: pack.id },
      ]),
    ),
  );
export const packPlaces = merge("places");
// Earlier road IDs remain available to saved history. A road is retired when
// a direct local link joins its two ends, or when the pack marks it retired.
// Saved visits fold into its first end.
const localRoads = new Map(
  Object.entries(packPlaces)
    .filter(
      ([, place]) =>
        place.road &&
        (place.retired === true ||
          place.road.every((end, i) =>
            packPlaces[end]?.exits.includes(place.road[1 - i]),
          )),
    )
    .map(([id, place]) => [id, place.road]),
);
export const localRoadEnds = (id) => localRoads.get(id) || null;
// A retired place that is not a road folds into its one exit, the place that
// took it in.
const retiredPlaces = new Map(
  Object.entries(packPlaces)
    .filter(([, place]) => place.retired === true && !place.road)
    .map(([id, place]) => [id, place.exits[0]]),
);
export const retiredPlace = (id) => retiredPlaces.has(id);
export const canonicalPlace = (id) => {
  const end = localRoadEnds(id)?.[0] || id;
  return retiredPlaces.get(end) || end;
};
export const transports = merge("transports");
export const packPeople = merge("avatars");
export const packFixtures = merge("fixtures");
export const packThings = merge("items");
const entities = {
  ...packPlaces,
  ...packPeople,
  ...packThings,
  ...packFixtures,
};
export const packEntity = (id) => (owns(entities, id) ? entities[id] : null);
export const packMedia = (id, role = null) => {
  const e = packEntity(id),
    file =
      e &&
      (role === "backdrop"
        ? e.backdrop
        : role === "portrait"
          ? e.portrait
          : e.art || e.portrait || e.backdrop);
  return file ? `./${file}` : null;
};
export function validatePackLinks(places, actors, items) {
  for (const pack of packDefinitions)
    for (const [kind, catalog] of [
      ["places", places],
      ["avatars", actors],
      ["items", items],
    ])
      for (const id of Object.keys(pack[kind] || {}))
        if (catalog[id]?.packId !== pack.id)
          throw new Error("A pack entity collides with the host catalog.");
}
export const packActorIds = Object.keys(packPeople);
export const crossings = packDefinitions.flatMap((pack) =>
  pack.crossings.map((c) => ({ ...c, packId: pack.id })),
);

export const isPackActor = (id) =>
  Object.hasOwn(packPeople, id) && !humanAvatar(id);
export const isPackPlace = (id) => Object.hasOwn(packPlaces, id);
export const packOf = (id) => packDefinition(entities[id]?.packId);
export const resident = (id) => packPeople[id] || null;
export const roamingQuestActor = (id) =>
  packPeople[id]?.roamingQuest === "latest-completion";
// A resident who keeps to its scene leaves it once its pack's `stayUntil`
// conditions hold (the Swede, once the Willows kit is back at camp).
export const freed = (world, id) =>
  !!world &&
  Array.isArray(packPeople[id]?.stayUntil) &&
  conditionsMet(world, packPeople[id].packId, packPeople[id].stayUntil, id);
export const staysPut = (id, world = null) =>
  packPeople[id]?.travels === false && !freed(world, id);
export const packJourneyDestination = (world, id) =>
  journeyNextPlace(world, packOf(id), id);
export const avoidsStandoffs = (id) => packPeople[id]?.standoffs === false;
export const fixturesAt = (place) =>
  Object.entries(packFixtures)
    .filter(([, f]) => f.at === place)
    .map(([id, f]) => ({ id, ...f }));

// Profiles for memories and the text route, in the same shape as
// entity-profiles.json. Rust reads the same compiled file.
export const packProfiles = Object.fromEntries([
  ...Object.entries(packThings).map(([id, item]) => [
    id,
    { kind: "item", name: item.name, persona: item.persona },
  ]),
  ...Object.entries(packPlaces).map(([id, p]) => [
    id,
    { kind: "location", name: p.name, persona: p.persona },
  ]),
  ...Object.entries(packPeople).map(([id, a]) => [
    id,
    {
      kind: "avatar",
      name: a.name,
      seed: a.seed,
      ...(a.expression ? { expression: a.expression } : {}),
    },
  ]),
]);

// Interests use the same shape as motives.mjs tastes. How a pack resident
// values the hub's objects is composition data from its bridge.
export const packTastes = Object.fromEntries(
  Object.entries(packPeople).map(([id, a]) => [
    id,
    {
      likes: a.tastes.likes,
      sore: a.tastes.sore,
      home: a.place,
      quests: !!humanAvatar(id) || a.personalQuests === true,
      values: Object.fromEntries(
        [...hub.items, ...Object.keys(packThings)].map((item) => [
          item,
          packDefinition(a.packId).values?.[id]?.[item] ??
            a.values?.[item] ??
            1,
        ]),
      ),
    },
  ]),
);
export const packNames = Object.fromEntries(
  [
    ...Object.entries(packPlaces),
    ...Object.entries(packPeople),
    ...Object.entries(packThings),
  ].map(([id, e]) => [id, e.name]),
);

// Every image a mounted pack shows, as paths relative to the card table.
export const packMediaFiles = [
  ...new Set(
    packDefinitions.flatMap((pack) => [
      ...Object.values(pack.places).flatMap((p) => [
        p.backdrop,
        p.art,
        ...(p.backdrops || []).map((b) => b.backdrop),
      ]),
      ...Object.values(pack.items || {}).map((i) => i.art),
      ...pack.crossings.flatMap((c) => [
        c.scenery?.overlay,
        c.scenery?.backdrop,
        c.scenery?.cardArt,
      ]),
      ...Object.values(pack.avatars).flatMap((a) => [
        a.portrait,
        ...(a.poses || []).map((p) => p.portrait),
        ...Object.values(a.variants || {}).map((v) => v.portrait),
      ]),
    ]),
  ),
].filter(Boolean);

export const packState = (world, id) => world.packs?.[id];
export function conditionsMet(world, packId, conditions = [], actor = null) {
  if (!world.packs?.[packId]) return false;
  for (const condition of conditions)
    if (!evaluateCondition(world, condition, null, packId, actor)) return false;
  return true;
}
export function choiceText(choice, actor) {
  return choice.textTemplate === undefined
    ? choice.text
    : choice.textTemplate.replaceAll(
        "{actor}",
        humanAvatar(actor)?.name ||
          packPeople[actor]?.name ||
          "An earlier traveler",
      );
}

// The item's outermost holder, or the first repeated item when holders loop.
// Short chains, the usual case, are walked without tracking visits.
function rootOf(world, id) {
  let holder = world.items[id].holder;
  for (let step = 0; step < 32 && holder !== id; step++) {
    if (!world.items[holder]) return holder;
    holder = world.items[holder].holder;
  }
  holder = world.items[id].holder;
  const seen = new Set([id]);
  while (world.items[holder] && !seen.has(holder)) {
    seen.add(holder);
    holder = world.items[holder].holder;
  }
  return holder;
}
export function entityActive(world, id) {
  if (world.items?.[id]) {
    let holder = rootOf(world, id);
    if (humanAvatar(holder) && !humanPresent(world, holder)) return false;
    if (holder === BOARDY && !boardyActive(world)) return false;
  }
  if (humanAvatar(id) && !humanPresent(world, id)) return false;
  return entityEnabled(world, id);
}
function entityEnabled(world, id, saved = false) {
  if (localRoads.has(id) || retiredPlaces.has(id)) return false;
  const e = packEntity(id);
  if (!e) return true;
  const pack = packDefinition(e.packId),
    state = packState(world, e.packId);
  if (
    !state ||
    !conditionsMet(
      world,
      e.packId,
      saved
        ? (e.requires || []).filter((c) => c.kind !== "connected_humans")
        : e.requires,
    ) ||
    !sectionAllows(world, pack, id, conditionsMet) ||
    // Saved custody of an undrawn special stays as it was.
    (!saved && !specialsAllow(state, pack, id))
  )
    return false;
  if (!pack.release || state.scope === "full") return true;
  if (pack.recital?.actor === id)
    return (
      (roamingQuestActor(id) || !!recitalVisit(world, pack)) &&
      entityEnabled(world, world.actors[id].place)
    );
  return (
    pack.release.places.includes(id) ||
    pack.release.avatars.includes(id) ||
    pack.release.items.includes(id)
  );
}
export function packExits(world, place, actor = null) {
  const routes = packDefinitions.flatMap((pack) =>
    (pack.routes || [])
      .filter(
        (r) =>
          r.from === place &&
          conditionsMet(world, pack.id, r.requires) &&
          (humanAvatarIds.includes(actor) ||
            roamingQuestActor(actor) ||
            packPeople[actor]?.personalQuests ||
            (owns(pack.places, r.from) && owns(pack.places, r.to))),
      )
      .map((r) => r.to),
  );
  return routes.filter(
    (to) => entityActive(world, to) && actorCanVisit(actor, to, world),
  );
}
export function actorCanVisit(actor, place, world = null) {
  if (actor === BOARDY) return true;
  if (world?.invitedPlaces?.[actor]?.includes(place)) return true;
  if (!actor || humanAvatarIds.includes(actor) || roamingQuestActor(actor))
    return true;
  const a = packPeople[actor],
    destination = packPlaces[place];
  if (a ? destination?.packId === a.packId : !destination) return true;
  const home = a?.packId ?? null,
    target = destination?.packId ?? null;
  if (
    crossings.some(
      (crossing) =>
        crossing.travelers === "any" &&
        (packPlaces[crossing.from]?.packId ?? null) === home &&
        (packPlaces[crossing.to]?.packId ?? null) === target,
    )
  )
    return true;
  return Object.entries(transports).some(([id, t]) => {
    const domains = t.docks.map((dock) => packPlaces[dock]?.packId ?? null);
    return (
      domains.includes(home) &&
      domains.includes(target) &&
      crossings
        .filter((c) => c.transport === id)
        .every((c) => c.travelers === "any")
    );
  });
}
function choiceFeasible(world, pack, choice, actor, mode = null) {
  const state = packState(world, pack.id);
  if (
    !state ||
    owns(state.receipts, choice.id) ||
    (choice.on ?? null) !== mode ||
    (choice.for !== undefined && choice.for !== actor) ||
    (pack.release &&
      state.scope !== "full" &&
      !pack.release.choices.includes(choice.id)) ||
    world.actors[actor]?.place !== choice.at ||
    !entityActive(world, choice.at) ||
    !entityActive(world, choice.subject) ||
    !conditionsMet(world, pack.id, choice.requires, actor)
  )
    return false;
  const subject = choice.subject;
  if (world.actors[subject] && world.actors[subject].place !== choice.at)
    return false;
  if (
    world.items[subject] &&
    ![actor, choice.at].includes(world.items[subject].holder)
  )
    return false;
  return choice.effects.every((e) =>
    e.kind === "choose"
      ? !owns(state.choices, e.key)
      : e.kind === "place_item"
        ? world.items[e.item]?.holder === actor && e.place === choice.at
        : true,
  );
}
export function packChoices(world, actor = "vale") {
  if (!controlledByHuman(world, actor)) return [];
  return packDefinitions.flatMap((pack) =>
    (pack.choices || [])
      .filter((c) => choiceFeasible(world, pack, c, actor))
      .map((c) => ({
        kind: "choose",
        actor,
        item: null,
        target: c.subject,
        packId: pack.id,
        choiceId: c.id,
        label: c.label,
        text: choiceText(c, actor),
        key: `choose:${actor}:${pack.id}:${c.id}`,
        cards: [c.subject],
      })),
  );
}
// A hidden thing can rest in any place the world holds, near or far, except
// the room its finder stands in. The pick is a stable hash of the choice,
// traveler and turn over the sorted places, so each world hides it in its own
// spot and every replay of that world agrees.
function hidingPlace(world, choice, actor, placeIds) {
  const here = world.actors[actor].place;
  const places = placeIds
    .filter((id) => id !== here && entityActive(world, id))
    .sort();
  if (!places.length) return choice.at;
  let hash = 2166136261;
  for (const ch of `${choice.id}:${actor}:${world.turn}`)
    hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  return places[hash % places.length];
}
// Choices marked "on": "meet" are never offered. They apply the first time
// their traveler shares a room with the choice's subject.
export function applyMeetingChoices(world, actor, placeIds) {
  const applied = [];
  for (const pack of packDefinitions)
    for (const c of pack.choices || []) {
      if (c.on !== "meet" || !choiceFeasible(world, pack, c, actor, "meet"))
        continue;
      // Pack receipts keep one choice per turn; a meeting that coincides with
      // another choice waits for the traveler's next play in the room.
      if (
        Object.values(packState(world, pack.id).receipts).includes(world.turn)
      )
        continue;
      applied.push(
        applyPackChoice(
          world,
          { packId: pack.id, choiceId: c.id, actor },
          { mode: "meet", placeIds },
        ),
      );
    }
  return applied;
}
// Choices marked "on": "give" are the effect of giving their subject the
// item the choice needs the actor to hold. They are never offered as cards.
export function packGiveChoice(world, action) {
  for (const pack of packDefinitions)
    for (const c of pack.choices || [])
      if (
        c.on === "give" &&
        c.subject === action.target &&
        c.requires.some(
          (r) =>
            r.kind === "holding" && r.role === "actor" && r.item === action.item,
        ) &&
        choiceFeasible(world, pack, c, action.actor, "give")
      )
        return { packId: pack.id, choiceId: c.id, actor: action.actor };
  return null;
}
// Choices marked "on": "wait" are what a human traveler notices by Waiting
// at their place. One feasible sign commits per Wait; the
// run seed and the signs already seen pick which, so each run has its order.
export function packWaitChoice(world, actor) {
  if (!controlledByHuman(world, actor)) return null;
  const signs = packDefinitions.flatMap((pack) =>
    (pack.choices || [])
      .filter((c) => choiceFeasible(world, pack, c, actor, "wait"))
      .map((c) => ({ packId: pack.id, choiceId: c.id, actor })),
  );
  if (!signs.length) return null;
  const place = world.actors[actor].place,
    seen = Object.keys(packState(world, signs[0].packId).receipts).length;
  let hash = 2166136261;
  for (const ch of `${world.run?.seed ?? 0}:${place}:${seen}`)
    hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  return signs[hash % signs.length];
}
// Choices marked "on": "depart" commit when their subject, a resident, takes
// a way out of the pack from the choice's place; their flag then hides the
// resident through its own requires. It has left the world for good.
function departure(world, actor, to) {
  const pack = packOf(actor);
  if (controlledByHuman(world, actor) || packPlaces[to]?.packId === pack?.id)
    return null;
  const c = (pack?.choices || []).find(
    (c) =>
      c.subject === actor && choiceFeasible(world, pack, c, actor, "depart"),
  );
  return c ? { packId: pack.id, choiceId: c.id, actor } : null;
}
// A resident that left keeps its record, hidden by its own requires.
const departed = (pack, state, id) =>
  (pack.choices || []).some(
    (c) => c.on === "depart" && c.subject === id && owns(state.receipts, c.id),
  );
// One receipt per turn: a departure waits while this turn already has one.
export const departureWaits = (world, actor, to) =>
  !!departure(world, actor, to) &&
  Object.values(packState(world, packOf(actor).id).receipts).includes(
    world.turn,
  );
// What the leaver carried stays behind where it stood.
export function applyDeparture(world, actor, to) {
  const leaving = departure(world, actor, to);
  if (!leaving) return;
  applyPackChoice(world, leaving, { mode: "depart" });
  for (const item of Object.values(world.items))
    if (item.holder === actor) item.holder = world.actors[actor].place;
}
// Choices marked "on": "talk" are the effect of a traveler's Talk with their
// subject. They are never offered as cards.
export function packTalkChoice(world, action) {
  if (!controlledByHuman(world, action.actor)) return null;
  for (const pack of packDefinitions)
    for (const c of pack.choices || [])
      if (
        c.on === "talk" &&
        c.subject === action.target &&
        choiceFeasible(world, pack, c, action.actor, "talk")
      )
        return { packId: pack.id, choiceId: c.id, actor: action.actor };
  return null;
}
export function applyPackChoice(
  world,
  action,
  { mode = null, placeIds = [] } = {},
) {
  const pack = packDefinition(action.packId),
    choice = pack?.choices?.find((c) => c.id === action.choiceId);
  if (!choice || !choiceFeasible(world, pack, choice, action.actor, mode))
    throw new Error("That choice is no longer available.");
  const state = packState(world, pack.id);
  const note = (id) => {
    world.items[id].history.push(
      choiceText(choice, action.actor).slice(0, 400),
    );
    world.items[id].history = world.items[id].history.slice(-12);
  };
  for (const e of choice.effects) {
    // A retired item leaves play. It waits, unseen, at its authored holder.
    if (e.kind === "retire_item") {
      world.items[e.item].holder = pack.items[e.item].holder;
      world.items[e.item].history = [];
    }
    if (e.kind === "give_item") {
      world.items[e.item].holder = action.actor;
      note(e.item);
    }
    if (e.kind === "hide_item") {
      world.items[e.item].holder = hidingPlace(
        world,
        choice,
        action.actor,
        placeIds,
      );
      note(e.item);
      // Whoever lost it wants it back: finding it is their quest.
      world.actors[action.actor].want = {
        kind: "item",
        target: e.item,
        since: world.turn,
        refusals: 0,
      };
    }
    if (e.kind === "choose") state.choices[e.key] = e.value;
    if (e.kind === "set_flag") state.flags[e.key] = e.value;
    if (e.kind === "place_item") {
      world.items[e.item].holder = e.place;
      world.items[e.item].history.push(
        choiceText(choice, action.actor).slice(0, 400),
      );
      world.items[e.item].history = world.items[e.item].history.slice(-12);
    }
  }
  state.receipts[choice.id] = world.turn;
  recordRecital(world, pack, choice.id, action.actor);
  return choice;
}
function committedChoiceText(world, pack, choice) {
  if (choice.summary) return choice.summary;
  const actor =
    world.log?.find(
      (entry) => entry.packId === pack.id && entry.choiceId === choice.id,
    )?.actorId ||
    world.packs[pack.id].recitals?.[choice.id]?.actor ||
    null;
  return choiceText(choice, actor);
}

export function packFacts(world, id) {
  const e = packEntity(id);
  if (!e) return [];
  const pack = packDefinition(e.packId),
    state = packState(world, e.packId);
  if (!state) return [];
  return (pack.choices || [])
    .filter(
      (c) =>
        owns(state.receipts, c.id) &&
        (c.subject === id ||
          c.at === id ||
          c.effects.some((effect) => effect.item === id)),
    )
    .sort((a, b) => state.receipts[a.id] - state.receipts[b.id])
    .slice(-3)
    .map((c) => committedChoiceText(world, pack, c).slice(0, 240));
}
// A place with its own narrator voice hears how many plain discoveries (a
// choice that only records a flag) its pack has seen, so the rules, not the
// model, decide how far its reasons have worn.
export function packNarration(world, id) {
  const e = packEntity(id);
  if (!e) return [];
  const pack = packDefinition(e.packId),
    state = packState(world, e.packId);
  if (!state || pack.places?.[id]?.voice === undefined) return [];
  const count = (pack.choices || []).filter(
    (c) =>
      owns(state.receipts, c.id) &&
      c.effects.every((effect) => effect.kind === "set_flag"),
  ).length;
  return [`Discoveries recorded so far: ${count}.`];
}
export function packSceneFacts(world, location) {
  const e = packEntity(location);
  if (!e) return [];
  const pack = packDefinition(e.packId),
    state = packState(world, e.packId);
  if (!state) return [];
  const committed = (pack.choices || []).filter((c) =>
    owns(state.receipts, c.id),
  );
  const historyKeys = new Set(
    (pack.continuity?.groups || []).map((g) => g.key),
  );
  // The chosen account is world canon, not a new disclosure by an NPC.
  // Keep it even after many inquiries, while local outcomes stay local.
  const canon = committed.filter((c) =>
    c.effects.some(
      (effect) => effect.kind === "choose" && historyKeys.has(effect.key),
    ),
  );
  const local = committed
    .filter((c) => c.at === location && !canon.includes(c))
    .sort((a, b) => state.receipts[a.id] - state.receipts[b.id])
    .slice(-2);
  return [
    ...canon.map(
      (c) => `Established account: ${committedChoiceText(world, pack, c)}`,
    ),
    ...local.map((c) => committedChoiceText(world, pack, c)),
  ].map((text) => text.slice(0, 240));
}
// True when a thing's own conditions name where it rests.
const restGated = (requires = [], id) =>
  requires.some((c) =>
    c.kind === "item_at"
      ? c.item === id
      : restGated(c.conditions || (c.condition ? [c.condition] : []), id),
  );
export function validatePackStates(world) {
  if (
    !record(world.packs) ||
    Object.keys(world.packs).sort().join() !==
      packDefinitions
        .map((p) => p.id)
        .sort()
        .join()
  )
    return false;
  for (const pack of packDefinitions) {
    if (!pack.choices) continue;
    const state = world.packs[pack.id];
    if (
      !record(state) ||
      !validRecitals(world, pack) ||
      !validJourneyPlaces(world, pack) ||
      !validSpecials(world, pack) ||
      state.revision !== pack.revision ||
      !["opening", "full"].includes(state.scope) ||
      Object.keys(state).sort().join() !==
        [
          "revision",
          "sounds",
          "choices",
          "flags",
          "receipts",
          "met",
          "scope",
          ...(pack.recital ? ["recitals"] : []),
          ...(pack.specials && world.run ? ["specials"] : []),
        ]
          .sort()
          .join() ||
      ![state.choices, state.flags, state.receipts, state.met].every(record) ||
      Object.entries(state.met).some(
        ([id, turn]) =>
          !owns(pack.avatars, id) ||
          (!departed(pack, state, id) &&
            !conditionsMet(
              world,
              pack.id,
              (pack.avatars[id]?.requires || []).filter(
                (c) => c.kind !== "connected_humans",
              ),
            )) ||
          (world.opening &&
            !sharedEnabled(world) &&
            world.opening.met?.[id] !== turn) ||
          !Number.isSafeInteger(turn) ||
          turn < 0 ||
          turn > world.turn,
      )
    )
      return false;
    if (
      world.opening &&
      !sharedEnabled(world) &&
      Object.keys(world.opening.met || {}).some(
        (id) => owns(pack.avatars, id) && !owns(state.met, id),
      )
    )
      return false;
    const events = Object.entries(state.receipts).sort((a, b) => a[1] - b[1]);
    const choices = {},
      flags = {},
      seenTurns = new Set();
    const projection = {
      ...world,
      packs: { ...world.packs, [pack.id]: { ...state, choices, flags } },
    };
    // Custody can change after a choice; permanent progression prerequisites
    // can be checked exactly from the ordered receipts without replaying text.
    const progressionMet = (requirements = []) =>
      conditionsMet(
        projection,
        pack.id,
        requirements.filter((c) =>
          ["choice", "choice_unset", "flag"].includes(c.kind),
        ),
      );
    for (const [id, turn] of events) {
      const c = pack.choices?.find((c) => c.id === id);
      if (
        !c ||
        (state.scope === "opening" &&
          pack.release &&
          !pack.release.choices.includes(id)) ||
        !Number.isSafeInteger(turn) ||
        turn < 1 ||
        turn > world.turn ||
        seenTurns.has(turn) ||
        !sectionAllows(projection, pack, c.at, conditionsMet) ||
        !sectionAllows(projection, pack, c.subject, conditionsMet) ||
        !progressionMet(c.requires) ||
        !progressionMet(pack.places[c.at].requires) ||
        !progressionMet(packEntity(c.subject)?.requires) ||
        (c.requires || []).some(
          (condition) =>
            condition.kind === "met" &&
            (!owns(state.met, condition.actor) ||
              state.met[condition.actor] >= turn),
        )
      )
        return false;
      seenTurns.add(turn);
      for (const effect of c.effects) {
        if (effect.kind === "choose") {
          if (owns(choices, effect.key)) return false;
          choices[effect.key] = effect.value;
        }
        if (effect.kind === "set_flag") flags[effect.key] = effect.value;
      }
    }
    const equals = (a, b) =>
      Object.keys(a).length === Object.keys(b).length &&
      Object.entries(a).every(([k, v]) => owns(b, k) && b[k] === v);
    if (!equals(choices, state.choices) || !equals(flags, state.flags))
      return false;
    for (const [id, actor] of Object.entries(pack.avatars))
      if (
        !entityEnabled(world, id, true) &&
        !departed(pack, state, id) &&
        ((world.actors[id]?.place !== actor.place &&
          !actor.previousHomes?.includes(world.actors[id]?.place)) ||
          world.actors[id]?.crossed !== 0 ||
          world.actors[id]?.lastTalk !== -9 ||
          owns(state.met, id))
      )
        return false;
    // Presence-gated things keep their saved place while their humans are away.
    // A thing gated on where it rests may have travelled and come back to
    // that place.
    for (const [id, item] of Object.entries(pack.items || {}))
      if (
        !entityEnabled(world, id, true) &&
        (world.items[id]?.holder !== item.holder ||
          (world.items[id]?.history?.length !== 0 &&
            !restGated(item.requires, id)))
      )
        return false;
  }
  return true;
}
