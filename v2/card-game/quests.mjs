import { hasQuestPrograms, interest } from "./motives.mjs";
import { questActive, lifeOf, personalQuestRank, hopes } from "./life.mjs";
import {
  condition,
  conditionMet,
  requiredItems,
  situationPrograms,
} from "./situations.mjs";
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

export const questPrograms = {
  vale: [
    {
      id: "borrowed-light",
      name: "Borrowed light",
      steps: [
        { items: ["lamp"], location: "station", avatars: ["moth"] },
        { items: ["oil"], location: "attic", avatars: ["keeper"] },
        { items: ["cloth"], location: "pond", avatars: ["moth"] },
      ],
    },
    {
      id: "the-bell-below",
      name: "The bell below",
      steps: [
        { items: ["bell"], location: "pond", avatars: ["keeper"] },
        { items: ["lamp", "bell"], location: "station", avatars: ["moth"] },
      ],
    },
  ],
  moth: [
    {
      id: "a-light-and-a-witness",
      name: "A light and a witness",
      steps: [
        { items: ["lamp"], location: "pond", avatars: ["vale"] },
        { items: ["oil"], location: "attic", avatars: ["keeper"] },
      ],
    },
    {
      id: "a-veil-for-the-eye",
      name: "A veil for the eye",
      steps: [
        { items: ["cloth"], location: "pond", avatars: ["vale"] },
        { items: ["lamp"], location: "station", avatars: ["keeper"] },
      ],
    },
  ],
  keeper: [
    {
      id: "the-quiet-hour",
      name: "The quiet hour",
      steps: [
        { items: ["bell"], location: "attic", avatars: ["vale"] },
        { items: ["cloth"], location: "attic", avatars: ["moth"] },
      ],
    },
    {
      id: "the-hour-below",
      name: "The hour below",
      steps: [
        { items: ["bell"], location: "pond", avatars: ["vale"] },
        { items: ["oil"], location: "station", avatars: ["moth"] },
      ],
    },
  ],
};
// New tables discover the cast through the mirror and the shore. Older saves
// keep their authored programs and the progress earned against those hands.
export const openingPrograms = {
  vale: [
    {
      id: "first-light",
      name: "Light the lamp",
      purpose: "Bring light to the attic.",
      steps: [hand(hold("lamp"), at("attic"), condition("lit", "lamp"))],
    },
    {
      id: "along-the-shore",
      name: "Along the shore",
      purpose:
        "Meet the moth by the water, then carry the lamp along the path to the station.",
      steps: [
        hand(hold("lamp"), at("pond"), withAvatars("moth")),
        hand(hold("lamp"), at("station")),
      ],
    },
  ],
  moth: [
    {
      ...questPrograms.moth[0],
      steps: [
        hand(hold("lamp"), at("pond"), withAvatars("vale")),
        hand(hold("oil"), at("station"), withAvatars("keeper")),
      ],
    },
    questPrograms.moth[1],
  ],
  keeper: [
    {
      ...questPrograms.keeper[0],
      steps: [
        hand(hold("bell"), at("station"), withAvatars("vale")),
        hand(hold("cloth"), at("pond"), withAvatars("moth")),
      ],
    },
    questPrograms.keeper[1],
  ],
};
export const knownActors = (s) =>
  Object.keys(s.opening?.met || s.actors).filter(
    (id) => id !== "badger" || s.steamClock?.discovered,
  );
export const programsFor = (s, actor) =>
  (s.opening ? openingPrograms : questPrograms)[actor] || [];
export const restingHands = {
  badger: { items: [], location: "clearing", avatars: [] },
  vale: { items: [], location: null, avatars: [] },
  moth: { items: [], location: "pond", avatars: [] },
  keeper: { items: [], location: "attic", avatars: [] },
};
export const newProgress = () => ({ program: 0, step: 0, marks: [] });
export const savedProgramFor = (s, actor) =>
  programsFor(s, actor)[s.actors[actor].progress.program] ||
  s.actors[actor].progress.current ||
  null;
export const programFor = (s, actor) =>
  questActive(s, actor) ? savedProgramFor(s, actor) : null;
export const targetsFor = (s, actor) =>
  hasQuestPrograms(s) && actor !== "badger"
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
    requiredItems(s, actor, h).filter((id) => ownerOf(s, id) !== actor).length *
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
  const actors = knownActors(s).filter((id) => id !== "badger"),
    ids = Object.keys(s.items);
  const here = s.actors[actor].place;
  const reachable = [here];
  for (let i = 0; i < reachable.length; i++)
    for (const next of places[reachable[i]].exits)
      if (!reachable.includes(next)) reachable.push(next);
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
    actor !== "vale" &&
    actors.some((other) => other !== actor && needed(other, item));
  const held = ids.filter(
    (id) => ownerOf(s, id) === actor && !wantedElsewhere(id),
  );
  const available = (item) => {
    const owner = ownerOf(s, item);
    return (
      (!s.actors[owner] || actors.includes(owner)) &&
      (!independent || owner !== "vale") &&
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
          (!independent || ownerOf(s, id) !== "vale") &&
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
    if (actor !== "vale" && owner === "vale")
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
      ? `A trade with ${partner === "moth" ? "Pip" : partner === "keeper" ? "the keeper" : "Vale"}`
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
      available(id) && !(ownerOf(s, id) === actor && wantedElsewhere(id)),
    needed: (id) => requiredItems(s, id, desireFor(s, id)),
    name: (id) =>
      things[id]?.name ||
      places[id]?.name ||
      { vale: "Vale", moth: "Pip", keeper: "the keeper" }[id],
  });
  const preferences = {
    vale: ["crossing", "answer", "delivery", "gathering", "bargain"],
    moth: ["delivery", "gathering", "crossing", "answer", "bargain"],
    keeper: ["answer", "delivery", "crossing", "gathering", "bargain"],
  }[actor];
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
  if (lifeOf(s, actor))
    chosen.purpose =
      `${hopes[actor].title}. ${chosen.purpose || "Take a step toward this hope."}`.slice(
        0,
        240,
      );
  return chosen;
}
