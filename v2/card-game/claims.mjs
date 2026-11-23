import { packDefinitions } from "./pack-registry.mjs";

// A book's claims as knowledge keeps them, each id claim:<pack>:<book>:<claim>.
export const bookClaims = (packId, book) => {
  const pack = packDefinitions.find((p) => p.id === packId);
  const item = Object.hasOwn(pack?.items || {}, book) ? pack.items[book] : {};
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
