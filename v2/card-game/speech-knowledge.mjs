import {
  entityActive,
  matchesChoiceWitness,
  observableStates,
  packThings,
} from "./pack-registry.mjs";
import {
  currentActor,
  itemPlace,
  nameOf,
  places,
  rootHolder,
} from "./world.mjs";
import { questsOf } from "./want.mjs";
import { nativeDisclosure } from "./knowledge.mjs";
import { found } from "./world/found.mjs";
import baseProfiles from "./entity-profiles.json" with { type: "json" };

export function knowsPackChoice(world, actor, pack, choice) {
  const turn = world.packs[pack.id].receipts[choice.id];
  const known = world.knowledge?.known?.[actor] || {};
  const wordsMatch = (entry, text) =>
    entry.turn === turn && entry.locationId === choice.at &&
    matchesChoiceWitness(choice, entry.actorId, text);

  // A commit can be witnessed directly or retained as a personal fact after
  // the original line leaves the log. Older events may carry only their words.
  if ((world.log || []).some((entry) => {
    if (entry.generated || entry.turn !== turn) return false;
    const commit = (entry.packId === pack.id && entry.choiceId === choice.id) ||
      (entry.kind === "action" && entry.verb === (choice.on || "choose") &&
        wordsMatch(entry, entry.text));
    return commit && (entry.actorId === actor ||
      (entry.witnesses ?? entry.cast)?.includes(actor) ||
      Object.hasOwn(known, `event:${entry.seq}`));
  })) return true;

  return Object.keys(known).some((id) => {
    const fact = world.knowledge.facts[id];
    const source = fact?.source;
    return (source?.kind === "event" && wordsMatch(source, fact.text)) ||
      (source?.kind === "topic" && source.topic?.packId === pack.id &&
        source.topic.choiceId === choice.id) ||
      (source?.kind === "claim" && source.claim === choice.id &&
        pack.items?.[source.book]?.records?.includes(choice.id));
  });
}

// A covered thing reaches the speaker as something sensed but unnamed. The
// table's own word "covered" stays out of speech (#1665).
export const UNKNOWN_THING = "something I can't make out";
// A covered light still shines: the speaker knows it holds a light, unnamed.
export const UNKNOWN_LIGHT = "something shining I can't make out";

