import {
  choiceText,
  committedChoiceText,
  conditionsMet,
  entityActive,
  packDefinition,
  packDefinitions,
  packEntity,
  packThings,
} from "./pack-registry.mjs";
import { knowsFact, readClaim, validFactText } from "./knowledge.mjs";
import { giveUpForGood } from "./world/for-good.mjs";

const itemOf = (packId, book) => {
  const pack = packDefinitions.find((p) => p.id === packId);
  return Object.hasOwn(pack?.items || {}, book) ? pack.items[book] : {};
};
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
// A record book writes down each choice it records, kept as first read.
const recorded = (s, packId, book) => {
  const item = itemOf(packId, book),
    receipts = s?.packs?.[packId]?.receipts || {};
  return (item.author ? item.records || [] : [])
    .filter((choice) => Object.hasOwn(receipts, choice))
    .sort((a, b) => receipts[a] - receipts[b]);
};
const record = (packId, book, claim, text) => ({
  id: `claim:${packId}:${book}:${claim}`,
  text,
  book,
  claim,
  author: itemOf(packId, book).author,
  about: null,
});
const recordClaims = (s, packId, book) => {
  const pack = packDefinitions.find((p) => p.id === packId);
  return recorded(s, packId, book)
    .map((choice) => {
      const said = committedChoiceText(s, pack, pack.choices.find((c) => c.id === choice));
      return record(packId, book, choice, said.match(/^.*?[.!?]["'’”]?(?=\s|$)/u)?.[0] ?? said);
    })
    .filter((claim) => validFactText(claim.text));
};
export const authoredClaim = (id) =>
  bookClaims(...id.split(":").slice(1, 3)).find((c) => c.id === id) || null;
export const savedClaim = (s, id, fact) => {
  const [, packId, book, choice] = id.split(":");
  const claim =
    authoredClaim(id) ??
    (recorded(s, packId, book).includes(choice)
      ? record(packId, book, choice, fact?.text)
      : null);
  return claim?.id === id ? { ...claim, settles: settles(s, id, claim.about) } : null;
};
export const claimsIn = (book, s) => {
  const packId = packThings[book]?.packId;
  return [...bookClaims(packId, book), ...recordClaims(s, packId, book)];
};

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
  if (itemOf(packThings[a.item].packId, a.item).lifecycle === "spent")
    giveUpForGood(s, a.item);
}

export function residentRead(s, id, human, actionsOf) {
  const books = Object.keys(s.items).filter(
    (book) =>
      s.items[book].holder === id &&
      claimsIn(book, s).some((claim) => !knowsFact(s, id, claim.id)),
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
