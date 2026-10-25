// Trusted, compiled card-world data. Packs add facts and closed descriptors;
// every action still resolves in the table's one deterministic world/save.
import greekDrama from "./packs/greek-drama.mjs";

const owns = (o, key) => typeof key === "string" && Object.hasOwn(o, key);
const record = (v) => v && typeof v === "object" && !Array.isArray(v);
const idOk = (v) => typeof v === "string" && /^[a-z][a-z0-9-]{0,79}$/.test(v);
const textOk = (v, max = 1200) =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;

export function validatePackDefinition(pack) {
  const fail = () => {
    throw new Error("Invalid card-world pack definition.");
  };
  if (
    !record(pack) ||
    pack.schemaVersion !== 1 ||
    !idOk(pack.id) ||
    !Number.isSafeInteger(pack.revision) ||
    pack.revision < 1 ||
    ![pack.places, pack.avatars, pack.items].every(record) ||
    !Array.isArray(pack.routes) ||
    !Array.isArray(pack.choices)
  )
    fail();
  const all = [
    ...Object.keys(pack.places),
    ...Object.keys(pack.avatars),
    ...Object.keys(pack.items),
  ];
  if (new Set(all).size !== all.length || all.some((id) => !idOk(id))) fail();
  const condition = (c) =>
    record(c) &&
    ((c.kind === "choice" && idOk(c.key) && idOk(c.value)) ||
      (c.kind === "choice_unset" && idOk(c.key)) ||
      (c.kind === "flag" && idOk(c.key) && typeof c.value === "boolean") ||
      (c.kind === "holding" && owns(pack.items, c.item) && idOk(c.actor)) ||
      (c.kind === "item_at" &&
        owns(pack.items, c.item) &&
        owns(pack.places, c.place)) ||
      (c.kind === "met" && owns(pack.avatars, c.actor)));
  const conditions = (cs) =>
    cs === undefined ||
    (Array.isArray(cs) && cs.length <= 12 && cs.every(condition));
  for (const [id, p] of Object.entries(pack.places))
    if (
      !record(p) ||
      !textOk(p.name, 120) ||
      !textOk(p.text) ||
      !Array.isArray(p.exits) ||
      p.exits.some((to) => !owns(pack.places, to)) ||
      !conditions(p.requires)
    )
      fail();
  for (const a of Object.values(pack.avatars))
    if (
      !record(a) ||
      !textOk(a.name, 120) ||
      !textOk(a.text) ||
      !owns(pack.places, a.place) ||
      !conditions(a.requires) ||
      (a.home !== undefined && !owns(pack.places, a.home)) ||
      (a.desire !== undefined &&
        (!record(a.desire) ||
          !conditions(a.desire.requires) ||
          !Array.isArray(a.desire.items) ||
          a.desire.items.length > 3 ||
          a.desire.items.some((id) => !owns(pack.items, id)) ||
          !Array.isArray(a.desire.avatars) ||
          a.desire.avatars.length > 2 ||
          a.desire.avatars.some(
            (id) => !owns(pack.avatars, id) && id !== "vale",
          ) ||
          (a.desire.location !== null &&
            !owns(pack.places, a.desire.location))))
    )
      fail();
  for (const i of Object.values(pack.items))
    if (
      !record(i) ||
      !textOk(i.name, 120) ||
      !textOk(i.text) ||
      (!owns(pack.places, i.holder) && !owns(pack.avatars, i.holder)) ||
      !conditions(i.requires)
    )
      fail();
  for (const r of pack.routes)
    if (
      !record(r) ||
      !idOk(r.from) ||
      !idOk(r.to) ||
      r.from === r.to ||
      !conditions(r.requires)
    )
      fail();
  const choiceIds = new Set();
  for (const c of pack.choices) {
    if (
      !record(c) ||
      !idOk(c.id) ||
      choiceIds.has(c.id) ||
      !all.includes(c.subject) ||
      !owns(pack.places, c.at) ||
      !textOk(c.label, 120) ||
      !textOk(c.text, 600) ||
      !conditions(c.requires) ||
      !Array.isArray(c.effects) ||
      !c.effects.length ||
      c.effects.length > 12
    )
      fail();
    choiceIds.add(c.id);
    for (const e of c.effects)
      if (
        !record(e) ||
        !(
          (e.kind === "choose" && idOk(e.key) && idOk(e.value)) ||
          (e.kind === "set_flag" &&
            idOk(e.key) &&
            typeof e.value === "boolean") ||
          (e.kind === "place_item" &&
            owns(pack.items, e.item) &&
            e.place === c.at)
        )
      )
        fail();
  }
  return pack;
}