// Someone or somewhere a speaker has not found yet stays unnamed (#1850).
export const UNKNOWN_PERSON = "someone I haven't met yet";
const unnamed = (world, id) =>
  world.actors[id]
    ? UNKNOWN_PERSON
    : world.items[id]
      ? UNKNOWN_THING
      : "a place I haven't found yet";

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const opensSentence = (text, at) =>
  /(?:^|[.!?…])[\s"'“”‘’(]*$/.test(text.slice(0, at));
function blurrer(unknown, shown = [], short = new Map()) {
  if (!unknown.size) return (text) => text;
  const names = [...unknown.keys(), ...short.keys(), ...shown]
    .sort((a, b) => b.length - a.length)
    .map(escape);
  const pattern = new RegExp(
    `\\b(?:(?:the|an?) )??(${names.join("|")})\\b`,
    "gi",
  );
  return (text, clue) =>
    text?.replace(pattern, (word, name, at, whole) => {
      const hidden = unknown.get(name.toLowerCase()) ||
        ((word !== name || !opensSentence(whole, at)) && short.get(name));
      const revealed = hidden && clue && new RegExp(`\\b${escape(name)}\\b`, "iu").test(clue);
      return hidden && !revealed ? hidden : word;
    }) ?? text;
}

// What an avatar's facts may name beyond the scene: its quests' targets
// and the goal of its last measured try.
function questTargets(world, id) {
  const goal = world.memories[id]?.learning?.at(-1)?.goal;
  return [
    ...questsOf(world, id).flatMap(({ target, step }) => [
      target,
      step?.at,
      step?.to,
      step?.with,
      ...(step?.items || []),
    ]),
    world.actors[id].glimpse?.id,
    goal?.item,
    goal?.destination,
  ].filter((t) => t !== id && (world.items[t] || world.actors[t] || places[t]));
}

// Blurs, in an avatar's own words, the targets it has not found yet.
export function unfoundBlur(world, id, scene = [], isCovered = () => false) {
  const hidden = questTargets(world, id).filter(
    (t) => !scene.includes(t) && (isCovered(t) || !found(world, id, t)),
  );
  return {
    hidden,
    blur: blurrer(
      new Map(hidden.map((t) => [nameOf(t).toLowerCase(), unnamed(world, t)])),
    ),
  };
}

// An item's last word ("the River Map" is a map), for every item a table
// may hold. A thought that names an item kind the speaker has never been
// near invents it ("my compass is ready").
const GENERIC = new Set([
  "account", "card", "list", "record", "plea", "seed",
  "bread", "wine", "water", "milk", "honey", "watch",
]);
const itemNouns = new Map();
for (const [id, p] of Object.entries({ ...baseProfiles, ...packThings }))
  if (p.kind === "item" || packThings[id]) {
    const noun = String(p.name || "")
      .split(" ")
      .at(-1)
      .toLowerCase();
    if (noun.length > 2 && !GENERIC.has(noun))
      itemNouns.set(noun, [...(itemNouns.get(noun) || []), id]);
  }
export function inventsItem(world, speaker, text) {
  const a = world.actors[speaker];
  const near = (id) =>
    world.items[id] &&
    entityActive(world, id) &&
    (rootHolder(world, id) === speaker ||
      !a?.visited ||
      a.visited.includes(itemPlace(world, id)));
  const lower = String(text || "").toLowerCase();
  return [...itemNouns].some(
    ([noun, ids]) =>
      new RegExp(`\\b${noun}s?\\b`).test(lower) && !ids.some(near),
  );
}

// An inner-life line is spoken by the avatar itself, in balanced quotes,
// about things it has been near.
export const groundedInner = (world, speaker, text) =>
  /\b(i|i'm|i've|my|me|mine)\b/i.test(text) &&
  (text.match(/["\u201c\u201d]/g) || []).length % 2 === 0 &&
  !/[,!?]["\u201d] [a-z]/.test(text) &&
  !inventsItem(world, speaker, text);

function coveredCards(world, isCovered) {
  const cards = [
    ...Object.keys(world.actors),
    ...Object.keys(places),
    ...Object.keys(world.items),
  ];
  const faceDown = (id) => isCovered(id);
  const hidden = new Set(cards.filter(faceDown));
  const shown = new Set(cards.filter((id) => !hidden.has(id)).map(lowerName));
  return {
    hidden,
    shown,
    unnamedIds: [...hidden].filter((id) => !shown.has(lowerName(id))),
  };
}
const lowerName = (id) => nameOf(id).toLowerCase();
function nameKeys(ids, shown, phrase) {
  const taken = new Set([...shown].map((name) => name.split(" ").at(-1)));
  const full = new Map(), short = new Map();
  for (const id of ids) {
    const name = nameOf(id), last = name.split(" ").at(-1);
    full.set(name.toLowerCase(), phrase(id));
    if (
      last !== name &&
      last.length > 3 &&
      /^[A-Z]/.test(last) &&
      !taken.has(last.toLowerCase())
    )
      short.set(last, phrase(id));
  }
  return [full, short];
}

function privateWords(entity, blur) {
  const kept = ({ text }) => blur(text) === text;
  const { inner_life: life, previous } = entity;
  return {
    previous: blur(previous) === previous ? previous : null,
    ...(life && { inner_life: {
      ...life,
      persona: blur(life.persona) === life.persona ? life.persona : null,
      thoughts: life.thoughts.filter(kept),
      dreams: life.dreams.filter(kept),
    }}),
  };
}

export function coveredTextReader(world, isCovered) {
  const { unnamedIds, shown } = coveredCards(world, isCovered);
  const [names, short] = nameKeys(unnamedIds, shown, (id) =>
    world.actors[id] ? "someone" : world.items[id] ? "something" : "a place",
  );
  const blur = blurrer(names, shown, short);
  const actor = currentActor(world);
  const known = world.knowledge?.known?.[actor];
  return (text, line) => {
    const factId = line?.disclosedFactId;
    const clue = (line?.generated || nativeDisclosure(line, actor)) && line.kind === "dialogue" && line.text === text &&
      factId && known && Object.hasOwn(known, factId)
      ? world.knowledge.facts[factId]?.text : null;
    const caption = blur(text, clue);
    return caption && /^[A-Z]/.test(text)
      ? caption[0].toUpperCase() + caption.slice(1)
      : caption;
  };
}
export const coveredText = (world, text, isCovered, line) =>
  coveredTextReader(world, isCovered)(text, line);

export function forgetCovered(world, context, isCovered) {
  const actor = currentActor(world);
  const { hidden, shown, unnamedIds } = coveredCards(world, isCovered);
  if (!hidden.size) return context;
  const kept = (id) => !hidden.has(id);
  const keepEntity = (id) =>
    id === actor || id === context.location || kept(id);
  const [unknown, short] = nameKeys(unnamedIds, shown, (id) =>
    world.items[id]?.lit
      ? UNKNOWN_LIGHT
      : unnamed(world, id),
  );
  const blur = blurrer(unknown, shown, short);
  const keptLine = ({ text }) => blur(text) === text;
  const outcome =
    context.outcome && revealedOutcome(world, context.outcome, actor, kept);
  const speakers = context.speakers.filter(keepEntity);
  return {
    ...context,
    speakers,
    scenery: context.scenery && kept(context.location),
    concealed: unnamedIds,
    ...(outcome ? { outcome } : {}),
    focus: kept(context.focus) ? context.focus : null,
    action: blur(context.action)?.slice(0, 650) ?? null,
    events: context.events.map((text) => blur(text).slice(0, 650)),
    conversation: context.conversation.filter(
      (line) => kept(line.actorId) && keptLine(line),
    ),
    ...(context.disclosures && {
      disclosures: context.disclosures.filter(
        (fact) =>
          speakers.includes(fact.speaker) &&
          keepEntity(fact.listener) &&
          (fact.deferred || keptLine(fact)),
      ),
    }),
    entities: context.entities
      .filter(({ id }) => keepEntity(id))
      .map((entity) => ({
        ...entity,
        facts: entity.facts.map((text) => blur(text).slice(0, 240)),
        memories: entity.memories.flatMap((m) => {
          const text = blur(m.text);
          if (m.kind === "expression") return text === m.text ? [m] : [];
          return [{ ...m, text: text.slice(0, 650) }];
        }),
        ...privateWords(entity, blur),
        ...(entity.between && {
          between: entity.between
            .filter((b) => speakers.includes(b.with))
            .map((b) => ({
              ...b,
              facts: b.facts.map((text) => blur(text).slice(0, 240)),
              said: b.said.filter(keptLine),
            }))
            .filter((b) => b.facts.length || b.said.length),
        }),
        ...(entity.perception && {
          perception: {
            ...entity.perception,
            pull: kept(entity.perception.pull) ? entity.perception.pull : null,
          },
        }),
        desire: entity.desire && {
          items: entity.desire.items.filter(kept),
          avatars: entity.desire.avatars.filter(kept),
          location: kept(entity.desire.location)
            ? entity.desire.location
            : null,
        },
      })),
  };
}

function revealedOutcome(world, outcome, actor, kept) {
  const card = { ...outcome.card };
  for (const key of ["target", "item", "receive", "destination"])
    if (!kept(card[key])) card[key] = null;
  if (card.wantMet && !kept(card.wantMet.target)) delete card.wantMet;
  // Ask and Accompany need named parties in the narrator's outcome shape.
  if (
    (card.kind === "ask" && (!card.target || !card.item)) ||
    (card.kind === "accompany" && (!card.target || !card.destination))
  ) {
    card.kind = "wait";
    card.accepted = null;
    card.destination = null;
  }
  const avatars = outcome.avatars.filter(
    ({ id, location }) => id === actor || (kept(id) && kept(location)),
  );
  const avatarIds = new Set(avatars.map(({ id }) => id));
  const items = outcome.items.filter(
    ({ id, holder, location }) =>
      kept(id) && kept(holder) && kept(location) && kept(rootHolder(world, id)),
  );
  const itemIds = new Set(items.map(({ id }) => id));
  return {
    card,
    avatars: avatars.map((avatar) => ({
      ...avatar,
      holding: avatar.holding.filter(kept),
      ...(Object.hasOwn(avatar, "heldItem") && {
        heldItem: itemIds.has(avatar.heldItem) ? avatar.heldItem : null,
      }),
      travel:
        avatar.travel && kept(avatar.travel.from) && kept(avatar.travel.to)
          ? {
              ...avatar.travel,
              companions: avatar.travel.companions.filter((id) =>
                avatarIds.has(id),
              ),
            }
          : null,
    })),
    items,
    observations: observableStates(world, [...avatarIds, ...itemIds]),
  };
}

// A new game's first line is raw (#1600): the server frames the waking avatar
// with only its uncovered name, place and holdings, and no voice until its
// own card is uncovered. A covered place is not voiced either.
export function markWaking(world, context, isCovered) {
  if (!world.opening || context.turn !== 0 || context.action) return context;
  const covered = [...context.speakers, context.location].filter(isCovered);
  return {
    ...context,
    waking: true,
    scenery: context.scenery && !isCovered(context.location),
    ...(covered.length ? { covered } : {}),
  };
}

// Each avatar's facts name only the quest targets it has found, and, in the
// browser, whose cards its player has uncovered (#1850). The rest read as
// "someone I haven't met yet", and the server's name check rejects a line
// that names them.
export function forgetUnfound(world, context, isCovered = () => false) {
  // The present beat may name what its play names.
  const scene = [
    context.location,
    ...context.entities.map(({ id }) => id),
    ...Object.values(context.outcome?.card || {}),
  ];
  let changed = false;
  const entities = context.entities.map((entity) => {
    if (!world.actors[entity.id] || !entity.desire) return entity;
    const { hidden, blur } = unfoundBlur(world, entity.id, scene, isCovered);
    if (!hidden.length) return entity;
    changed = true;
    const kept = (id) => !hidden.includes(id);
    return {
      ...entity,
      ...privateWords(entity, blur),
      facts: entity.facts.map(blur),
      ...(entity.between && {
        between: entity.between.map((b) => ({
          ...b,
          facts: b.facts.map(blur),
        })),
      }),
      ...(entity.perception?.pull &&
        !kept(entity.perception.pull) && {
          perception: { ...entity.perception, pull: undefined },
        }),
      desire: {
        items: entity.desire.items.filter(kept),
        location: kept(entity.desire.location) ? entity.desire.location : null,
        avatars: entity.desire.avatars.filter(kept),
      },
    };
  });
  return changed ? { ...context, entities } : context;
}
