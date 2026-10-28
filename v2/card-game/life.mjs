import { questCarried } from "./quest-hands.mjs";
import { collectionCards, focusedQuest } from "./shared-quests.mjs";
// Personal quests grow from shared actions. This state belongs to the save.
// No rule here names an avatar, item or place: hopes come from profile data
// and purposes from recorded experiences, so any generated world gets both.
import { rootOwner, questItemAvailable } from "./situations.mjs";
import { profiles } from "./memory.mjs";
import { humanAvatarIds } from "./human-cast.mjs";
import { isPackActor, packPeople } from "./pack-registry.mjs";

export const LIFE_VERSION = 2;
// Internal pacing. The card shows prose; these numbers stay out of sight.
export const REST_TURNS = 3;
export const STALL_TURNS = 6;
const EXPERIENCE_LIMIT = 16;
const weight = { help: 3, gift: 3, journey: 3, care: 2, talk: 1, trade: 1 };
export const experienceKinds = Object.keys(weight);
// An experience shapes the kind of purpose it seeds.
export const affinity = {
  help: "delivery",
  gift: "delivery",
  talk: "gathering",
  journey: "crossing",
  care: "gathering",
  trade: "bargain",
};
// A hope is a home place, a favourite thing and an ordered set of situations.
const hopeSteps = [["delivery"], ["gathering"], ["answer", "crossing"]];
const situations = new Set(hopeSteps.flat());

