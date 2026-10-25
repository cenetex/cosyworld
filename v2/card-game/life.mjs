// Personal quests grow from shared actions. This state belongs to the save.
import { rootOwner, questItemAvailable, conditionMet } from "./situations.mjs";
import { isPackActor, packPeople, packThings } from "./pack-registry.mjs";

export const INSPIRATION_MAX = 5;
export const REST_TURNS = 3;
const actors = ["vale", "moth", "keeper"];
const items = ["lamp", "oil", "bell", "cloth", ...Object.keys(packThings)];
const names = {
  vale: "Vale",
  moth: "Pip",
  keeper: "The keeper",
  ...Object.fromEntries(
    Object.entries(packPeople).map(([id, a]) => [id, a.name]),
  ),
};
const itemNames = {
  ...Object.fromEntries(
    Object.entries(packThings).map(([id, item]) => [id, item.name]),
  ),
  lamp: "Lamp",
  oil: "Oil flask",
  bell: "Bell",
  cloth: "Black cloth",
};
export const hopes = {
  vale: {
    title: "Make the shore a place to belong",
    keeps: { lamp: "Keep a light ready for shared journeys." },
    milestones: [
      { title: "Return a kindness", kinds: ["delivery"] },
      { title: "Gather in warm light", kinds: ["gathering"] },
      { title: "Care for the shore", kinds: ["answer", "crossing"] },
    ],
  },
  moth: {
    title: "Find a warm home with company",
    keeps: {
      lamp: "Its warmth makes this place feel like home.",
      cloth: "Keep the familiar cloth close for comfort.",
    },
    milestones: [
      { title: "Share a warm evening", kinds: ["gathering"] },
      { title: "Care for a friend", kinds: ["delivery"] },
      {
        title: "Help the shore feel safe",
        kinds: ["answer", "crossing"],
        effects: ["hush", "anchor"],
      },
    ],
  },
  keeper: {
    title: "Make a quiet refuge for visitors",
    keeps: {
      bell: "Keep the bell safe for the quiet hours.",
      oil: "Save oil for visitors who need light.",
    },
    milestones: [
      { title: "Prepare a quiet shore", kinds: ["answer"], effects: ["hush"] },
      { title: "Provide for a visitor", kinds: ["delivery"] },
      { title: "Welcome a gathering", kinds: ["gathering"] },
    ],
  },
};
export const lifeOf = (s, actor) => s.life?.actors?.[actor];
export const questActive = (s, actor) =>
  !isPackActor(actor) &&
  (!lifeOf(s, actor) || lifeOf(s, actor).phase === "active");

const hopeHints = {
  vale: [
    "Give a useful gift or tend a friend's light.",
    "Talk together beside a lit lamp.",
    "Complete a quest that opens or cares for a place.",
  ],
  moth: [
    "Talk with a friend beside a lit lamp.",
    "Give a useful gift or tend a friend's light.",
    "Complete a quest that quiets or anchors the shore.",
  ],
  keeper: [
    "Complete a quest that quiets the pond.",
    "Give a useful gift or tend a visitor's light.",
    "Talk with a visitor beside a lit lamp.",
  ],
};
export function hopeProgress(s, actor) {
  const done = lifeOf(s, actor)?.milestones.length || 0;
  return {
    done,
    total: hopes[actor].milestones.length,
    next: hopes[actor].milestones[done]?.title || "A hope fulfilled",
    hint: hopeHints[actor][done] || "Keep caring for the home you made.",
  };
}
export function recentInspiration(s, actor) {
  const e = lifeOf(s, actor)?.experiences.at(-1);
  if (!e) return "Talk, trade, help or travel together.";
  const label = {
    help: "A useful gift",
    trade: "A fair trade",
    talk: "A conversation",
    journey: "A shared journey",
    care: "Care for the lamp",
  }[e.kind];
  return `${label} · turn ${e.turn}`;
}
function earnHope(s, actor, kind, target = null) {
  const life = lifeOf(s, actor);
  if (!life || life.milestones.at(-1) === s.turn) return;
  const next = hopes[actor].milestones[life.milestones.length];
  if (
    fitsMilestone(next, { generated: { situation: kind }, steps: [] }, target)
  )
    life.milestones.push(s.turn);
}

