import {
  choiceText,
  recordedChoiceLine,
  conditionsMet,
  entityActive,
  packDefinition,
  packEntity,
  packThings,
} from "./pack-registry.mjs";
import {
  authoredQuestStages,
  knowsFact,
  learnQuest,
  legacyQuestFactId,
  questFactId,
  readClaim,
  validFactText,
} from "./knowledge.mjs";
import { questText } from "./quest-learn.mjs";
import { questFor } from "./talk-quest.mjs";
import { revealed } from "./want-talk.mjs";
import { giveUpForGood } from "./world/for-good.mjs";
import forest from "./forest.json" with { type: "json" };

const itemOf = (packId, book) => {
  const items = packId === "hub" ? forest.things : packDefinition(packId)?.items;
  return Object.hasOwn(items || {}, book) ? items[book] : {};
};
const bookPack = (book) => packThings[book]?.packId ?? "hub";
export const fixedBook = (book) => itemOf(bookPack(book), book).lifecycle === "fixed";
export function validBookHolder(book, holder) {
  const pack = bookPack(book);
  const item = itemOf(pack, book);
  if (item.lifecycle !== "fixed") return true;
  return holder === (pack === "hub" ? forest.initialState.items[book]?.holder : item.holder);
}
export const bookClaims = (packId, book) => {
  const item = itemOf(packId, book);
  return (item.claims || []).map((claim) => ({
    id: `claim:${packId}:${book}:${claim.id}`,
    text: claim.text,
    book,
    claim: claim.id,
    author: item.author,
    about: claim.about ?? null,
  }));
};
const recorded = (s, packId, book) => {
  const item = itemOf(packId, book),
    receipts = s?.packs?.[packId]?.receipts || {};
  return (item.author ? item.records || [] : [])
    .filter((choice) => Object.hasOwn(receipts, choice))
    .sort((a, b) => receipts[a] - receipts[b]);
};
const record = (packId, book, claim, fallback) => {
  const item = itemOf(packId, book);
  const written = item.recordText;
  return {
    id: `claim:${packId}:${book}:${claim}`,
    text: written && Object.hasOwn(written, claim) ? written[claim] : fallback(),
    book,
    claim,
    author: item.author,
    about: null,
  };
};
const recordClaims = (s, packId, book) => {
  const pack = packDefinition(packId);
  if (!pack) return [];
  return recorded(s, packId, book)
    .map((id) => record(packId, book, id, () =>
      recordedChoiceLine(s, pack, pack.choices.find((c) => c.id === id)),
    ))
    .filter((claim) => validFactText(claim.text));
};
export const authoredClaim = (id) =>
  bookClaims(...id.split(":").slice(1, 3)).find((c) => c.id === id) || null;
export const savedClaim = (s, id, fact) => {
  const [, packId, book, choice] = id.split(":");
  const claim =
    authoredClaim(id) ??
    (recorded(s, packId, book).includes(choice)
      ? record(packId, book, choice, () => fact?.text)
      : null);
  return claim?.id === id ? { ...claim, settles: settles(s, id, claim.about) } : null;
};
export const claimsIn = (book, s) => {
  const packId = bookPack(book);
  return [...bookClaims(packId, book), ...recordClaims(s, packId, book)];
};

export function readableBook(world, book, reader) {
  const holder = world.items[book]?.holder;
  const reachable = fixedBook(book) ? world.actors[reader]?.place : reader;
  return holder === reachable && claimsIn(book, world).length > 0;
}

export function bookQuestId(book, legacy = false) {
  const item = itemOf(bookPack(book), book);
  if (!item.teachesQuest) return null;
  const { author, teachesQuest } = item;
  if (legacy) return legacyQuestFactId(author, teachesQuest);
  const stages = authoredQuestStages(author, teachesQuest);
  if (stages.length > 1) return null;
  return questFactId(author, stages[0]?.want ?? { target: teachesQuest });
}