export const lifeOf = (s, actor) => s.life?.actors?.[actor];
export const questActive = (s, actor) => {
  const focused = focusedQuest(s, actor);
  return (
    Boolean(
      focused &&
        (focused.mode === "shared" || focused.subjectActor !== actor) &&
        focused.completedTurn === null &&
        !focused.retired,
    ) ||
    ((!isPackActor(actor) || packPeople[actor]?.personalQuests) &&
      (!lifeOf(s, actor) || lifeOf(s, actor).phase === "active"))
  );
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
const possessive = (s, id) => `${inline(s, id)}'s`;
const capital = (text) => text[0].toUpperCase() + text.slice(1);

// Stable across reloads and runtimes: the same id always rotates the same way.
function hash(text) {
  let h = 0;
  for (const c of text) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
  return h;
}
// Build a hope from profile data: { home, values: { item: number } }.
// Missing data falls back to the avatar's place and no favourite.
export function generateHope(s, actor, profile = null) {
  const values = profile?.values || {};
  const item =
    Object.keys(values)
      .filter((id) => s.items?.[id])
      .sort((a, b) => values[b] - values[a] || (a < b ? -1 : 1))[0] || null;
  const shift = (hash(actor) + 2) % hopeSteps.length;
  return {
    place: profile?.home || s.actors[actor].place,
    item,
    steps: hopeSteps.map((_, i) => hopeSteps[(i + shift) % hopeSteps.length]),
  };
}
const hopeText = {
  delivery: {
    title: (p) => `Look after friends at ${p}`,
    wish: (p) => `I want to look after my friends at ${p}.`,
    step: "Bring a friend what they need",
    next: "Next I'd like to bring a friend what they need.",
  },
  gathering: {
    title: (p) => `Make ${p} a place to gather`,
    wish: (p) => `I want ${p} to be a place where we gather.`,
    step: "Gather with company",
    next: "Next I'd like to gather with company.",
  },
  answer: {
    title: (p) => `Keep ${p} calm and safe`,
    wish: (p) => `I want ${p} to feel calm and safe.`,
    step: "Settle a trouble nearby",
    next: "Next I'd like to settle a trouble nearby.",
  },
};
const lead = (step) => hopeText[step[0]];
export function hopeOf(s, actor) {
  const life = lifeOf(s, actor);
  if (!life) return null;
  const place = nameIn(s, life.hope.place);
  return {
    ...life.hope,
    title: lead(life.hope.steps[0]).title(place),
    wish: lead(life.hope.steps[0]).wish(place),
    milestones: life.hope.steps.map((kinds) => ({
      kinds,
      title: lead(kinds).step,
      next: lead(kinds).next,
    })),
  };
}

function newLife(s, actor, profile) {
  return {
    phase: "active",
    finished: 0,
    restLeft: 0,
    quiet: 0,
    experiences: [],
    attachments: {},
    company: {},
    milestones: [],
    hope: generateHope(s, actor, profile),
  };
}
// `profileOf(id)` returns profile data, or `{ quests: false }` for an avatar
// that never takes personal quests.
// A mounted human joins the same save schema as the existing cast.
export function installHumanLife(s, profileOf = () => null) {
  if (!s.life?.actors) return;
  for (const id of [
    ...new Set([
      ...humanAvatarIds,
      ...Object.keys(s.actors).filter((id) => profileOf(id)?.quests === true),
    ]),
  ]) {
    if (!s.actors[id] || s.life.actors[id]) continue;
    s.life.actors[id] =
      s.life.version === 1
        ? {
            phase: "active",
            inspiration: 0,
            restUntil: 0,
            experiences: [],
            attachments: {},
            company: {},
            milestones: [],
          }
        : newLife(s, id, profileOf(id));
  }
}

export function enablePersonalQuests(s, profileOf = () => null) {
  if (s.life === undefined)
    s.life = {
      version: LIFE_VERSION,
      actors: Object.fromEntries(
        Object.keys(s.actors)
          .filter((id) => profileOf(id)?.quests !== false)
          .map((id) => [id, newLife(s, id, profileOf(id))]),
      ),
    };
  return s;
}

// Version 1 kept a visible 0-5 Inspiration score. Its experiences carry over.
// A seeking avatar with points has already been stirred, so its strongest
// experience seeds the next purpose. One with no points starts fresh. A
// resting avatar keeps its remaining rest; away from a sanctuary it heads to
// one at the next round.
export function migrateLife(s, profileOf = () => null) {
  if (s?.life?.version !== 1 || !s.life.actors) return s;
  for (const [id, old] of Object.entries(s.life.actors)) {
    if (!old || typeof old !== "object" || !s.actors?.[id]) continue;
    const restUntil = Number.isSafeInteger(old.restUntil) ? old.restUntil : 0;
    const finished = Math.max(0, restUntil - REST_TURNS);
    let experiences = (Array.isArray(old.experiences) ? old.experiences : [])
      .filter((e) => e && typeof e.key === "string")
      .map((e) => {
        const [, other, pair, place] = e.key.split(":");
        return {
          kind: e.kind,
          turn: e.turn,
          other:
            e.kind === "care" ? null : other && other !== "self" ? other : null,
          item:
            e.kind === "care" && s.items?.[other]
              ? other
              : pair
                ? pair.split("+")[0]
                : null,
          place: place || null,
        };
      });
    if (old.phase === "seeking" && !old.inspiration)
      experiences = experiences.filter((e) => e.turn <= finished);
    s.life.actors[id] = {
      phase: old.phase,
      finished: Math.min(finished, s.turn),
      restLeft:
        old.phase === "content"
          ? Math.max(0, Math.min(REST_TURNS, restUntil - s.turn))
          : 0,
      quiet: 0,
      experiences,
      attachments: old.attachments,
      company: old.company,
      milestones: old.milestones,
      hope: generateHope(s, id, profileOf(id)),
    };
  }
  s.life.version = LIFE_VERSION;
  return s;
}

// The most meaningful experience since the last quest ended, earliest first.
export function sparkOf(s, actor) {
  const life = lifeOf(s, actor);
  if (!life || life.phase === "active") return null;
  return (
    life.experiences
      .filter((e) => e.turn > life.finished)
      .reduce(
        (best, e) => (!best || weight[e.kind] > weight[best.kind] ? e : best),
        null,
      ) || null
  );
}
// The quest that just began, and what started it.
function originOf(s, actor) {
  const life = lifeOf(s, actor);
  return life?.phase === "active" ? life.origin || null : null;
}
function sparkPhrase(s, e) {
  const other = e.other ? inline(s, e.other) : "a friend";
  switch (e.kind) {
    case "gift":
      return `${e.other ? possessive(s, e.other) : "a"} gift`;
    case "help":
      return `helping ${other}`;
    case "talk":
      return `talking with ${other}`;
    case "journey":
      return e.place
        ? `the walk to ${nameIn(s, e.place)} with ${other}`
        : `the walk with ${other}`;
    case "care":
      return e.item ? `tending the ${nameIn(s, e.item)}` : "tending things";
    default:
      return `the bargain with ${other}`;
  }
}
export function purposeOrigin(s, actor) {
  const e = originOf(s, actor);
  return e ? sparkPhrase(s, e) : null;
}
// Third-person card prose: a state caption and one calm line that agrees
// with it. No first person and no pacing numbers appear here.
export function lifeLine(s, actor) {
  const life = lifeOf(s, actor);
  if (!life || life.phase === "active") return null;
  const spark = sparkOf(s, actor);
  if (life.phase === "returning")
    return {
      caption: "Heading to rest",
      detail: `Wants to rest at ${nameIn(s, life.restAt)}.`,
    };
  if (life.phase === "content")
    return {
      caption: "Resting",
      detail: spark
        ? `Resting. Thinking about ${sparkPhrase(s, spark)}.`
        : "Resting. Enjoying what the last quest made.",
    };
  return {
    caption: "Restless",
    detail: spark
      ? `Restless since ${sparkPhrase(s, spark)}.`
      : "Looking for something worth doing.",
  };
}

export function keepReason(s, actor, item) {
  const life = lifeOf(s, actor);
  if (!life || rootOwner(s, item) !== actor) return null;
  const attachment = life.attachments[item];
  if (attachment)
    return `A gift from ${nameIn(s, attachment.from)}, kept since turn ${attachment.turn}.`;
  return life.hope.item === item ? `${possessive(s, actor)} favourite.` : null;
}
export function pendingQuestValue(s, actor, item) {
  const life = lifeOf(s, actor);
  const pending =
    collectionCards(s, actor).filter(
      (q) =>
        q.completedTurn === null &&
        q.key !== life.collection.active &&
        questCarried(s, actor, q.key),
    ) || [];
  return Math.min(
    3,
    pending.filter((q) =>
      q.program.steps
        .slice(q.step)
        .some((step) =>
          (step.any || [step]).some((h) => h.items.includes(item)),
        ),
    ).length,
  );
}
export function attachmentValue(s, actor, item) {
  if (!keepReason(s, actor, item)) return 0;
  return lifeOf(s, actor).attachments[item] ? 4 : 2;
}
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
// First-person awareness for speech: short lines, no labels or directives.
// The first three describe the hope and the present moment.
export function lifeFacts(s, actor) {
  const life = lifeOf(s, actor);
  if (!life) return [];
  const hope = hopeOf(s, actor),
    next = hope.milestones[life.milestones.length],
    spark = sparkOf(s, actor),
    origin = purposeOrigin(s, actor);
  const moment =
    life.phase === "active"
      ? origin
        ? `I know what I want to do now. It started with ${origin}.`
        : "I know what I want to do now."
      : life.phase === "returning"
        ? life.restAt === life.hope.place
          ? "I want to go home and rest."
          : `I want to go to ${nameIn(s, life.restAt)} and rest.`
        : life.phase === "content"
          ? spark
            ? `I'm resting after my last quest. I keep thinking about ${sparkPhrase(s, spark)}.`
            : "I'm resting after my last quest."
          : spark
            ? `I keep thinking about ${sparkPhrase(s, spark)}.`
            : "I'm restless. I'm waiting for something worth doing.";
  const held = Object.keys(s.items).filter((item) =>
    keepReason(s, actor, item),
  );
  const company = stayingWith(s, actor);
  return [
    hope.wish,
    next ? next.next : "I've done what I hoped. I still look after it.",
    moment,
    ...held.map((item) =>
      life.attachments[item]
        ? `${capital(inline(s, life.attachments[item].from))} gave me this ${nameIn(s, item)}. I'm keeping it.`
        : `The ${nameIn(s, item)} is my favourite. I keep it close.`,
    ),
    ...(company ? [`I'm staying with ${inline(s, company)} for a while.`] : []),
  ];
}

// A hope step can also be reached without a quest: a useful gift or shared
// care counts as a delivery, and talk in shared light as a gathering.
function earnHope(s, actor, kind) {
  const life = lifeOf(s, actor);
  if (!life || life.milestones.at(-1) === s.turn) return;
  if (life.hope.steps[life.milestones.length]?.includes(kind))
    life.milestones.push(s.turn);
}
// A light is an item whose state records being lit; it shines while lit,
// fuelled and not covered by another item.
const shiningLights = (s) =>
  Object.keys(s.items).filter(
    (id) =>
      s.items[id].lit === true &&
      (s.items[id].fuel ?? 1) > 0 &&
      !Object.values(s.items).some((other) => other.holder === id),
  );

// Record what happened to each participant. Experiences are memories, not
// points: the first meaningful one after a rest seeds the next purpose.
export function recordLifeAction(s, a, accepted, usefulGift = false) {
  if (!s.life) return;
  const participant = (id) =>
    lifeOf(s, id) !== undefined &&
    (!s.opening ||
      s.opening.met[id] !== undefined ||
      s.controlledActors?.includes(id));
  const social =
    ["give", "trade", "talk"].includes(a.kind) ||
    (["ask", "accompany"].includes(a.kind) && accepted);
  if (social && s.actors[a.target]) {
    for (const [id, other] of [
      [a.actor, a.target],
      [a.target, a.actor],
    ]) {
      if (!participant(id)) continue;
      // A conversation keeps a short promise of company, including after travel.
      lifeOf(s, id).company[other] = s.turn + REST_TURNS;
    }
  }
  if (a.kind === "give" && participant(a.target))
    lifeOf(s, a.target).attachments[a.item] = { from: a.actor, turn: s.turn };
  for (const id of Object.keys(s.life.actors))
    for (const item of Object.keys(lifeOf(s, id).attachments))
      if (rootOwner(s, item) !== id) delete lifeOf(s, id).attachments[item];

  const kindFor = (id) => {
    if (a.kind === "give" && usefulGift)
      return id === a.actor ? "help" : "gift";
    if (a.kind === "trade") return "trade";
    if (a.kind === "talk") return "talk";
    if (a.kind === "accompany" && accepted) return "journey";
    if (a.kind === "refill") return "care";
    return null;
  };
  const participants = [
    ...new Set([a.actor, ...(social && s.actors[a.target] ? [a.target] : [])]),
  ].filter(participant);
  if (
    (a.kind === "give" && usefulGift) ||
    (a.kind === "refill" &&
      Object.keys(s.life.actors).some(
        (id) =>
          id !== a.actor &&
          participant(id) &&
          s.actors[id].place === s.actors[a.actor].place &&
          questItemAvailable(s, id, a.target),
      ))
  )
    earnHope(s, a.actor, "delivery");
  if (
    a.kind === "talk" &&
    s.actors[a.target] &&
    s.actors[a.target].place === s.actors[a.actor].place &&
    shiningLights(s).some((item) =>
      participants.every((id) => questItemAvailable(s, id, item)),
    )
  )
    for (const id of participants) earnHope(s, id, "gathering");
  for (const id of participants) {
    const kind = kindFor(id);
    if (!kind) continue;
    const life = lifeOf(s, id);
    const other = social ? (id === a.actor ? a.target : a.actor) : null;
    const item =
      kind === "care"
        ? s.items[a.target]
          ? a.target
          : a.item
        : a.item || null;
    const e = {
      kind,
      turn: s.turn,
      other: other || null,
      item: item && s.items[item] ? item : null,
      place: a.destination || s.actors[id].place,
    };
    const last = life.experiences.at(-1);
    // A repeated exchange refreshes its memory instead of adding another.
    const same =
      last && ["kind", "other", "item", "place"].every((k) => last[k] === e[k]);
    life.experiences = same
      ? [...life.experiences.slice(0, -1), e]
      : [...life.experiences, e].slice(-EXPERIENCE_LIMIT);
  }
}

// Rest happens only in a sanctuary: a place whose data declares
// `sanctuary: true`. `sanctuaries` lists those place ids in declared order;
// a world that declares none lets avatars rest anywhere.
const atSanctuary = (s, actor, sanctuaries) =>
  !sanctuaries?.length || sanctuaries.includes(s.actors[actor].place);
// Home when home is a sanctuary, otherwise the first declared sanctuary.
export function restPlaceFor(s, actor, sanctuaries) {
  const home = lifeOf(s, actor).hope.place;
  return sanctuaries.includes(home) ? home : sanctuaries[0];
}
function startRest(s, actor, sanctuaries) {
  const life = lifeOf(s, actor);
  if (atSanctuary(s, actor, sanctuaries)) {
    life.phase = "content";
    delete life.restAt;
  } else {
    life.phase = "returning";
    life.restAt = restPlaceFor(s, actor, sanctuaries);
  }
}
// At the end of a round. A returning avatar starts to rest once it reaches a
// sanctuary. Rest rounds count only there; leaving sends it back. A restless
// avatar with a spark, or after a long quiet spell, takes up a purpose.
// Returns the avatars that just found a purpose.
export function settleLife(
  s,
  ids = Object.keys(s.life?.actors || {}),
  sanctuaries = null,
) {
  const ready = [];
  for (const id of ids) {
    const life = lifeOf(s, id);
    if (!life || life.finished === s.turn) continue;
    if (life.phase === "returning" || life.phase === "content")
      startRest(s, id, sanctuaries);
    if (life.phase === "content") {
      life.restLeft = Math.max(0, life.restLeft - 1);
      if (life.restLeft === 0) {
        life.phase = "seeking";
        life.quiet = 0;
      }
    }
    if (life.phase !== "seeking") continue;
    const spark = sparkOf(s, id);
    life.quiet = Math.min(STALL_TURNS + 1, life.quiet + 1);
    if (spark || life.quiet > STALL_TURNS) {
      life.phase = "active";
      life.quiet = 0;
      if (spark) life.origin = spark;
      else delete life.origin;
      ready.push(id);
    }
  }
  return ready;
}

function fitsMilestone(milestone, program) {
  return !!milestone?.includes(
    program.generated?.situation === "introduction"
      ? "gathering"
      : program.generated?.situation,
  );
}
export function finishPersonalQuest(
  s,
  actor,
  program,
  sanctuaries = null,
  { rest = true } = {},
) {
  const life = lifeOf(s, actor);
  if (!life) return;
  const next = life.hope.steps[life.milestones.length];
  if (fitsMilestone(next, program) && life.milestones.at(-1) !== s.turn)
    life.milestones.push(s.turn);
  if (!rest) return;
  delete life.origin;
  life.finished = s.turn;
  life.restLeft = REST_TURNS;
  life.quiet = 0;
  startRest(s, actor, sanctuaries);
}
export function personalQuestRank(s, actor, program) {
  const life = lifeOf(s, actor);
  if (!life) return 0;
  const kind = program.generated?.situation;
  const milestone = life.hope.steps[life.milestones.length];
  const shaping = life.origin || sparkOf(s, actor) || life.experiences.at(-1);
  return (
    (fitsMilestone(milestone, program) ? -100 : 0) +
    (kind === affinity[shaping?.kind] ? -8 : 0)
  );
}

export function validLife(s, placeIds = null) {
  if (s.life === undefined) return true;
  const l = s.life;
  const whole = (n, max) => Number.isSafeInteger(n) && n >= 0 && n <= max;
  const actorIds = Object.keys(s.actors || {});
  const itemIds = Object.keys(s.items || {});
  const place = (p) =>
    typeof p === "string" &&
    p.length > 0 &&
    p.length <= 40 &&
    (!placeIds || placeIds.includes(p));
  const validExperience = (e) =>
    e &&
    Object.keys(e).every((k) =>
      ["kind", "turn", "other", "item", "place"].includes(k),
    ) &&
    experienceKinds.includes(e.kind) &&
    whole(e.turn, s.turn) &&
    (e.other === null || actorIds.includes(e.other)) &&
    (e.item === null || itemIds.includes(e.item)) &&
    (e.place === null || place(e.place));
  return (
    l?.version === LIFE_VERSION &&
    s.motives?.questPrograms === true &&
    l.actors &&
    typeof l.actors === "object" &&
    Object.keys(l.actors).every((id) => {
      const p = l.actors[id];
      const steps = p?.hope?.steps;
      return (
        actorIds.includes(id) &&
        p &&
        ["active", "returning", "content", "seeking"].includes(p.phase) &&
        !("inspiration" in p) &&
        !("restUntil" in p) &&
        whole(p.finished, s.turn) &&
        whole(p.restLeft, REST_TURNS) &&
        whole(p.quiet, STALL_TURNS + 1) &&
        (p.phase === "returning" ? place(p.restAt) : p.restAt === undefined) &&
        p.hope &&
        place(p.hope.place) &&
        (p.hope.item === null || itemIds.includes(p.hope.item)) &&
        Array.isArray(steps) &&
        steps.length === hopeSteps.length &&
        steps.every(
          (kinds) =>
            Array.isArray(kinds) &&
            kinds.length > 0 &&
            kinds.every((k) => situations.has(k)),
        ) &&
        (p.origin === undefined ||
          (p.phase === "active" && validExperience(p.origin))) &&
        Array.isArray(p.milestones) &&
        p.milestones.length <= steps.length &&
        p.milestones.every(
          (turn, i) => whole(turn, s.turn) && turn > (p.milestones[i - 1] ?? 0),
        ) &&
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
            whole(until, s.turn + REST_TURNS),
        ) &&
        Array.isArray(p.experiences) &&
        p.experiences.length <= EXPERIENCE_LIMIT &&
        p.experiences.every(validExperience)
      );
    })
  );
}
