import { committedChoiceText, packDefinitions, packThings } from "./pack-registry.mjs";
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
  return claim?.id === id ? claim : null;
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
