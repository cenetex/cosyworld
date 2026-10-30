// What each avatar has lived through: shared experiences, keepsakes given to
// it, and company it promised to keep. No rule here names an avatar, item or
// place. The avatar's want lives in want.mjs.
import { profiles } from "./memory.mjs";

export const LIFE_VERSION = 3;
// A conversation promises a few turns of company.
export const COMPANY_TURNS = 3;
const EXPERIENCE_LIMIT = 16;
const experienceKinds = ["help", "gift", "journey", "care", "talk", "trade"];

export const lifeOf = (s, actor) => s.life?.actors?.[actor];
const rootOwner = (s, item) => {
  let holder = s.items[item]?.holder;
  const seen = new Set([item]);
  while (s.items[holder] && !seen.has(holder)) {
    seen.add(holder);
    holder = s.items[holder].holder;
  }
  return holder;
};
export function nameIn(s, id) {
  return (
    s.actors?.[id]?.name ||
    s.items?.[id]?.name ||
    s.places?.[id]?.name ||
    profiles[id]?.name ||
    (typeof id === "string" ? id[0].toUpperCase() + id.slice(1) : "someone")
  );
}
// "The keeper" reads as "the keeper" inside a sentence.
const inline = (s, id) => nameIn(s, id).replace(/^The /, "the ");
const capital = (text) => text[0].toUpperCase() + text.slice(1);

const newLife = () => ({ experiences: [], attachments: {}, company: {} });
// Avatars who travel keep a life record; pack residents who keep to their
// scene hold no keepsakes, so their stories stay open.
export function installLife(s, include = () => true) {
  if (s.life?.version !== LIFE_VERSION)
    s.life = { version: LIFE_VERSION, actors: {} };
  for (const id of Object.keys(s.actors))
    if (include(id)) s.life.actors[id] ??= newLife();
}
// Earlier lives kept hopes, rest phases and quest collections. Only what was
// lived through carries over.
export function migrateLife(s) {
  const old = s.life;
  if (!old || old.version === LIFE_VERSION) return;
  s.life = { version: LIFE_VERSION, actors: {} };
  for (const [id, life] of Object.entries(old.actors || {})) {
    if (!s.actors[id]) continue;
    s.life.actors[id] = {
      experiences: (life.experiences || [])
        .filter((e) => experienceKinds.includes(e?.kind))
        .map(({ kind, turn, other, item, place }) => ({
          kind,
          turn,
          // Early saves left empty fields out.
          other: other ?? null,
          item: item ?? null,
          place: place ?? null,
        })),
      attachments: life.attachments || {},
      company: life.company || {},
    };
  }
}

export function keepReason(s, actor, item) {
  const attachment = lifeOf(s, actor)?.attachments[item];
  if (!attachment || rootOwner(s, item) !== actor) return null;
  return `A gift from ${nameIn(s, attachment.from)}, kept since turn ${attachment.turn}.`;
}
export const attachmentValue = (s, actor, item) =>
  keepReason(s, actor, item) ? 4 : 0;
export function stayingWith(s, actor) {
  const life = lifeOf(s, actor);
  if (!life) return null;
  return (
    Object.keys(life.company).find(
      (other) =>
        life.company[other] >= s.turn &&
        s.actors[other]?.place === s.actors[actor].place &&
        !(s.motives?.grievances[actor] || []).some((g) => g.other === other),
    ) || null
  );
}
// First-person awareness for speech: keepsakes and present company.
export function lifeFacts(s, actor) {
  const life = lifeOf(s, actor);
  if (!life) return [];
  const company = stayingWith(s, actor);
  return [
    ...Object.keys(s.items)
      .filter((item) => keepReason(s, actor, item))
      .map(
        (item) =>
          `${capital(inline(s, life.attachments[item].from))} gave me this ${nameIn(s, item)}. I'm keeping it.`,
      ),
    ...(company ? [`I'm staying with ${inline(s, company)} for a while.`] : []),
  ];
}