export function enablePersonalQuests(s) {
  if (s.life === undefined)
    s.life = {
      version: 1,
      actors: Object.fromEntries(
        actors.map((id) => [
          id,
          {
            phase: "active",
            inspiration: 0,
            restUntil: 0,
            experiences: [],
            attachments: {},
            company: {},
            milestones: [],
          },
        ]),
      ),
    };
  return s;
}

export function keepReason(s, actor, item) {
  const life = lifeOf(s, actor);
  if (!life || rootOwner(s, item) !== actor) return null;
  const attachment = life.attachments[item];
  return attachment
    ? `A gift from ${names[attachment.from] || "Grumpy Badger"}, kept since turn ${attachment.turn}.`
    : hopes[actor].keeps[item] || null;
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
        s.actors[other].place === s.actors[actor].place &&
        !(s.motives?.grievances[actor] || []).some((g) => g.other === other),
    ) || null
  );
}
export function lifeFacts(s, actor) {
  const life = lifeOf(s, actor);
  if (!life) return [];
  const hope = hopes[actor],
    next = hope.milestones[life.milestones.length];
  return [
    `Long-term hope: ${hope.title}.`,
    next
      ? `Next milestone: ${next.title}. ${hopeProgress(s, actor).hint}`
      : `This hope is fulfilled; keep caring for it.`,
    life.phase === "active"
      ? "Pursuing a personal quest."
      : life.phase === "content"
        ? "Enjoying the last achievement before finding a new purpose."
        : `Inspiration: ${life.inspiration}/${INSPIRATION_MAX}. Useful trades, talks, help and shared journeys grow a new purpose.`,
    ...items
      .filter((item) => keepReason(s, actor, item))
      .map((item) => `${itemNames[item]}: ${keepReason(s, actor, item)}`),
    ...(stayingWith(s, actor)
      ? [
          `Staying to spend time with ${names[stayingWith(s, actor)] || "Grumpy Badger"}.`,
        ]
      : []),
  ];
}

// Keep a bounded list across quest cycles. Repeating one trade or conversation
// earns its next point after six turns; each avatar earns at most two per round.
export function recordLifeAction(s, a, accepted, usefulGift = false) {
  if (!s.life) return;
  const participant = (id) =>
    actors.includes(id) && (!s.opening || s.opening.met[id] !== undefined);
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
  for (const id of actors)
    for (const item of Object.keys(lifeOf(s, id).attachments))
      if (rootOwner(s, item) !== id) delete lifeOf(s, id).attachments[item];

  let kind,
    points = 1;
  if (a.kind === "give" && usefulGift) {
    kind = "help";
    points = 2;
  } else if (a.kind === "trade") kind = "trade";
  else if (a.kind === "talk") kind = "talk";
  else if (a.kind === "accompany" && accepted) kind = "journey";
  else if (a.kind === "refill") {
    kind = "care";
    points = 2;
  }
  if (!kind) return;
  const participants = [
    ...new Set([a.actor, ...(social ? [a.target] : [])]),
  ].filter(participant);
  if (
    (a.kind === "give" && usefulGift) ||
    (a.kind === "refill" &&
      actors.some(
        (id) =>
          id !== a.actor &&
          participant(id) &&
          s.actors[id].place === s.actors[a.actor].place &&
          questItemAvailable(s, id, "lamp"),
      ))
  )
    earnHope(s, a.actor, "delivery");
  if (
    a.kind === "talk" &&
    s.actors[a.target] &&
    s.actors[a.target].place === s.actors[a.actor].place &&
    conditionMet(s, { kind: "lit" }) &&
    participants.every((id) => questItemAvailable(s, id, "lamp"))
  )
    for (const id of participants) earnHope(s, id, "gathering");
  for (const id of participants) {
    const life = lifeOf(s, id);
    const other = id === a.actor ? a.target : a.actor;
    const pair = [a.item, a.receive].filter(Boolean).sort().join("+");
    const key = `${kind}:${other || "self"}:${pair}:${a.destination || s.actors[id].place}`;
    if (life.experiences.some((e) => e.key === key && s.turn - e.turn < 6))
      continue;
    const earned = life.experiences
      .filter((e) => e.turn === s.turn)
      .reduce((n, e) => n + e.points, 0);
    const award = Math.min(points, 2 - earned);
    if (award <= 0) continue;
    life.experiences = [
      ...life.experiences,
      { key, kind, turn: s.turn, points: award },
    ].slice(-16);
    if (life.phase === "seeking")
      life.inspiration = Math.min(INSPIRATION_MAX, life.inspiration + award);
  }
}