function bookQuest(world, book, reader) {
  const id = bookQuestId(book);
  if (!id || knowsFact(world, reader, id)) return null;
  const owner = itemOf(bookPack(book), book).author;
  const want = world.actors[owner]?.want;
  return owner !== reader &&
    want &&
    questFactId(owner, want) === id &&
    entityActive(world, owner) &&
    revealed(world, owner, want, reader) &&
    questFor(world, owner, want)
    ? { owner, want, id }
    : null;
}

export function readBook(s, a, witnesses, addLog) {
  addLog(s, "World", a.text, {
    kind: "action",
    actorId: a.actor,
    verb: "read",
    itemId: a.item,
    witnesses,
  });
  const entry = s.log.at(-1);
  for (const claim of claimsIn(a.item, s)) readClaim(s, a.actor, claim, entry);
  const quest = bookQuest(s, a.item, a.actor);
  if (quest)
    learnQuest(
      s,
      quest.owner,
      a.actor,
      { id: quest.id, text: questText(s, quest.owner, quest.want) },
      { seq: entry.seq, turn: entry.turn, book: a.item },
    );
  if (itemOf(bookPack(a.item), a.item).lifecycle === "spent")
    giveUpForGood(s, a.item);
}

export function residentRead(s, id, human, actionsOf) {
  const books = Object.keys(s.items).filter(
    (book) =>
      s.items[book].holder === id &&
      (claimsIn(book, s).some((claim) => !knowsFact(s, id, claim.id)) ||
        bookQuest(s, book, id)),
  );
  if (
    !books.length ||
    s.log.some(
      (e) => e.turn === s.turn && e.verb === "read" && !human(s, e.actorId),
    )
  )
    return null;
  return actionsOf().find((a) => a.kind === "read" && books.includes(a.item));
}

export const claimTruth = (packId, about) => {
  const keys = (packDefinition(packId)?.continuity?.groups || []).map((g) => g.key);
  return (packEntity(about)?.requires || []).filter(
    (c) => c.kind === "choice" && keys.includes(c.key),
  );
};
function settles(s, id, about) {
  const packId = id.split(":")[1],
    truth = claimTruth(packId, about),
    chosen = s.packs?.[packId]?.choices || {};
  if (!truth.length || truth.some((c) => !Object.hasOwn(chosen, c.key))) return null;
  return conditionsMet(s, packId, truth) ? "confirmed" : "disproved";
}
export function sawBranch(s, actor, packId, key) {
  const { choices, receipts } = s.packs[packId],
    known = s.knowledge.known[actor],
    here = s.actors[actor].place;
  const onBranch = (id) =>
    (packEntity(id)?.requires || []).some(
      (c) => c.kind === "choice" && c.key === key && c.value === choices[key],
    );
  const commit = packDefinition(packId).choices.find(
    (c) =>
      Object.hasOwn(receipts, c.id) &&
      c.effects.some(
        (e) => e.kind === "choose" && e.key === key && e.value === choices[key],
      ),
  );
  const sawCommit = (id) => {
    const f = s.knowledge.facts[id];
    return (
      known[id].kind === "witnessed" &&
      f?.source.kind === "event" &&
      f.source.turn === receipts[commit.id] &&
      f.source.locationId === commit.at &&
      f.text === choiceText(commit, f.source.actorId)
    );
  };
  return (
    onBranch(here) ||
    Object.keys(s.actors).some(
      (id) => s.actors[id].place === here && onBranch(id) && entityActive(s, id),
    ) ||
    (!!commit && Object.keys(known).some(sawCommit))
  );
}
export function settleClaims(s) {
  const { facts = {}, known = {} } = s.knowledge || {};
  for (const fact of Object.values(facts)) {
    const status = fact.source.kind === "claim" && settles(s, fact.id, fact.source.about);
    if (!status) continue;
    const packId = fact.id.split(":")[1];
    for (const [actor, memory] of Object.entries(known))
      if (
        memory[fact.id] &&
        !memory[fact.id].status &&
        entityActive(s, actor) &&
        claimTruth(packId, fact.source.about).every((c) =>
          sawBranch(s, actor, packId, c.key),
        )
      )
        memory[fact.id].status = status;
  }
}