function remember(life, e) {
  const last = life.experiences.at(-1);
  // A repeated exchange refreshes its memory instead of adding another.
  const same =
    last && ["kind", "other", "item", "place"].every((k) => last[k] === e[k]);
  life.experiences = same
    ? [...life.experiences.slice(0, -1), e]
    : [...life.experiences, e].slice(-EXPERIENCE_LIMIT);
}
// Record what happened to each participant. Experiences are memories, not
// points.
export function recordLifeAction(s, a, accepted, usefulGift = false) {
  if (!s.life) return;
  const participant = (id) =>
    lifeOf(s, id) !== undefined &&
    (!s.opening ||
      s.opening.met[id] !== undefined ||
      s.controlledActors?.includes(id));
  const social =
    a.kind === "talk" ||
    (["ask", "accompany", "give", "trade"].includes(a.kind) && accepted);
  if (social && s.actors[a.target])
    for (const [id, other] of [
      [a.actor, a.target],
      [a.target, a.actor],
    ])
      if (participant(id))
        lifeOf(s, id).company[other] = s.turn + COMPANY_TURNS;
  if (a.kind === "give" && accepted && participant(a.target))
    lifeOf(s, a.target).attachments[a.item] = { from: a.actor, turn: s.turn };
  for (const id of Object.keys(s.life.actors))
    for (const item of Object.keys(lifeOf(s, id).attachments))
      if (rootOwner(s, item) !== id) delete lifeOf(s, id).attachments[item];
  const kindFor = (id) => {
    if (a.kind === "give" && usefulGift)
      return id === a.actor ? "help" : "gift";
    if (a.kind === "trade" && accepted) return "trade";
    if (a.kind === "talk") return "talk";
    if (a.kind === "accompany" && accepted) return "journey";
    if (a.kind === "refill") return "care";
    return null;
  };
  const participants = [
    ...new Set([a.actor, ...(social && s.actors[a.target] ? [a.target] : [])]),
  ].filter(participant);
  for (const id of participants) {
    const kind = kindFor(id);
    if (!kind) continue;
    const other = social ? (id === a.actor ? a.target : a.actor) : null;
    const item =
      kind === "care"
        ? s.items[a.target]
          ? a.target
          : a.item
        : a.item || null;
    remember(lifeOf(s, id), {
      kind,
      turn: s.turn,
      other: other || null,
      item: item && s.items[item] ? item : null,
      place: a.destination || s.actors[id].place,
    });
  }
}

export function validExperience(s, e, placeIds = null) {
  const keys = ["kind", "turn", "other", "item", "place"];
  return Boolean(
    e &&
      typeof e === "object" &&
      Object.keys(e).length === keys.length &&
      Object.keys(e).every((k) => keys.includes(k)) &&
      experienceKinds.includes(e.kind) &&
      Number.isSafeInteger(e.turn) &&
      e.turn >= 0 &&
      e.turn <= s.turn &&
      (e.other === null || Object.hasOwn(s.actors || {}, e.other)) &&
      (e.item === null || Object.hasOwn(s.items || {}, e.item)) &&
      (e.place === null ||
        (typeof e.place === "string" &&
          e.place.length > 0 &&
          e.place.length <= 40 &&
          (!placeIds || placeIds.includes(e.place)))),
  );
}

export function validLife(s, placeIds = null) {
  const l = s.life;
  const whole = (n, max) => Number.isSafeInteger(n) && n >= 0 && n <= max;
  const actorIds = Object.keys(s.actors || {});
  const itemIds = Object.keys(s.items || {});
  return (
    l?.version === LIFE_VERSION &&
    l.actors &&
    typeof l.actors === "object" &&
    Object.keys(l.actors).every((id) => actorIds.includes(id)) &&
    Object.entries(l.actors).every(
      ([id, p]) =>
        p &&
        Object.keys(p).length === 3 &&
        p.attachments &&
        Object.entries(p.attachments).every(
          ([item, a]) =>
            itemIds.includes(item) &&
            a &&
            actorIds.includes(a.from) &&
            a.from !== id &&
            whole(a.turn, s.turn),
        ) &&
        p.company &&
        Object.entries(p.company).every(
          ([other, until]) =>
            actorIds.includes(other) &&
            other !== id &&
            whole(until, s.turn + COMPANY_TURNS),
        ) &&
        Array.isArray(p.experiences) &&
        p.experiences.length <= EXPERIENCE_LIMIT &&
        p.experiences.every((e) => validExperience(s, e, placeIds)),
    )
  );
}
