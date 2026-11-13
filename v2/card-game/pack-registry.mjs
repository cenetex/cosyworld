import { recordRecital, recitalVisit, validRecitals } from "./pack-recital.mjs";
import { boardyPack, BOARDY, boardyActive } from "./boardyai.mjs";
import { sectionAllows } from "./pack-sections.mjs";
import { specialsAllow, validSpecials } from "./pack-specials.mjs";
import {
  journeyNextPlace,
  validJourneyProgress,
  journeyChoiceReady,
  agreeJourney,
  advanceJourney,
} from "./pack-journeys.mjs";
import { newWant, setWant } from "./want.mjs";
import { partyOf } from "./world/company.mjs";
import { usedUp, useUp, bringBack } from "./item-use.mjs";
import { arcanumOpen, isArcanum } from "./world/arcana-record.mjs";
// The compiled world packs mounted on the card table, indexed for the engine.
// Packs supply data only; pack-rules.mjs applies the general rules they name.
import compiled from "./packs.json" with { type: "json" };
import {
  humanHomePack,
  currentActor,
  humanAvatar,
  humanAvatarIds,
  controlledByHuman,
  humanPresent,
  sharedEnabled,
  residentAvatar,
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
    compiled.packs.flatMap((p) => Object.keys(p.items || {})),
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
          compiled.packs.flatMap((p) => Object.keys(p.items || {})),
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
const waitsAtHome = new Set(
  packDefinitions.flatMap((pack) =>
    (pack.choices || []).flatMap((choice) =>
      choice.effects
        .filter((e) => e.kind === "retire_item" && e.waitAtHome)
        .map((e) => e.item),
    ),
  ),
);
// Food and drink (rules 102): a thing tagged food or drink, with a home it
// goes back to once eaten or drunk. Any holder may eat or drink it, alone or
// with someone. One verb, Eat; a drink reads Drink.
export const consumable = (id) =>
  packThings[id]?.home
    ? (["food", "drink"].find((tag) => packThings[id].tags?.includes(tag)) ??
      null)
    : null;
export const isFood = (id) => consumable(id) !== null;
const entities = {
  ...packPlaces,
  ...packPeople,
  ...packThings,
  ...packFixtures,
};
export const packEntity = (id) => (owns(entities, id) ? entities[id] : null);
const waitingAtHome = (world, id) => {
  const item = packEntity(id);
  return (
    waitsAtHome.has(id) &&
    world.items?.[id]?.holder === item.home &&
    packDefinition(item.packId).choices.some(
      (c) =>
        world.packs[item.packId]?.receipts[c.id] !== undefined &&
        c.effects.some((e) => e.item === id && e.waitAtHome),
    )
  );
};
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
export const roamingQuestActor = (id, world = null) =>
  packPeople[id]?.roamingQuest === "latest-completion" &&
  (!world ||
    conditionsMet(world, packPeople[id].packId, packPeople[id].requires));
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
export const recordJourneyTravel = (world, id, from, to) =>
  advanceJourney(world, packOf(id), id, from, to);
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
// The hub's `switchable` groups of packs, in order (pack-toggle.mjs); a pack
// in none is always on. The hub's own content is the pack `hub`.
export const GROUPS = hub.switchable || {};
const groupOf = new Map(
  Object.entries(GROUPS).flatMap(([g, { packs }]) => packs.map((p) => [p, g])),
);
export const packGroup = (packId) => groupOf.get(packId) ?? null;
const hubIds = new Set(
  [...hub.places, ...hub.avatars, ...hub.items].filter(
    (id) => !humanAvatar(id),
  ),
);
export const packIdOf = (id) =>
  packEntity(id)?.packId ?? (hubIds.has(id) ? "hub" : null);
// A group is awake unless it, or the group it is reached by, is off.
export const groupAwake = (off, g) =>
  !off?.includes(g) && !off?.includes(GROUPS[g]?.reachedBy);
export const packOn = (world, packId) =>
  groupAwake(world.disabledPacks, packGroup(packId));
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
// A lock view (boxes, rules 133) asks whether the card is in the world at
// all, leaving out only its own conditions: `requires`, `appearsWhen` and its
// section. What it lets through is never enterable; `entityActive` still
// rules over every exit, play and resident.
function entityLive(world, id, lockView) {
  if (world.items?.[id]) {
    let holder = rootOf(world, id);
    if (
      humanAvatar(holder) &&
      !humanPresent(world, holder) &&
      !residentAvatar(world, holder)
    )
      return false;
    if (holder === BOARDY && !boardyActive(world)) return false;
  }
  if (humanAvatar(id) && !humanPresent(world, id) && !residentAvatar(world, id))
    return false;
  return entityEnabled(world, id, false, lockView);
}
export const entityActive = (world, id) => entityLive(world, id, false);
// The card may lie shut on the table: it exists and is not retired, used up,
// off or unmounted, but its own conditions may not hold yet.
export const entityShown = (world, id) => entityLive(world, id, true);
export function entityEnabled(world, id, saved = false, lockView = false) {
  if (localRoads.has(id) || retiredPlaces.has(id) || usedUp(world, id))
    return false;
  // A pack switched off sleeps where it stands (rules 98, pack-toggle.mjs).
  if (!saved && world.disabledPacks && !packOn(world, packIdOf(id)))
    return false;
  const e = packEntity(id);
  if (!e)
    return (
      !isArcanum(id) ||
      (!lockView &&
        Boolean(world.items?.[id]) &&
        arcanumOpen(world, id) &&
        entityEnabled(world, world.items[id].holder, saved))
    );
  if (
    waitingAtHome(world, id) &&
    !entityEnabled(world, e.home, saved, lockView)
  )
    return false;
  const pack = packDefinition(e.packId),
    state = packState(world, e.packId);
  // A sealed item that latched open (rules 133) no longer asks its `requires`.
  const requires = sealedLatched(world, id, e) ? [] : e.requires;
  if (
    !state ||
    (!lockView &&
      (!conditionsMet(
        world,
        e.packId,
        saved
          ? (requires || []).filter(
              (c) => !["connected_humans", "humans_at"].includes(c.kind),
            )
          : requires,
      ) ||
        (!saved && !conditionsMet(world, e.packId, e.appearsWhen)) ||
        !sectionAllows(world, pack, id, conditionsMet))) ||
    // Saved custody of an undrawn special stays as it was.
    (!saved && !specialsAllow(state, pack, id))
  )
    return false;
  if (!pack.release || state.scope === "full") return true;
  if (pack.recital?.actor === id)
    return (
      (roamingQuestActor(id) || !!recitalVisit(world, pack)) &&
      entityEnabled(world, world.actors[id].place, saved, lockView)
    );
  return (
    pack.release.places.includes(id) ||
    pack.release.avatars.includes(id) ||
    pack.release.items.includes(id)
  );
}
// A gate stays open once opened: the first time a pack route's condition
// holds, the world records it in `openedRoutes` and the way stays open for
// everyone, even after the condition lapses. A `live: true` route is a
// toggle that only opens while its condition holds.
const routeKey = (r) => `${r.from}>${r.to}`;
const latching = packDefinitions.flatMap((pack) =>
  (pack.routes || [])
    .filter((r) => r.requires?.length && !r.live)
    .map((route) => ({ pack: pack.id, route })),
);
// A sealed item (rules 133) latches open as a route does, unless its seal is
// `live`: the first time its `requires` hold, `openedRoutes` records
// `item:<id>` and it stays open. A live seal follows its facts.
const itemKey = (id) => `item:${id}`;
const latchingItems = () =>
  Object.entries(packThings)
    .filter(([, thing]) => thing.sealed && !thing.sealed.live)
    .map(([id, thing]) => ({ pack: thing.packId, id, thing }));
const sealedLatched = (world, id, e) =>
  Boolean(
    e.sealed && !e.sealed.live && world.openedRoutes?.includes(itemKey(id)),
  );
const latchKeys = new Set(latching.map(({ route }) => routeKey(route)));
const routeOpen = (world, packId, r) =>
  (!r.live && Boolean(world.openedRoutes?.includes(routeKey(r)))) ||
  conditionsMet(world, packId, r.requires);
// Whether a pack route between two places is open now, latched or live
// (rules 102): a live gate reads its condition as it stands.
export const packRouteOpen = (world, from, to) =>
  packDefinitions.some((pack) =>
    (pack.routes || []).some(
      (r) => r.from === from && r.to === to && routeOpen(world, pack.id, r),
    ),
  );
// Personal entry requirements remain true for each traveller, even when
// the world has latched the physical gate open.
// A traveler's own condition on a way is met by its party: the traveler or
// its companion holding the key, or trusted by the keeper, opens the door for
// both (sticky companions, rules 133).
export const partyMet = (world, pack, conditions, actor) =>
  partyOf(world, actor).some((who) =>
    conditionsMet(world, pack, conditions, who),
  );
export function personalRouteOpen(world, from, to, actor) {
  const routes = packDefinitions.flatMap((pack) =>
    (pack.routes || [])
      .filter((r) => r.from === from && r.to === to)
      .map((route) => ({ pack: pack.id, route })),
  );
  return (
    !routes.some(({ route }) => route.travelerRequires?.length) ||
    routes.some(
      ({ pack, route }) =>
        routeOpen(world, pack, route) &&
        partyMet(world, pack, route.travelerRequires, actor),
    )
  );
}
export function latchRoutes(world) {
  for (const { pack, route } of latching) {
    const key = routeKey(route);
    if (route.live || world.openedRoutes?.includes(key)) continue;
    if (!conditionsMet(world, pack, route.requires)) continue;
    world.openedRoutes = [...(world.openedRoutes || []), key].sort();
  }
  for (const { pack, id, thing } of latchingItems()) {
    const key = itemKey(id);
    if (!world.items?.[id] || world.openedRoutes?.includes(key)) continue;
    if (!conditionsMet(world, pack, thing.requires)) continue;
    world.openedRoutes = [...(world.openedRoutes || []), key].sort();
  }
  return world;
}
// A saved gate the content still authors as a latching route.
const latchesItem = (key) =>
  latchingItems().some(({ id }) => itemKey(id) === key);
export const latchingRoute = (key) => latchKeys.has(key) || latchesItem(key);
export const validOpenedRoutes = (list) =>
  list === undefined ||
  (Array.isArray(list) &&
    list.length > 0 &&
    list.every((key, i) => latchingRoute(key) && (!i || list[i - 1] < key)));
export function packExits(world, place, actor = null) {
  const routes = packDefinitions.flatMap((pack) =>
    (pack.routes || [])
      .filter(
        (r) =>
          r.from === place &&
          routeOpen(world, pack.id, r) &&
          partyMet(
            world,
            pack.id,
            r.travelerRequires,
            actor || currentActor(world),
          ) &&
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
function choiceFeasible(
  world,
  pack,
  choice,
  actor,
  mode = null,
  turn = world.turn,
) {
  const atTurn = turn === world.turn ? world : { ...world, turn };
  const state = packState(world, pack.id);
  if (
    !state ||
    choice.archived ||
    // A repeating give fires again once its output is used up (rules 95).
    (owns(state.receipts, choice.id) && !choice.repeats) ||
    (choice.on ?? null) !== mode ||
    (choice.for !== undefined && choice.for !== actor) ||
    (pack.release &&
      state.scope !== "full" &&
      !pack.release.choices.includes(choice.id)) ||
    // A hold choice follows its item wherever its holder stands.
    (mode !== "hold" && world.actors[actor]?.place !== choice.at) ||
    !entityActive(atTurn, choice.at) ||
    !entityActive(atTurn, choice.subject) ||
    !journeyChoiceReady(world, pack, choice) ||
    !conditionsMet(atTurn, pack.id, choice.requires, actor)
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
        : e.kind === "drop_item"
          ? usedUp(world, e.item)
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
// The things a choice needs its actor to hold, slot by slot: one item, or
// the alternatives of an `any` (rules 95).
export const heldSlots = (requires = []) =>
  requires
    .map((r) =>
      r.kind === "any"
        ? r.conditions.filter((c) => c.kind === "holding" && c.role === "actor")
        : r.kind === "holding" && r.role === "actor"
          ? [r]
          : [],
    )
    .filter((slot) => slot.length)
    .map((slot) => slot.map((r) => r.item));
// Choices marked "on": "give" are the effect of giving their subject the
// item the choice needs the actor to hold. They are never offered as cards.
export function packGiveChoice(world, action) {
  for (const pack of packDefinitions)
    for (const c of pack.choices || [])
      if (
        c.on === "give" &&
        c.subject === action.target &&
        heldSlots(c.requires).some((slot) => slot.includes(action.item)) &&
        choiceFeasible(world, pack, c, action.actor, "give")
      )
        return { packId: pack.id, choiceId: c.id, actor: action.actor };
  return null;
}
// The repeating give through which a resident makes a thing (rules 95).
export const makerChoice = (subject, item) =>
  packDefinitions
    .flatMap((pack) => pack.choices || [])
    .find(
      (c) =>
        c.repeats &&
        c.subject === subject &&
        c.effects.some((e) => e.kind === "drop_item" && e.item === item),
    ) ?? null;
// Choices marked "on": "hold" commit once their item's holder is the
// traveler the choice is for, by any route: a take, a gift, a trade, or an
// item already held before the choice existed. Each runs after a play, so a
// want to hold the item is met first. They are never offered as cards.
export function applyHoldChoices(world) {
  const applied = [];
  for (const pack of packDefinitions)
    for (const c of pack.choices || []) {
      const actor = world.items[c.subject]?.holder;
      if (
        c.on !== "hold" ||
        !world.actors[actor] ||
        !choiceFeasible(world, pack, c, actor, "hold") ||
        Object.values(packState(world, pack.id).receipts).includes(world.turn)
      )
        continue;
      const action = { packId: pack.id, choiceId: c.id, actor };
      applyPackChoice(world, action, { mode: "hold" });
      applied.push({ ...action, item: c.subject, text: choiceText(c, actor) });
    }
  return applied;
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
export const departed = (pack, state, id) =>
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
export function packTalkChoice(world, action, turn = world.turn) {
  if (!controlledByHuman(world, action.actor)) return null;
  for (const pack of packDefinitions)
    for (const c of pack.choices || [])
      if (
        c.on === "talk" &&
        c.subject === action.target &&
        choiceFeasible(world, pack, c, action.actor, "talk", turn)
      )
        return { packId: pack.id, choiceId: c.id, actor: action.actor };
  return null;
}
export function applyPackChoice(
  world,
  action,
  { mode = null, placeIds = [], turn = world.turn } = {},
) {
  const pack = packDefinition(action.packId),
    choice = pack?.choices?.find((c) => c.id === action.choiceId);
  if (!choice || !choiceFeasible(world, pack, choice, action.actor, mode, turn))
    throw new Error("That choice is no longer available.");
  const state = packState(world, pack.id);
  const note = (id) => {
    world.items[id].history.push(
      choiceText(choice, action.actor).slice(0, 400),
    );
    world.items[id].history = world.items[id].history.slice(-12);
  };
  for (const e of choice.effects) {
    // A retired item is used up: it leaves play and waits, unseen, at its
    // authored holder until it regrows or a choice drops it again.
    // An alternative a set slot did not use stays where it is. Only the
    // actor's own things or things lying at the place are used, never what
    // another person holds (rules 98).
    // Rules 102: a homed thing that neither regrows nor is made again goes
    // straight back to its home, ready to fetch, as eaten food does; while
    // its home is out of this world's reach, back where it started.
    if (e.kind === "retire_item") {
      const root = rootOf(world, e.item),
        thing = pack.items[e.item];
      if (root === action.actor || root === choice.at) {
        useUp(world, e.item, thing.holder);
        if (thing.home && !thing.regrow && !thing.locked) {
          bringBack(
            world,
            e.item,
            e.waitAtHome || entityActive(world, thing.home)
              ? thing.home
              : thing.holder,
          );
          if (!e.waitAtHome && !entityEnabled(world, e.item))
            useUp(world, e.item, thing.holder);
        }
      }
    }
    // The subject sets a used-up thing down at the choice's place.
    if (e.kind === "drop_item") {
      bringBack(world, e.item, choice.at);
      note(e.item);
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
      // The one who hid it wants it back, and says so in Talk; the traveler
      // is handed nothing (#2605).
      if (world.actors[choice.subject])
        setWant(
          world.actors[choice.subject],
          newWant("item", e.item, world.turn),
        );
    }
    // A cosmetic upgrade is one-way: it joins the traveler's set and stays.
    if (e.kind === "upgrade") {
      const traveler = world.actors[action.actor];
      traveler.upgrades = [
        ...new Set([...(traveler.upgrades || []), e.upgrade]),
      ].sort();
    }
    // A meeting raises the subject's trust in the traveler, never lowers it.
    if (e.kind === "trust") {
      const trust = world.actors[choice.subject]?.trust;
      if (trust)
        trust[action.actor] = Math.max(
          trust[action.actor] || 0,
          Math.min(3, e.level),
        );
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
  agreeJourney(world, pack, choice.id);
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
          (c.at === id && c.on !== "hold") ||
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
    // A hold choice happens wherever its holder stands, not at its `at`.
    .filter((c) => c.at === location && c.on !== "hold" && !canon.includes(c))
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
    !validJourneyProgress(world, packDefinitions) ||
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
                (c) => !["connected_humans", "humans_at"].includes(c.kind),
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
        !(waitingAtHome(world, id) && world.items[id].history.length === 0) &&
        (world.items[id]?.holder !== item.holder ||
          (world.items[id]?.history?.length !== 0 &&
            !restGated(item.requires, id)))
      )
        return false;
  }
  return true;
}
