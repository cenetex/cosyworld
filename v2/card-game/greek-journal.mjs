import { legalActions, nameOf } from "./world.mjs";
import { theName } from "./world/catalog.mjs";
import {
  conditionsMet,
  entityActive,
  heldSlots,
  itemTypeMatches,
  packDefinition,
  packGiveChoice,
  packTalkChoice,
  recordedChoiceLine,
} from "./pack-registry.mjs";

const PACK = "greek-drama";
const pack = packDefinition(PACK);
const choices = (pack?.choices || []).filter((choice) => !choice.archived);
const byId = new Map(choices.map((choice) => [choice.id, choice]));
const recapsBySpeaker = Map.groupBy(choices.filter((choice) => choice.recap), ({ subject }) => subject);
const accounts = {
  "greek-atreid-account": {
    aeschylus: "Aeschylean account", sophocles: "Sophoclean account", euripides: "Euripidean account",
  },
  "greek-helen-account": { egypt: "Egyptian account", troy: "Trojan account" },
};
const eras = {
  "civic-athens": "Civic Athens",
  "divine-frontier": "Divine frontier",
  "early-thebes": "Early Thebes",
  "heroic-aftermath": "Heroic aftermath",
  "heroic-households": "Heroic households",
  homecomings: "Homecomings",
  "imperial-aftermath": "Imperial aftermath",
  "theban-aftermath": "After the Theban war",
  "theban-exile": "Theban exile",
  "theban-households": "Theban households",
  "theban-war": "Theban war",
  "trojan-aftermath": "After the Trojan War",
  "trojan-departure": "Before the Trojan War",
  "trojan-war": "Trojan War",
};
const proofId = (id) => id?.startsWith(`claim:${PACK}:`) ? id.split(":")[3] : null;
const prerequisites = (conditions) => (conditions || []).flatMap((c) => {
  if (c.kind === "any") return prerequisites(c.conditions);
  if (c.kind === "receipt") return [c.choiceId];
  if (c.kind === "knows") return (c.topics || [c.topic]).map(proofId).filter(Boolean);
  return [];
});

const works = (pack?.works || []).map((work) => {
  const ids = new Set(work.hookChoiceIds);
  for (const c of choices) if (c.workId === work.id) ids.add(c.id);
  for (const c of choices) {
    if (c.workId || ids.has(c.id)) continue;
    if (prerequisites(c.requires).some((id) => ids.has(id))) ids.add(c.id);
  }
  return { ...work, choices: [...ids].map((id) => byId.get(id)).filter(Boolean) };
});

const madeDecision = (c) => c.effects.some((e) => e.kind === "choose" && !accounts[e.key]);
const opensStory = (c) => c.effects.every((e) => e.kind === "set_flag" && e.key.endsWith("-heard"));
const actedAt = (event) => event.locationId || event.fromLocationId;

function eventFor(c, events) {
  const exact = events.find((e) => e.packId === PACK && e.choiceId === c.id);
  if (exact) return exact;
  if (!["talk", "give"].includes(c.on)) return null;
  const matches = events.filter((e) => e.verb === c.on && e.targetId === c.subject && actedAt(e) === c.at &&
    (c.on === "talk" || (e.accepted && heldSlots(c.requires).flat().some((id) => itemTypeMatches(id, e.itemId)))));
  return matches.length === 1 ? matches[0] : null;
}

function personalEvidence(world, actor, receipts) {
  const events = (world.log || []).filter((e) => e.kind === "action" && !e.generated);
  const turns = Map.groupBy(events, (e) => e.turn);
  const observed = new Map();
  for (const [id, turn] of Object.entries(receipts)) {
    const c = byId.get(id);
    if (!c) continue;
    const event = eventFor(c, turns.get(turn) || []);
    if (event?.actorId === actor) observed.set(id, opensStory(c) ? "heard" : "took part");
    else if (event?.witnesses?.includes(actor)) observed.set(id, "witnessed");
  }
  for (const event of events) {
    if (event.verb !== "talk" || event.actorId !== actor) continue;
    for (const c of recapsBySpeaker.get(event.targetId) || []) {
      if (actedAt(event) !== c.at) continue;
      if (Object.hasOwn(receipts, c.id) && c.text && event.text.startsWith(c.text) && !observed.has(c.id)) observed.set(c.id, "heard");
      const answer = c.recap.answers.find((id) => Object.hasOwn(receipts, id));
      if (answer && !observed.has(answer) &&
        event.text.startsWith(`${nameOf(c.subject)} points to ${theName(c.recap.record)}. `)) {
        const line = pack.items[c.recap.record].recordText?.[answer] ?? recordedChoiceLine(world, pack, byId.get(answer));
        if (event.text.includes(line)) observed.set(answer, "heard");
      }
    }
  }
  const books = new Map();
  for (const [id, learned] of Object.entries(world.knowledge?.known?.[actor] || {})) {
    const from = world.knowledge.facts?.[id]?.source;
    const choice = from?.topic?.packId === PACK ? from.topic.choiceId : null;
    if (choice && !observed.has(choice) && Object.hasOwn(receipts, choice)) observed.set(choice, "heard");
    if (from?.kind !== "claim" || !id.startsWith(`claim:${PACK}:`) || !pack.items[from.book]) continue;
    if (learned.kind === "read" || !books.has(from.book)) books.set(from.book, learned.kind);
    if (!observed.has(from.claim) && Object.hasOwn(receipts, from.claim))
      observed.set(from.claim, learned.kind);
  }
  return { observed, books, events };
}