export const packDefinitions = [validatePackDefinition(greekDrama)];
const declaredIds = packDefinitions.flatMap((pack) => [
  ...Object.keys(pack.places),
  ...Object.keys(pack.avatars),
  ...Object.keys(pack.items),
]);
if (
  new Set(packDefinitions.map((pack) => pack.id)).size !==
    packDefinitions.length ||
  new Set(declaredIds).size !== declaredIds.length
)
  throw new Error("Card-world packs contain duplicate IDs.");
const merge = (kind) =>
  Object.fromEntries(
    packDefinitions.flatMap((pack) =>
      Object.entries(pack[kind]).map(([id, data]) => [
        id,
        { ...data, packId: pack.id },
      ]),
    ),
  );
export const packPlaces = merge("places");
export const packPeople = merge("avatars");
export const packThings = merge("items");
const entities = { ...packPlaces, ...packPeople, ...packThings };
if (
  Object.keys(entities).length !==
  Object.keys(packPlaces).length +
    Object.keys(packPeople).length +
    Object.keys(packThings).length
)
  throw new Error("Card-world packs contain duplicate entity IDs.");
export const packDefinition = (id) => packDefinitions.find((p) => p.id === id);
export const packEntity = (id) => (owns(entities, id) ? entities[id] : null);
export const isPackActor = (id) => owns(packPeople, id);
export function validatePackLinks(places, actors, items) {
  for (const pack of packDefinitions) {
    for (const [kind, catalog] of [
      ["places", places],
      ["avatars", actors],
      ["items", items],
    ])
      for (const id of Object.keys(pack[kind]))
        if (catalog[id]?.packId !== pack.id)
          throw new Error("A pack entity collides with the host catalog.");
    for (const route of pack.routes)
      if (!owns(places, route.from) || !owns(places, route.to))
        throw new Error("A pack route names a missing location.");
  }
}
export const packProfiles = Object.fromEntries(
  Object.entries(entities).map(([id, e]) => [
    id,
    {
      kind: owns(packPeople, id)
        ? "avatar"
        : owns(packThings, id)
          ? "item"
          : "location",
      name: e.name,
      persona: e.persona || e.text,
      ...(e.voice ? { voice: e.voice } : {}),
    },
  ]),
);
export function packMedia(id, role = null) {
  const e = packEntity(id);
  if (!e) return null;
  return (
    (role === "backdrop"
      ? e.backdrop
      : role === "portrait"
        ? e.portrait
        : e.art) ||
    e.portrait ||
    e.backdrop ||
    e.art ||
    null
  );
}
export const packState = (world, id) => world.packs?.[id];
export function conditionsMet(world, packId, conditions = []) {
  const state = packState(world, packId);
  if (!state) return false;
  return conditions.every((c) => {
    switch (c.kind) {
      case "choice":
        return state.choices[c.key] === c.value;
      case "choice_unset":
        return !owns(state.choices, c.key);
      case "flag":
        return (state.flags[c.key] ?? false) === c.value;
      case "holding":
        return world.items[c.item]?.holder === c.actor;
      case "item_at":
        return world.items[c.item]?.holder === c.place;
      case "met":
        return owns(state.met || {}, c.actor);
      default:
        return false;
    }
  });
}
export function entityActive(world, id) {
  const e = packEntity(id);
  return !e || conditionsMet(world, e.packId, e.requires);
}
export function packExits(world, place, actor = null) {
  const routes = packDefinitions.flatMap((pack) =>
    pack.routes
      .filter(
        (r) =>
          r.from === place &&
          conditionsMet(world, pack.id, r.requires) &&
          (actor === "vale" ||
            (owns(pack.places, r.from) && owns(pack.places, r.to))),
      )
      .map((r) => r.to),
  );
  return routes.filter(
    (to) => entityActive(world, to) && actorCanVisit(actor, to),
  );
}
export function actorCanVisit(actor, place) {
  if (!actor || actor === "vale") return true;
  const a = packPeople[actor],
    destination = packPlaces[place];
  return a ? destination?.packId === a.packId : !destination;
}
function choiceFeasible(world, pack, choice, actor) {
  const state = packState(world, pack.id);
  if (
    !state ||
    owns(state.receipts, choice.id) ||
    world.actors[actor]?.place !== choice.at ||
    !entityActive(world, choice.subject) ||
    !conditionsMet(world, pack.id, choice.requires)
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
  if (actor !== "vale") return [];
  return packDefinitions.flatMap((pack) =>
    pack.choices
      .filter((c) => choiceFeasible(world, pack, c, actor))
      .map((c) => ({
        kind: "choose",
        actor,
        item: null,
        target: c.subject,
        packId: pack.id,
        choiceId: c.id,
        label: c.label,
        text: c.text,
        key: `choose:${actor}:${pack.id}:${c.id}`,
        cards: [c.subject],
      })),
  );
}
export function applyPackChoice(world, action) {
  const pack = packDefinition(action.packId),
    choice = pack?.choices.find((c) => c.id === action.choiceId);
  if (!choice || !choiceFeasible(world, pack, choice, action.actor))
    throw new Error("That choice is no longer available.");
  const state = packState(world, pack.id);
  for (const e of choice.effects) {
    if (e.kind === "choose") state.choices[e.key] = e.value;
    if (e.kind === "set_flag") state.flags[e.key] = e.value;
    if (e.kind === "place_item") {
      world.items[e.item].holder = e.place;
      world.items[e.item].history.push(choice.text.slice(0, 400));
      world.items[e.item].history = world.items[e.item].history.slice(-12);
    }
  }
  state.receipts[choice.id] = world.turn;
  return choice;
}
export function packFacts(world, id) {
  const e = packEntity(id);
  if (!e) return [];
  const pack = packDefinition(e.packId),
    state = packState(world, e.packId);
  if (!state) return [];
  return pack.choices
    .filter(
      (c) =>
        owns(state.receipts, c.id) &&
        (c.subject === id ||
          c.at === id ||
          c.effects.some((effect) => effect.item === id)),
    )
    .sort((a, b) => state.receipts[a.id] - state.receipts[b.id])
    .slice(-3)
    .map((c) => (c.summary || c.text).slice(0, 240));
}
export function packSceneFacts(world, location) {
  const e = packEntity(location);
  if (!e) return [];
  const pack = packDefinition(e.packId),
    state = packState(world, e.packId);
  if (!state) return [];
  const committed = pack.choices.filter((c) => owns(state.receipts, c.id));
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
    ...canon.map((c) => `Established account: ${c.summary || c.text}`),
    ...local.map((c) => c.summary || c.text),
  ].map((text) => text.slice(0, 240));
}
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
    const state = world.packs[pack.id];
    if (
      !record(state) ||
      state.revision !== pack.revision ||
      Object.keys(state).sort().join() !==
        ["revision", "choices", "flags", "receipts", "met"].sort().join() ||
      ![state.choices, state.flags, state.receipts, state.met].every(record) ||
      Object.entries(state.met).some(
        ([id, turn]) =>
          !owns(pack.avatars, id) ||
          !conditionsMet(world, pack.id, pack.avatars[id]?.requires) ||
          (world.opening && world.opening.met?.[id] !== turn) ||
          !Number.isSafeInteger(turn) ||
          turn < 0 ||
          turn > world.turn,
      )
    )
      return false;
    if (
      world.opening &&
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
      const c = pack.choices.find((c) => c.id === id);
      if (
        !c ||
        !Number.isSafeInteger(turn) ||
        turn < 1 ||
        turn > world.turn ||
        seenTurns.has(turn) ||
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
        !entityActive(world, id) &&
        (world.actors[id]?.place !== actor.place ||
          world.actors[id]?.crossed !== 0 ||
          world.actors[id]?.lastTalk !== -9 ||
          owns(state.met, id))
      )
        return false;
    for (const [id, item] of Object.entries(pack.items))
      if (
        !entityActive(world, id) &&
        (world.items[id]?.holder !== item.holder ||
          world.items[id]?.history?.length !== 0)
      )
        return false;
  }
  return true;
}