function fitsMilestone(milestone, program, target = null) {
  if (!milestone?.kinds.includes(program.generated?.situation)) return false;
  if (!milestone.effects) return true;
  const targets = target
    ? [target]
    : program.steps.flatMap((step) => step.any || [step]);
  return targets.some((h) => milestone.effects.includes(h.consequence?.kind));
}
export function finishPersonalQuest(s, actor, program, target = null) {
  const life = lifeOf(s, actor);
  if (!life) return;
  const next = hopes[actor].milestones[life.milestones.length];
  if (fitsMilestone(next, program, target) && life.milestones.at(-1) !== s.turn)
    life.milestones.push(s.turn);
  life.phase = "content";
  life.inspiration = 0;
  life.restUntil = s.turn + REST_TURNS;
}
export function personalQuestRank(s, actor, program) {
  const life = lifeOf(s, actor);
  if (!life) return 0;
  const kind = program.generated?.situation;
  const milestone = hopes[actor].milestones[life.milestones.length];
  const last = life.experiences.at(-1)?.kind;
  const affinity = {
    help: "delivery",
    talk: "gathering",
    journey: "crossing",
    care: "gathering",
    trade: "bargain",
  }[last];
  return (
    (fitsMilestone(milestone, program) ? -100 : 0) +
    (kind === affinity ? -8 : 0)
  );
}

export function validLife(s) {
  if (s.life === undefined) return true;
  const l = s.life;
  const whole = (n, max) => Number.isSafeInteger(n) && n >= 0 && n <= max;
  return (
    l?.version === 1 &&
    s.motives?.questPrograms === true &&
    Object.keys(l.actors || {})
      .sort()
      .join() === actors.slice().sort().join() &&
    actors.every((id) => {
      const p = l.actors[id];
      return (
        p &&
        ["active", "content", "seeking"].includes(p.phase) &&
        whole(p.inspiration, INSPIRATION_MAX) &&
        whole(p.restUntil, s.turn + REST_TURNS) &&
        (p.phase === "seeking" || p.inspiration === 0) &&
        Array.isArray(p.milestones) &&
        p.milestones.length <= 3 &&
        p.milestones.every(
          (turn, i) => whole(turn, s.turn) && turn > (p.milestones[i - 1] ?? 0),
        ) &&
        p.attachments &&
        Object.keys(p.attachments).length <= items.length &&
        Object.entries(p.attachments).every(
          ([item, a]) =>
            items.includes(item) &&
            a &&
            [...actors, "badger", ...Object.keys(packPeople)].includes(
              a.from,
            ) &&
            a.from !== id &&
            whole(a.turn, s.turn),
        ) &&
        p.company &&
        Object.keys(p.company).length <= 3 + Object.keys(packPeople).length &&
        Object.entries(p.company).every(
          ([other, until]) =>
            [...actors, "badger", ...Object.keys(packPeople)].includes(other) &&
            other !== id &&
            whole(until, s.turn + REST_TURNS),
        ) &&
        Array.isArray(p.experiences) &&
        p.experiences.length <= 16 &&
        p.experiences.every(
          (e) =>
            e &&
            typeof e.key === "string" &&
            e.key.length <= 400 &&
            ["help", "trade", "talk", "journey", "care"].includes(e.kind) &&
            whole(e.turn, s.turn) &&
            [1, 2].includes(e.points),
        )
      );
    })
  );
}