function localLeads(world, actor, known) {
  const byChoice = new Map(), byBook = new Map(), takes = new Map();
  for (const act of legalActions(world, actor)) {
    if (act.kind === "read" && pack.items[act.item] && known(act.item))
      byBook.set(act.item, `Read ${nameOf(act.item)}`);
    if (act.kind === "take" && pack.items[act.item] && known(act.item))
      takes.set(act.item, `Take ${nameOf(act.item)}`);
    if (!pack.avatars[act.target] && !pack.places[act.target]) continue;
    if (!known(act.target)) continue;
    let choice, text;
    if (act.kind === "choose") {
      choice = act;
      text = act.label;
    } else if (act.kind === "talk") {
      choice = packTalkChoice(world, act);
      text = `Talk to ${nameOf(act.target)}`;
    } else if (act.kind === "give" && known(act.item)) {
      choice = packGiveChoice(world, act);
      text = act.label ?? `Give ${nameOf(act.item)} to ${nameOf(act.target)}`;
    }
    if (text && choice?.packId === PACK && byId.get(choice.choiceId)?.effects.length)
      byChoice.set(choice.choiceId, text);
  }
  return { byChoice, byBook, takes };
}

function accountOf(world, seen, c) {
  for (const condition of [...c.effects, ...(c.requires || []), ...(pack.places[c.at]?.requires || [])]) {
    if (condition.kind !== "choice" && condition.kind !== "choose") continue;
    if (world.packs[PACK].choices[condition.key] === condition.value && seen.has(c.id) && accounts[condition.key])
      return accounts[condition.key][condition.value];
  }
  return "";
}

function followsAtKnownPlace(world, actor, c, { observed, events }, visited, known, receipts) {
  if (!["talk", "give"].includes(c.on) || !visited.has(c.at) || !known(c.at) || !known(c.subject)) return "";
  if (!events.some((e) => (e.actorId === actor && e.targetId === c.subject) ||
    (e.actorId === c.subject && e.witnesses?.includes(actor)))) return "";
  if (Object.hasOwn(receipts, c.id) || !prerequisites(c.requires).some((id) => observed.has(id))) return "";
  if (!entityActive(world, c.at) || !entityActive(world, c.subject) || world.actors[c.subject]?.place !== c.at ||
    !conditionsMet(world, PACK, c.requires, actor)) return "";
  const item = heldSlots(c.requires).flat().find((id) => world.items[id]?.holder === actor && known(id));
  if (c.on === "give" && !item) return "";
  return `${item ? `Give ${nameOf(item)} to` : "Talk to"} ${nameOf(c.subject)} at ${nameOf(c.at)}`;
}

export function greekJournal(world, actor, known) {
  const state = world.packs?.[PACK], person = world.actors[actor];
  if (!pack || !state?.receipts || !person) return [];
  const evidence = personalEvidence(world, actor, state.receipts);
  const { observed, books } = evidence;
  const here = person.place, visited = new Set([here, ...(person.visited || [])]);
  if (!observed.size && !books.size && !pack.places[here]) return [];
  const local = pack.places[here] && known(here) ? localLeads(world, actor, known) : null;
  const rows = [];
  for (const work of works) {
    const ids = new Set(work.choices.map((c) => c.id));
    const relevant = work.choices.filter((c) => observed.has(c.id));
    const rememberedBooks = [...books].filter(([id]) => (pack.items[id].records || []).some((record) => ids.has(record)));
    const readable = [...(local?.byBook || [])].find(([id]) =>
      (pack.items[id].records || []).some((record) => ids.has(record) && Object.hasOwn(state.receipts, record)));
    if (!relevant.length && !rememberedBooks.length && !readable) continue;
    const observedKinds = new Set(relevant.map((c) => observed.get(c.id)));
    const personal = observedKinds.has("took part") ? "You took part."
      : observedKinds.has("read") || rememberedBooks.some(([, kind]) => kind === "read") ? "You read a record."
      : observedKinds.has("witnessed") ? "You witnessed a scene."
      : relevant.length || rememberedBooks.length ? "You heard an account." : "";
    const settled = work.choices.some((c) => (madeDecision(c) || c.id === "greek-bury-polynices") &&
      (observed.has(c.id) || (readable && pack.items[readable[0]].records.includes(c.id))) &&
      Object.hasOwn(state.receipts, c.id));
    const account = relevant.map((c) => accountOf(world, observed, c)).find(Boolean) || "";
    const place = [...relevant.map((c) => c.at), ...work.placeIds]
      .find((id) => visited.has(id) && known(id));
    let next = local && [...new Set(work.choices.map((c) => local.byChoice.get(c.id)).filter(Boolean))]
      .slice(0, 2).join(" or ");
    if (!next && readable && !books.has(readable[0])) next = readable[1];
    if (!next && local && relevant.length) {
      const unplayed = work.choices.filter((c) => c.at === here && c.on === "give" &&
        !Object.hasOwn(state.receipts, c.id) && known(c.subject) && entityActive(world, c.subject));
      for (const c of unplayed) {
        const item = c.requires.find((r) => r.kind === "holding" && r.role === "actor" && local.takes.has(r.item));
        if (item && conditionsMet(world, PACK, c.requires.filter((r) => r !== item), actor)) {
          next = local.takes.get(item.item);
          break;
        }
      }
    }
    if (!next) next = work.choices.map((c) => followsAtKnownPlace(world, actor, c, evidence, visited, known, state.receipts)).find(Boolean);
    rows.push({ title: work.title, author: work.author, era: eras[work.era], account,
      place: place ? nameOf(place) : "", personal, settled, next: next || "" });
  }
  return rows;
}
