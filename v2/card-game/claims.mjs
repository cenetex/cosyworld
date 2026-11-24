import { packDefinitions, packThings } from "./pack-registry.mjs";
import { knowsFact, readClaim } from "./knowledge.mjs";
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
export const authoredClaim = (id) =>
  bookClaims(...id.split(":").slice(1, 3)).find((c) => c.id === id) || null;
export const claimsIn = (book) => bookClaims(packThings[book]?.packId, book);

export function readBook(s, a, witnesses, addLog) {
  addLog(s, "World", a.text, {
    kind: "action",
    actorId: a.actor,
    verb: "read",
    itemId: a.item,
    witnesses,
  });
  const entry = s.log.at(-1);
  for (const claim of claimsIn(a.item)) readClaim(s, a.actor, claim, entry);
  if (itemOf(packThings[a.item].packId, a.item).lifecycle === "spent")
    giveUpForGood(s, a.item);
}

export function residentRead(s, id, human, actionsOf) {
  const books = Object.keys(s.items).filter(
    (book) =>
      s.items[book].holder === id &&
      claimsIn(book).some((claim) => !knowsFact(s, id, claim.id)),
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
